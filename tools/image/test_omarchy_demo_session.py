#!/usr/bin/env python3
"""Deterministic safety tests for the bounded Omarchy demo-session sidecar."""

from __future__ import annotations

import os
from pathlib import Path
import stat
import subprocess
import sys
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
        self.id_log = self.root / "id.log"
        self._tool(
            "foot",
            '#!/bin/bash\nprintf "%s %s\\n" "$EUID" "$WAYLAND_DISPLAY" >> "$FOOT_LOG"\n',
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _tool(self, name: str, body: str) -> None:
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o755)

    def _environment(self) -> dict[str, str]:
        # Do not inherit shell startup hooks or the runner's desktop environment.
        return {
            "HOME": str(self.home),
            "OMARCHY_PATH": "/usr/share/omarchy",
            "WAYLAND_DISPLAY": "wayland-0",
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "FOOT_LOG": str(self.foot_log),
            "ID_LOG": str(self.id_log),
        }

    def _run(
        self, environment: dict[str, str] | None = None, *, uid: int = 1000
    ) -> subprocess.CompletedProcess[str]:
        credentials = {}
        if sys.platform == "linux" and os.geteuid() == 0:
            # Only the disposable fixture is chowned; symlink targets are not followed.
            for path in [self.root, *self.root.rglob("*")]:
                os.lchown(path, uid, uid)
            credentials = {"user": uid, "group": uid, "extra_groups": []}
        elif os.geteuid() != uid:
            self.skipTest(
                f"requires actual UID {uid}; current UID {os.geteuid()} on {sys.platform} "
                "cannot switch identities (run in the Linux-root profile container)"
            )
        return subprocess.run(
            [str(SCRIPT)],
            env=environment or self._environment(),
            cwd=self.root,
            text=True,
            capture_output=True,
            check=False,
            timeout=10,
            **credentials,
        )

    def _rejected_uids(self) -> tuple[int, ...]:
        if sys.platform == "linux" and os.geteuid() == 0:
            return (0, 1001)
        if os.geteuid() == 1000:
            self.skipTest("real non-1000 rejection requires another UID or Linux-root harness")
        return (os.geteuid(),)

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
        self.assertEqual((self.home / MARKER).stat().st_uid, 1000)
        self.assertEqual(self.foot_log.read_text().splitlines(), ["1000 wayland-0"])

        forbidden = (
            ".local/state/omarchy/done/finalize-user",
            ".local/state/omarchy/done/first-run-user",
            ".local/share/keyrings",
            ".config/fakecompletedsetup",
        )
        for relative in forbidden:
            self.assertFalse((self.home / relative).exists())

    def test_mandatory_mkdir_failure_does_not_write_marker_or_launch_foot(self) -> None:
        self._tool(
            "mkdir",
            '#!/bin/sh\n[ "$1" = "$HOME/Documents" ] && exit 73\nexec /bin/mkdir "$@"\n',
        )

        result = self._run()

        self.assertEqual(result.returncode, 73, result.stderr)
        self.assertTrue((self.home / "Desktop").is_dir())
        self.assertFalse((self.home / MARKER).exists())
        self.assertFalse(self.foot_log.exists())

    def test_marker_skips_setup_but_not_fresh_session_foot_launch(self) -> None:
        first = self._run()
        marker_before = (self.home / MARKER).stat()
        environment = self._environment()
        environment["WAYLAND_DISPLAY"] = "wayland-1"
        second = self._run(environment)

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(
            self.foot_log.read_text().splitlines(), ["1000 wayland-0", "1000 wayland-1"]
        )
        self.assertEqual((self.home / MARKER).stat().st_mtime_ns, marker_before.st_mtime_ns)
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

    def test_marker_symlink_preserves_outside_sentinel_and_does_not_launch_foot(self) -> None:
        outside = self.root / "outside-sentinel"
        outside.write_bytes(b"OUTSIDE-SENTINEL: do not overwrite\n")
        outside.chmod(0o640)
        before = outside.stat()
        marker = self.home / MARKER
        marker.parent.mkdir(parents=True)
        marker.symlink_to(outside)

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing symlinked session marker", result.stderr)
        self.assertTrue(marker.is_symlink())
        self.assertEqual(marker.readlink(), outside)
        self.assertEqual(outside.read_bytes(), b"OUTSIDE-SENTINEL: do not overwrite\n")
        self.assertEqual(stat.S_IMODE(outside.stat().st_mode), stat.S_IMODE(before.st_mode))
        self.assertEqual(outside.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertFalse(self.foot_log.exists())
        self.assertFalse((self.home / "Desktop").exists())
        for name in ("finalize-user", "first-run-user"):
            self.assertFalse((self.home / ".local/state/omarchy/done" / name).exists())

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

        result = self._run(environment, uid=os.geteuid())

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("WAYLAND_DISPLAY is required", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_uid_other_than_1000_is_refused(self) -> None:
        for uid in self._rejected_uids():
            with self.subTest(uid=uid):
                result = self._run(uid=uid)

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("must run as uid 1000", result.stderr)
                self.assertEqual(list(self.home.iterdir()), [])
                self.assertFalse(self.foot_log.exists())

    def test_spoofed_path_id_cannot_evade_uid_check(self) -> None:
        self._tool(
            "id",
            '#!/bin/sh\nprintf "called\\n" >> "$ID_LOG"\nprintf "1000\\n"\n',
        )
        for uid in self._rejected_uids():
            for spoof_environment in (False, True):
                with self.subTest(uid=uid, spoof_environment=spoof_environment):
                    environment = self._environment()
                    if spoof_environment:
                        environment.update({"EUID": "1000", "UID": "1000"})
                    result = self._run(environment, uid=uid)

                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("must run as uid 1000", result.stderr)
                    self.assertEqual(list(self.home.iterdir()), [])
                    self.assertFalse((self.home / MARKER).exists())
                    self.assertFalse(self.foot_log.exists())
                    self.assertFalse(self.id_log.exists(), "the UID guard must not execute PATH id")

    @unittest.skipUnless(os.geteuid() == 0, "the real-root refusal is only meaningful when running as root")
    def test_real_root_is_refused_without_id_fixture(self) -> None:
        result = self._run(uid=0)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must run as uid 1000", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse(self.foot_log.exists())


if __name__ == "__main__":
    unittest.main()
