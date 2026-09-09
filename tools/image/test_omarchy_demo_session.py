#!/usr/bin/env python3
"""Deterministic safety tests for the bounded Omarchy demo-session sidecar."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("omarchy-demo-session.sh")
MARKER = Path(".local/state/wasm-vm/omarchy-demo-session-v1")
GENERIC_FOLDERS = (
    "Desktop",
    "Documents",
    "Downloads",
    "Music",
    "Pictures",
    "Public",
    "Templates",
    "Videos",
)


class OmarchyDemoSessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="omarchy-demo-session-test-")
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.foot_log = self.root / "foot.log"
        self._tool("id", '#!/bin/sh\n[ "$1" = "-u" ] && printf "1000\\n" || exit 2\n')
        self._tool(
            "foot",
            '#!/bin/sh\nprintf "%s\\n" "$WAYLAND_DISPLAY" >> "$FOOT_LOG"\n',
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _tool(self, name: str, body: str) -> None:
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o755)

    def _environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        environment.update(
            {
                "HOME": str(self.home),
                "OMARCHY_PATH": "/usr/share/omarchy",
                "WAYLAND_DISPLAY": "wayland-0",
                "PATH": f"{self.bin}:/usr/bin:/bin",
                "FOOT_LOG": str(self.foot_log),
            }
        )
        return environment

    def _run(self, environment: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(SCRIPT)],
            env=environment or self._environment(),
            text=True,
            capture_output=True,
            check=False,
        )

    def test_initializes_generic_home_and_launches_foot(self) -> None:
        result = self._run()

        self.assertEqual(result.returncode, 0, result.stderr)
        for folder in GENERIC_FOLDERS:
            self.assertTrue((self.home / folder).is_dir())
        bookmarks = self.home / ".config/gtk-3.0/bookmarks"
        bookmark_lines = bookmarks.read_text().splitlines()
        self.assertEqual(
            bookmark_lines,
            [f"file://{self.home}/{folder} {folder}" for folder in GENERIC_FOLDERS],
        )
        self.assertEqual((self.home / MARKER).read_text(), "wasm-vm omarchy demo session v1\n")
        self.assertEqual(self.foot_log.read_text().splitlines(), ["wayland-0"])

        forbidden = (
            ".local/state/omarchy/done/finalize-user",
            ".local/state/omarchy/done/first-run-user",
            ".local/share/keyrings",
            ".config/fakecompletedsetup",
        )
        for relative in forbidden:
            self.assertFalse((self.home / relative).exists())

    def test_mandatory_mkdir_failure_does_not_write_marker_or_launch_foot(self) -> None:
        self._tool("mkdir", "#!/bin/sh\nexit 73\n")

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.home / MARKER).exists())
        self.assertFalse(self.foot_log.exists())

    def test_marker_skips_setup_but_not_fresh_session_foot_launch(self) -> None:
        first = self._run()
        second = self._run()

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(self.foot_log.read_text().splitlines(), ["wayland-0", "wayland-0"])
        self.assertEqual(
            (self.home / ".config/gtk-3.0/bookmarks").read_text().splitlines(),
            [f"file://{self.home}/{folder} {folder}" for folder in GENERIC_FOLDERS],
        )

    def test_symlinked_home_entry_fails_before_marker_or_launch(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (self.home / "Documents").symlink_to(outside, target_is_directory=True)

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("symlinked home path", result.stderr)
        self.assertFalse((self.home / MARKER).exists())
        self.assertFalse(self.foot_log.exists())
        self.assertEqual(list(outside.iterdir()), [])

    def test_invalid_existing_marker_fails_closed(self) -> None:
        marker = self.home / MARKER
        marker.parent.mkdir(parents=True)
        marker.write_text("not the sidecar marker\n")

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("session marker is invalid", result.stderr)
        self.assertFalse(self.foot_log.exists())

    def test_missing_wayland_display_fails_without_writing_home(self) -> None:
        environment = self._environment()
        environment.pop("WAYLAND_DISPLAY")

        result = self._run(environment)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("WAYLAND_DISPLAY is required", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_uid_other_than_1000_is_refused(self) -> None:
        self._tool("id", '#!/bin/sh\nprintf "0\\n"\n')

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must run as uid 1000", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])

    @unittest.skipUnless(os.geteuid() == 0, "the real-root refusal is only meaningful when running as root")
    def test_real_root_is_refused_without_id_fixture(self) -> None:
        (self.bin / "id").unlink()

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must run as uid 1000", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
