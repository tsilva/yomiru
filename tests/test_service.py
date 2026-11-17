import plistlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from yomiru.service import LABEL, configuration, manage


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


if __name__ == "__main__":
    unittest.main()
