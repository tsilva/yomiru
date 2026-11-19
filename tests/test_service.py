import plistlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from yomiru.service import LABEL, REVIEW_LABEL, configuration, manage, manage_review


class ServiceTests(unittest.TestCase):
    def test_configuration_uses_current_environment_and_local_library(self):
        config = configuration(Path("/example/yomiru"), 8808)
        self.assertEqual(config["ProgramArguments"][1:4], ["-m", "yomiru.cli", "serve"])
        self.assertEqual(config["ProgramArguments"][-1], "/example/yomiru/.local/library")
        self.assertTrue(config["KeepAlive"])
        self.assertEqual(config["ThrottleInterval"], 30)

    def test_installer_refuses_existing_configuration_and_cleans_failed_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src/yomiru").mkdir(parents=True)
            (root / "src/yomiru/cli.py").touch()
            (root / "pyproject.toml").touch()
            plist = root / "Library/LaunchAgents" / f"{LABEL}.plist"
            with (
                patch("yomiru.service.sys.platform", "darwin"),
                patch("yomiru.service.Path.home", return_value=root),
                patch("yomiru.service.socket.socket"),
                patch("yomiru.service.subprocess.run") as run,
            ):
                run.return_value = SimpleNamespace(returncode=1)
                with self.assertRaisesRegex(ValueError, "could not start"):
                    manage("install", root)
                self.assertFalse(plist.exists())
                plist.write_bytes(plistlib.dumps({"Label": "another job"}))
                before = plist.read_bytes()
                with self.assertRaisesRegex(ValueError, "already exists"):
                    manage("install", root)
                with self.assertRaisesRegex(ValueError, "differs"):
                    manage("uninstall", root)
                self.assertEqual(plist.read_bytes(), before)

    def test_review_job_runs_scheduled_batches_and_leaves_subtitle_server_alone(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            paths = [root / name for name in ("src/yomiru/cli.py", "pyproject.toml",
                     "web/scripts/review-words.mjs", "node", "publish-executor")]
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            node, executor = paths[-2:]
            node.chmod(0o700)
            executor.chmod(0o700)
            deployment = "yomiru-synthetic-tsilvas-projects.vercel.app"
            plists = root / "Library/LaunchAgents"
            plists.mkdir(parents=True)
            server = plists / f"{LABEL}.plist"
            server.write_bytes(plistlib.dumps({"Label": LABEL}))
            review = plists / f"{REVIEW_LABEL}.plist"
            with (
                patch("yomiru.service.sys.platform", "darwin"),
                patch("yomiru.service.Path.home", return_value=root),
                patch("yomiru.service.subprocess.run") as run,
            ):
                run.side_effect = [SimpleNamespace(returncode=1), SimpleNamespace(returncode=0)]
                manage_review("install", root, node, executor, deployment)
                config = plistlib.loads(review.read_bytes())
                self.assertEqual(config["StartInterval"], 900)
                self.assertTrue(config["RunAtLoad"])
                self.assertEqual(config["ProgramArguments"], [
                    str(node), str(paths[2]), "--executor", str(executor),
                    "--deployment", deployment,
                ])
                self.assertEqual(run.call_args_list[-1].args[0][-1], str(review))
                run.side_effect = [SimpleNamespace(returncode=0)]
                with self.assertRaisesRegex(ValueError, "differs"):
                    manage_review(
                        "uninstall", root, node, executor, deployment.replace("synthetic", "other"),
                    )
                self.assertTrue(review.exists())
                run.side_effect = [SimpleNamespace(returncode=0), SimpleNamespace(returncode=0)]
                manage_review("uninstall", root, node, executor, deployment)
                self.assertFalse(review.exists())
                self.assertTrue(run.call_args_list[-1].args[0][-1].endswith(REVIEW_LABEL))
                self.assertEqual(plistlib.loads(server.read_bytes()), {"Label": LABEL})


if __name__ == "__main__":
    unittest.main()
