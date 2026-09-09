#!/usr/bin/env python3
"""Focused synthetic safety tests for recover-package-defaults.py."""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("recover-package-defaults.py")
SPEC = importlib.util.spec_from_file_location("recover_package_defaults", MODULE_PATH)
assert SPEC and SPEC.loader
recover_package_defaults = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recover_package_defaults)


def tree_snapshot(root: Path) -> tuple[tuple[str, str, int, bytes | str], ...]:
    """Capture synthetic tree contents without following symlinks."""
    entries: list[tuple[str, str, int, bytes | str]] = []
    for path in sorted([root, *root.rglob("*")], key=os.fspath):
        relative = "." if path == root else path.relative_to(root).as_posix()
        info = os.lstat(path)
        if path.is_symlink():
            value: bytes | str = os.readlink(path)
            kind = "link"
        elif path.is_dir():
            value = b""
            kind = "dir"
        else:
            value = path.read_bytes()
            kind = "file"
        entries.append((relative, kind, info.st_mode, value))
    return tuple(entries)


class RecoverPackageDefaultsTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_parent = "/private/tmp" if Path("/private/tmp").is_dir() else None
        self.temp = tempfile.TemporaryDirectory(prefix="recover-package-defaults-test-", dir=temp_parent)
        self.parent = Path(self.temp.name)
        self.source = self.parent / "source"
        self.source.mkdir()
        self.output = self.parent / "upper"
        self.owner = os.getuid()
        self.group = os.getgid()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_source(self, relative: str, content: bytes) -> None:
        path = self.source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def _entry(self, relative: str, content: bytes, mode: str = "0644") -> dict[str, object]:
        return {
            "path": relative,
            "package": "synthetic-package",
            "expected": hashlib.sha256(content).hexdigest(),
            "uid": self.owner,
            "gid": self.group,
            "mode": mode,
        }

    def _run(self, output: Path, inventory: list[dict[str, object]]) -> tuple[dict[str, object], str]:
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            recover_package_defaults.recover(self.source, output, inventory)
        return json.loads(stdout.getvalue()), stdout.getvalue()

    def test_fresh_marker_and_exact_hash_defaults_are_restored(self) -> None:
        exact = b"LANG=C.UTF-8\n"
        wrong = b"wrong-default\n"
        self._write_source("etc/locale.conf", exact)
        self._write_source("etc/hosts", wrong)
        inventory = [self._entry("etc/locale.conf", exact), self._entry("etc/hosts", b"expected-hosts\n")]
        before = tree_snapshot(self.source)

        result, _ = self._run(self.output, inventory)

        self.assertEqual(result, {"restored": ["etc/locale.conf"]})
        self.assertEqual((self.output / "etc/locale.conf").read_bytes(), exact)
        self.assertFalse((self.output / "etc/hosts").exists())
        self.assertEqual((self.output / recover_package_defaults.MARKER).read_bytes(), recover_package_defaults.MARKER_BYTES)
        self.assertEqual(tree_snapshot(self.source), before)

    def test_wrong_existing_default_is_rejected_without_replacement(self) -> None:
        expected = b"expected\n"
        actual = b"personalized\n"
        self.output.mkdir()
        (self.output / recover_package_defaults.MARKER).write_bytes(recover_package_defaults.MARKER_BYTES)
        destination = self.output / "etc/locale.conf"
        destination.parent.mkdir()
        destination.write_bytes(actual)

        with self.assertRaisesRegex(ValueError, "existing default does not match"):
            recover_package_defaults.recover(self.source, self.output, [self._entry("etc/locale.conf", expected)])

        self.assertEqual(destination.read_bytes(), actual)

    def test_existing_exact_default_is_accepted_on_repeat(self) -> None:
        content = b"safe-default=true\n"
        self._write_source("etc/synthetic.conf", content)
        inventory = [self._entry("etc/synthetic.conf", content)]
        self._run(self.output, inventory)
        before = tree_snapshot(self.output)

        result, _ = self._run(self.output, inventory)

        self.assertEqual(result, {"restored": []})
        self.assertEqual(tree_snapshot(self.output), before)

    def test_output_root_and_generated_parent_symlinks_fail_closed(self) -> None:
        real_output = self.parent / "real-output"
        real_output.mkdir()
        output_alias = self.parent / "output-alias"
        output_alias.symlink_to(real_output)
        content = b"synthetic\n"
        self._write_source("etc/demo.conf", content)

        with self.assertRaisesRegex(ValueError, "unsafe output path"):
            recover_package_defaults.recover(self.source, output_alias, [self._entry("etc/demo.conf", content)])
        self.assertFalse((real_output / recover_package_defaults.MARKER).exists())

        (self.output / recover_package_defaults.MARKER).parent.mkdir(parents=True)
        (self.output / recover_package_defaults.MARKER).write_bytes(recover_package_defaults.MARKER_BYTES)
        outside = self.parent / "outside"
        outside.mkdir()
        (self.output / "etc").symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "output symlink"):
            recover_package_defaults.recover(self.source, self.output, [self._entry("etc/demo.conf", content)])
        self.assertFalse((outside / "demo.conf").exists())

    def test_dangling_output_leaf_cannot_be_replaced(self) -> None:
        content = b"synthetic\n"
        self._write_source("etc/dangling.conf", content)
        self.output.mkdir()
        (self.output / recover_package_defaults.MARKER).write_bytes(recover_package_defaults.MARKER_BYTES)
        (self.output / "etc").mkdir()
        target = self.parent / "must-not-be-created"
        (self.output / "etc/dangling.conf").symlink_to(target)

        with self.assertRaisesRegex(ValueError, "output symlink"):
            recover_package_defaults.recover(self.source, self.output, [self._entry("etc/dangling.conf", content)])

        self.assertFalse(target.exists())
        self.assertTrue((self.output / "etc/dangling.conf").is_symlink())

    def test_only_etc_defaults_are_admitted_no_personal_accounts(self) -> None:
        default = b"127.0.0.1 localhost\n"
        personal = b"PERSONAL-ACCOUNT-SENTINEL\n"
        self._write_source("etc/hosts", default)
        self._write_source("home/omarchy/.config/private.conf", personal)
        inventory = [self._entry("etc/hosts", default), self._entry("home/omarchy/.config/private.conf", personal)]

        result, _ = self._run(self.output, inventory)

        self.assertEqual(result, {"restored": ["etc/hosts"]})
        self.assertFalse((self.output / "home").exists())
        self.assertNotIn("PERSONAL-ACCOUNT-SENTINEL", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
