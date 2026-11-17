"""Manage Yomiru's own per-user macOS launch agent without replacing other jobs."""

import os
import plistlib
import socket
import subprocess
import sys
from pathlib import Path

LABEL = "community.yomiru"


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


def manage(action: str, repo: Path, port: int = 8808) -> str:
    if sys.platform != "darwin":
        raise ValueError("Background service management currently supports macOS only")
    repo = repo.resolve()
    if not (repo / "pyproject.toml").is_file() or not (repo / "src/yomiru/cli.py").is_file():
        raise ValueError("Run service management from the Yomiru checkout")
    target = f"gui/{os.getuid()}/{LABEL}"
    plist = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    result = subprocess.run(["launchctl", "print", target], capture_output=True, text=True)
    loaded = result.returncode == 0
    if action == "status":
        return f"Yomiru service: {'loaded' if loaded else 'not loaded'}"
    if action == "uninstall":
        if not plist.is_file() or plist.is_symlink():
            raise ValueError("No owned Yomiru service configuration was found")
        saved = plistlib.loads(plist.read_bytes())
        expected = configuration(repo, port)
        if saved != expected:
            raise ValueError(
                "Service configuration differs; refusing to remove another configuration"
            )
        if loaded:
            subprocess.run(["launchctl", "bootout", target], check=True, capture_output=True)
        plist.unlink()
        return "Yomiru service removed; generated subtitles retained"
    if action != "install" or not 1 <= port <= 65535:
        raise ValueError("Choose install/status/uninstall and a port between 1 and 65535")
    if loaded or plist.exists() or plist.is_symlink():
        raise ValueError("A Yomiru service already exists; it was left unchanged")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))
    (repo / ".local/service").mkdir(parents=True, exist_ok=True)
    plist.parent.mkdir(parents=True, exist_ok=True)
    data = plistlib.dumps(configuration(repo, port))
    with plist.open("xb") as stream:
        stream.write(data)
    plist.chmod(0o600)
    result = subprocess.run(
        ["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], capture_output=True, text=True
    )
    if result.returncode:
        if plist.read_bytes() == data:
            plist.unlink()
        raise ValueError("macOS could not start the Yomiru service; no existing job was changed")
    return f"Yomiru service installed: http://127.0.0.1:{port}/manifest.json"
