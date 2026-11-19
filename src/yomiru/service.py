"""Manage Yomiru's own per-user macOS launch agent without replacing other jobs."""

import os
import plistlib
import re
import socket
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

LABEL = "community.yomiru"
REVIEW_LABEL = "community.yomiru.vocabulary-review"
DEPLOYMENT = re.compile(r"yomiru-[a-z0-9]+-tsilvas-projects\.vercel\.app")


def configuration(repo: Path, port: int) -> dict:
    runtime = repo / ".local/service"
    return {
        "Label": LABEL,
        "ProgramArguments": [
            sys.executable,
            "-m",
            "yomiru.cli",
            "serve",
            "--port",
            str(port),
            "--data-dir",
            str(repo / ".local/library"),
        ],
        "WorkingDirectory": str(repo),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 30,
        "ProcessType": "Background",
        "StandardOutPath": str(runtime / "stdout.log"),
        "StandardErrorPath": str(runtime / "stderr.log"),
    }


def _checkout(repo: Path) -> Path:
    if sys.platform != "darwin":
        raise ValueError("Background service management currently supports macOS only")
    repo = repo.resolve()
    if not (repo / "pyproject.toml").is_file() or not (repo / "src/yomiru/cli.py").is_file():
        raise ValueError("Run service management from the Yomiru checkout")
    return repo


def _manage_job(
    action: str, label: str, name: str, config: dict | None, *,
    prepare: Callable[[], None] | None = None,
) -> str:
    target = f"gui/{os.getuid()}/{label}"
    plist = Path.home() / "Library/LaunchAgents" / f"{label}.plist"
    result = subprocess.run(["launchctl", "print", target], capture_output=True, text=True)
    loaded = result.returncode == 0
    if action == "status":
        return f"{name}: {'loaded' if loaded else 'not loaded'}"
    if action == "uninstall":
        if not plist.is_file() or plist.is_symlink():
            raise ValueError(f"No owned {name} configuration was found")
        saved = plistlib.loads(plist.read_bytes())
        if saved != config:
            raise ValueError("Service configuration differs from the expected job")
        if loaded:
            subprocess.run(["launchctl", "bootout", target], check=True, capture_output=True)
        plist.unlink()
        return f"{name} removed"
    if action != "install" or config is None:
        raise ValueError("Choose install, status or uninstall")
    if loaded or plist.exists() or plist.is_symlink():
        raise ValueError(f"{name} already exists and was left unchanged")
    if prepare is not None:
        prepare()
    Path(config["StandardOutPath"]).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    plist.parent.mkdir(parents=True, exist_ok=True)
    data = plistlib.dumps(config)
    with plist.open("xb") as stream:
        stream.write(data)
    plist.chmod(0o600)
    result = subprocess.run(
        ["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], capture_output=True, text=True
    )
    if result.returncode:
        if plist.read_bytes() == data:
            plist.unlink()
        raise ValueError(f"macOS could not start {name}. Existing jobs were left in place.")
    return f"{name} installed"


def manage(action: str, repo: Path, port: int = 8808) -> str:
    repo = _checkout(repo)
    if action == "install" and not 1 <= port <= 65535:
        raise ValueError("Choose a port between 1 and 65535")

    def check_port():
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))

    result = _manage_job(action, LABEL, "Yomiru service", configuration(repo, port),
                         prepare=check_port)
    if action == "install":
        return f"{result}: http://127.0.0.1:{port}/manifest.json"
    if action == "uninstall":
        return f"{result}; generated subtitles retained"
    return result


def manage_review(
    action: str, repo: Path, node: Path | None, executor: Path | None, deployment: str | None,
) -> str:
    repo = _checkout(repo)
    name = "Yomiru vocabulary review"
    if action == "status":
        return _manage_job(action, REVIEW_LABEL, name, None)
    script = repo / "web/scripts/review-words.mjs"
    if (node is None or not node.is_absolute() or executor is None or not executor.is_absolute()
        or not DEPLOYMENT.fullmatch(deployment or "")):
        raise ValueError("Provide absolute Node and executor paths and the protected hostname")
    if action == "install" and (
        not script.is_file() or not os.access(node, os.X_OK) or not os.access(executor, os.X_OK)
        or not node.is_file() or not executor.is_file()
    ):
        raise ValueError("The review script, Node or publication executor is unavailable")
    log = repo / ".local/vocabulary-review"
    return _manage_job(action, REVIEW_LABEL, name, {
        "Label": REVIEW_LABEL,
        "ProgramArguments": [str(node), str(script), "--executor", str(executor),
                             "--deployment", deployment],
        "WorkingDirectory": str(repo),
        "RunAtLoad": True,
        "StartInterval": 900,
        "ProcessType": "Background",
        "StandardOutPath": str(log / "stdout.log"),
        "StandardErrorPath": str(log / "stderr.log"),
    })
