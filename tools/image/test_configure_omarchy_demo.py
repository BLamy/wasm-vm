#!/usr/bin/env python3
"""Focused synthetic safety tests for configure-omarchy-demo.py."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("configure-omarchy-demo.py")
SPEC = importlib.util.spec_from_file_location("configure_omarchy_demo", MODULE_PATH)
assert SPEC and SPEC.loader
configure_omarchy_demo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(configure_omarchy_demo)


ROOT_MARKER = b"wasm-vm-public-omarchy-root-v1\n"


def tree_snapshot(root: Path) -> tuple[tuple[str, str, int, bytes | str], ...]:
    """Capture synthetic tree contents without following symlinks."""
    entries: list[tuple[str, str, int, bytes | str]] = []
    for path in sorted([root, *root.rglob("*")], key=os.fspath):
        relative = "." if path == root else path.relative_to(root).as_posix()
        info = os.lstat(path)
        mode = info.st_mode
        if path.is_symlink():
            value: bytes | str = os.readlink(path)
            kind = "link"
        elif path.is_dir():
            value = b""
            kind = "dir"
        else:
            value = path.read_bytes()
            kind = "file"
        entries.append((relative, kind, mode, value))
    return tuple(entries)


class ConfigureOmarchyDemoTests(unittest.TestCase):
    def setUp(self) -> None:
        if os.geteuid() != 0:
            self.skipTest("configure requires container root")
        temp_parent = "/private/tmp" if Path("/private/tmp").is_dir() else None
        self.temp = tempfile.TemporaryDirectory(prefix="configure-omarchy-demo-test-", dir=temp_parent)
        self.parent = Path(self.temp.name)
        self.root = self.parent / "package-root"
        self.root.mkdir()
        (self.root / ".wasm-vm-public-omarchy-root").write_bytes(ROOT_MARKER)
        self._write("etc/wasm-vm/omarchy-assembly.json", b'{"schema": 1}\n')
        self._write("usr/share/omarchy/config/appearance.conf", b"reviewed-demo-config=true\n")
        self._write("usr/share/omarchy/config/theme.conf", b"theme=synthetic\n")
        untrusted_home = self.parent / "untrusted-home/blamy/.config"
        untrusted_home.mkdir(parents=True)
        (untrusted_home / "personal.conf").write_bytes(b"PERSONAL-ACCOUNT-SENTINEL\n")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write(self, relative: str, content: bytes) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def test_reviewed_config_is_copied_without_personal_accounts(self) -> None:
        source = self.root / "usr/share/omarchy/config"
        before = tree_snapshot(source)

        changes = configure_omarchy_demo.configure(self.root)

        self.assertIn("etc/fstab", changes)
        self.assertEqual(
            (self.root / "home/omarchy/.config/appearance.conf").read_bytes(),
            b"reviewed-demo-config=true\n",
        )
        self.assertEqual(
            (self.root / "home/omarchy/.config/theme.conf").read_bytes(),
            b"theme=synthetic\n",
        )
        self.assertFalse((self.root / "home/blamy").exists())
        self.assertFalse((self.root / "etc/passwd").exists())
        self.assertFalse((self.root / "etc/shadow").exists())
        self.assertNotIn("PERSONAL-ACCOUNT-SENTINEL", json.dumps(changes))
        overlay = json.loads((self.root / "etc/wasm-vm/demo-overlay.json").read_text())
        self.assertEqual(overlay["configurationSource"], "package-verified usr/share/omarchy/config")
        self.assertFalse(overlay["desktopVerified"])
        self.assertEqual(tree_snapshot(source), before)

    def test_source_tree_is_immutable_after_configuration(self) -> None:
        source = self.root / "usr/share/omarchy/config"
        before = tree_snapshot(source)

        configure_omarchy_demo.configure(self.root)

        self.assertEqual(tree_snapshot(source), before)

    def test_root_marker_and_root_symlink_ancestors_fail_closed(self) -> None:
        marker = self.root / ".wasm-vm-public-omarchy-root"
        marker.unlink()
        outside = self.parent / "outside"
        outside.write_bytes(b"outside-sentinel\n")
        marker.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "sanitized Omarchy tree"):
            configure_omarchy_demo.configure(self.root)
        self.assertFalse((self.root / "home/omarchy/.config").exists())

        alias = self.parent / "root-alias"
        alias.symlink_to(self.root)
        with self.assertRaisesRegex(ValueError, "real absolute directory"):
            configure_omarchy_demo.configure(alias)
        self.assertEqual(outside.read_bytes(), b"outside-sentinel\n")

    def test_generated_parent_symlink_cannot_receive_configuration(self) -> None:
        outside = self.parent / "outside"
        outside.mkdir()
        environment = self.root / "etc/environment.d"
        environment.mkdir(parents=True)
        environment.rmdir()
        environment.symlink_to(outside, target_is_directory=True)

        with self.assertRaisesRegex(ValueError, "overlay would follow a symlink"):
            configure_omarchy_demo.configure(self.root)

        self.assertFalse((outside / "60-omarchy-browser.conf").exists())

    def test_dangling_generated_leaf_cannot_be_replaced(self) -> None:
        target = self.parent / "must-not-be-created"
        fstab = self.root / "etc/fstab"
        fstab.parent.mkdir(parents=True, exist_ok=True)
        fstab.symlink_to(target)

        with self.assertRaisesRegex(ValueError, "overlay would follow a symlink"):
            configure_omarchy_demo.configure(self.root)

        self.assertFalse(target.exists())
        self.assertTrue(fstab.is_symlink())

    def test_repeated_configuration_fails_before_mutating_overlay(self) -> None:
        configure_omarchy_demo.configure(self.root)
        before = tree_snapshot(self.root)

        with self.assertRaisesRegex(ValueError, "freshly empty"):
            configure_omarchy_demo.configure(self.root)

        self.assertEqual(tree_snapshot(self.root), before)


if __name__ == "__main__":
    unittest.main()
