#!/usr/bin/env python3
"""Bounded, synthetic tests for the Omarchy image-builder admission guards.

These tests deliberately stop before ``mke2fs`` and never boot a VM or create a
large image.  The one setup-failure test mocks the command runner so it can
check diagnostic-tree retention and receipt absence without pretending to
prove filesystem population.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).with_name("build-omarchy-image.py")
SPEC = importlib.util.spec_from_file_location("build_omarchy_image", MODULE_PATH)
assert SPEC and SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = builder
SPEC.loader.exec_module(builder)


DISPOSABLE_MARKER = ".wasm-vm-disposable-extracted-root"
DISPOSABLE_MARKER_CONTENT = b"wasm-vm-disposable-extracted-root-v1\n"


class BuildGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_parent = "/private/tmp" if Path("/private/tmp").is_dir() else None
        self.temp = tempfile.TemporaryDirectory(prefix="build-omarchy-image-test-", dir=temp_parent)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self._write_assembly()
        self.selection = self.root / "selection.json"
        self.selection.write_text(json.dumps({"versions": {"demo": "1.0"}}) + "\n", encoding="utf-8")
        self.overlays = self.root / "overlays.json"
        self.overlays.write_text(json.dumps({"entries": []}) + "\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_assembly(self, **overrides: object) -> None:
        assembly = {
            "schema": 1,
            "kind": "omarchy-package-assembly",
            "packages": [{"name": "demo", "version": "1.0"}],
            "overlays": [],
        }
        assembly.update(overrides)
        path = self.source / "etc/wasm-vm/omarchy-assembly.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(assembly) + "\n", encoding="utf-8")
        (self.source / "etc/wasm-vm/packages.tsv").write_text("name\tversion\ndemo\t1.0\n", encoding="utf-8")

    def _mark_source(self) -> None:
        (self.source / DISPOSABLE_MARKER).write_bytes(DISPOSABLE_MARKER_CONTENT)

    def _populate_synthetic_sanitized_root(self, destination: Path) -> None:
        destination.mkdir()
        for relative in ("dev", "proc", "sys", "run", "tmp", "var/tmp", "var/log", "etc/ssh"):
            (destination / relative).mkdir(parents=True)
        (destination / "etc/machine-id").write_bytes(b"")
        (destination / "etc/shadow").write_text("root:!:::::::\nomarchy:!:::::::\n", encoding="utf-8")
        theme = destination / "home/omarchy/.local/state/omarchy/current/theme"
        theme.mkdir(parents=True)
        for name in ("foot.ini", "hyprland.lua", "colors.toml"):
            (theme / name).write_text("synthetic theme\n", encoding="utf-8")

    def _build(self, output: Path | None = None, **kwargs: object) -> object:
        return builder.build(
            self.source,
            output or self.root / "output",
            self.selection,
            self.overlays,
            **kwargs,
        )

    def test_requires_rootful_linux_container(self) -> None:
        output = self.root / "output"
        with mock.patch.object(builder.sys, "platform", "darwin"):
            with self.assertRaisesRegex(ValueError, "rootful Linux image tooling container"):
                self._build(output)
        self.assertFalse(output.exists())

        with mock.patch.object(builder.sys, "platform", "linux"), mock.patch.object(builder.os, "geteuid", return_value=1000):
            with self.assertRaisesRegex(ValueError, "rootful Linux image tooling container"):
                self._build(output)
        self.assertFalse(output.exists())

    def test_source_and_output_must_be_real_non_symlink_paths(self) -> None:
        source_link = self.root / "source-link"
        source_link.symlink_to(self.source, target_is_directory=True)
        output = self.root / "output"
        with mock.patch.object(builder.sys, "platform", "linux"), mock.patch.object(builder.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(ValueError, "real absolute, non-root paths"):
                builder.build(source_link, output, self.selection, self.overlays)

        output_target = self.root / "output-target"
        output_link = self.root / "output-link"
        output_link.symlink_to(output_target, target_is_directory=True)
        with mock.patch.object(builder.sys, "platform", "linux"), mock.patch.object(builder.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(ValueError, "real absolute, non-root paths"):
                self._build(output_link)
        self.assertFalse(output_target.exists())

    def test_reused_output_is_refused_without_mutation(self) -> None:
        output = self.root / "output"
        output.mkdir()
        sentinel = output / "keep-me"
        sentinel.write_text("untouched\n", encoding="utf-8")
        with mock.patch.object(builder.sys, "platform", "linux"), mock.patch.object(builder.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(ValueError, "output must be a new directory"):
                self._build(output)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "untouched\n")
        self.assertEqual(sorted(path.name for path in output.iterdir()), ["keep-me"])

    def test_selection_versions_and_reviewed_overlay_paths_match_assembly(self) -> None:
        output = self.root / "output"
        with mock.patch.object(builder.sys, "platform", "linux"), mock.patch.object(builder.os, "geteuid", return_value=0):
            self.selection.write_text(json.dumps({"versions": {"demo": "2.0"}}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "package selection differs"):
                self._build(output)
            self.assertFalse(output.exists())

            self.selection.write_text(json.dumps({"versions": {"demo": "1.0"}}), encoding="utf-8")
            self.overlays.write_text(json.dumps({"entries": [{"path": "/usr/bin/demo"}]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "reviewed overlays differ"):
                self._build(output)
            self.assertFalse(output.exists())

    def test_completed_redacted_assembly_and_disposable_marker_are_required(self) -> None:
        output = self.root / "output"
        invalid_assemblies = (
            {"schema": 2, "kind": "omarchy-package-assembly"},
            {"schema": 1, "kind": "other"},
            {"schema": 1, "kind": "omarchy-package-assembly", "excluded_paths": []},
        )
        with mock.patch.object(builder.sys, "platform", "linux"), mock.patch.object(builder.os, "geteuid", return_value=0):
            for invalid in invalid_assemblies:
                with self.subTest(assembly=invalid):
                    self._write_assembly(**invalid)
                    with self.assertRaisesRegex(ValueError, "completed, redacted package assembly"):
                        self._build(output)
                    self.assertFalse(output.exists())

            self._write_assembly()
            with self.assertRaisesRegex(RuntimeError, "disposable-root marker"):
                self._build(output)
            self.assertFalse(output.exists())

    def test_valid_metadata_and_marker_reach_setup_without_running_image_tools(self) -> None:
        self._mark_source()
        output = self.root / "output"

        fake_sanitizer = types.SimpleNamespace(
            __file__=str(MODULE_PATH),
            _require_input=mock.Mock(),
            _preflight_source=mock.Mock(),
        )
        fake_configurator = types.SimpleNamespace(configure=mock.Mock())

        def fake_load(name: str) -> object:
            return {"sanitize-omarchy": fake_sanitizer, "configure-omarchy-demo": fake_configurator}[name]

        def stop_before_tools(source: Path, destination: Path) -> None:
            destination.mkdir()
            raise RuntimeError("synthetic stop before image tools")

        fake_sanitizer.sanitize = stop_before_tools
        with (
            mock.patch.object(builder.sys, "platform", "linux"),
            mock.patch.object(builder.os, "geteuid", return_value=0),
            mock.patch.object(builder, "load", side_effect=fake_load),
        ):
            with self.assertRaisesRegex(RuntimeError, "synthetic stop"):
                self._build(output, image_mib=3072)

        fake_sanitizer._require_input.assert_called_once_with(self.source)
        fake_sanitizer._preflight_source.assert_called_once_with(self.source)
        self.assertTrue(output.is_dir())
        self.assertFalse((output / "build-receipt.json").exists())

    def test_bad_image_sizes_are_rejected_before_output_creation(self) -> None:
        self._mark_source()
        output = self.root / "output"
        fake_sanitizer = types.SimpleNamespace(_require_input=mock.Mock(), _preflight_source=mock.Mock())
        with (
            mock.patch.object(builder.sys, "platform", "linux"),
            mock.patch.object(builder.os, "geteuid", return_value=0),
            mock.patch.object(builder, "load", return_value=fake_sanitizer),
        ):
            for image_mib in (3071, 8193):
                with self.subTest(image_mib=image_mib):
                    with self.assertRaisesRegex(ValueError, "image size must be 3072..8192 MiB"):
                        self._build(output, image_mib=image_mib)
                    self.assertFalse(output.exists())

    def test_nested_source_and_output_trees_are_refused(self) -> None:
        self._mark_source()
        output_inside_source = self.source / "nested-output"
        with mock.patch.object(builder.sys, "platform", "linux"), mock.patch.object(builder.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(ValueError, "source and output must be separate"):
                self._build(output_inside_source)
        self.assertFalse(output_inside_source.exists())

        outer = self.root / "outer"
        nested_source = outer / "nested-source"
        nested_source.mkdir(parents=True)
        nested_assembly = nested_source / "etc/wasm-vm/omarchy-assembly.json"
        nested_assembly.parent.mkdir(parents=True)
        nested_assembly.write_text(json.dumps({"schema": 1, "kind": "omarchy-package-assembly"}), encoding="utf-8")
        self._mark_source()
        output_outer = outer
        with mock.patch.object(builder.sys, "platform", "linux"), mock.patch.object(builder.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(ValueError, "source and output must be separate"):
                builder.build(nested_source, output_outer, self.selection, self.overlays)

    def test_setup_failure_retains_private_diagnostics_without_success_receipt(self) -> None:
        self._mark_source()
        output = self.root / "output"

        class FakeSanitizer:
            __file__ = str(MODULE_PATH)

            @staticmethod
            def _require_input(source: Path) -> None:
                self.assertEqual(source, self.source)

            @staticmethod
            def _preflight_source(source: Path) -> None:
                self.assertEqual(source, self.source)

            @staticmethod
            def sanitize(source: Path, destination: Path) -> None:
                del source
                self._populate_synthetic_sanitized_root(destination)

        class FakeConfigurator:
            @staticmethod
            def configure(root: Path) -> None:
                self.assertTrue(root.is_dir())

        calls: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> types.SimpleNamespace:
            calls.append([str(item) for item in command])
            # Let both mounts succeed, then fail during the first chroot so the
            # finally block must attempt both unmounts in reverse order.
            return types.SimpleNamespace(returncode=1 if command[0] == "chroot" else 0)

        def fake_mknod(path: Path, mode: int, device: int) -> None:
            del mode, device
            path.touch()

        def fake_load(name: str) -> object:
            return {"sanitize-omarchy": FakeSanitizer, "configure-omarchy-demo": FakeConfigurator}[name]

        with (
            mock.patch.object(builder.sys, "platform", "linux"),
            mock.patch.object(builder.os, "geteuid", return_value=0),
            mock.patch.object(builder, "load", side_effect=fake_load),
            mock.patch.object(builder.subprocess, "run", side_effect=fake_run),
            mock.patch.object(builder.os, "mknod", side_effect=fake_mknod),
            mock.patch.object(builder.os.path, "ismount", return_value=False),
        ):
            with self.assertRaisesRegex(RuntimeError, r"command 3 failed"):
                self._build(output, image_mib=3072)

        self.assertTrue(output.is_dir())
        self.assertTrue((output / "commands.log").is_file())
        self.assertFalse((output / "build-receipt.json").exists())
        unmounts = [command for command in calls if command[0] == "umount"]
        self.assertEqual(unmounts, [
            ["umount", str(output / "root" / "proc")],
            ["umount", str(output / "root" / "dev")],
        ])
        self.assertFalse(any(command[0] in {"mke2fs", "e2fsck"} for command in calls))

    def test_input_digest_drift_after_preparation_keeps_no_success_receipt(self) -> None:
        self._mark_source()
        output = self.root / "output"

        fake_sanitizer = types.SimpleNamespace(__file__=str(MODULE_PATH))
        fake_sanitizer._require_input = mock.Mock()
        fake_sanitizer._preflight_source = mock.Mock()
        fake_sanitizer.sanitize = lambda source, destination: self._populate_synthetic_sanitized_root(destination)

        def configure_and_drift(root: Path) -> None:
            self.assertTrue(root.is_dir())
            self.selection.write_text(json.dumps({"versions": {"demo": "drifted"}}), encoding="utf-8")

        fake_configurator = types.SimpleNamespace(configure=configure_and_drift)
        calls: list[list[str]] = []

        def fake_load(name: str) -> object:
            return {"sanitize-omarchy": fake_sanitizer, "configure-omarchy-demo": fake_configurator}[name]

        def fake_run(command: list[str], **_: object) -> types.SimpleNamespace:
            calls.append([str(item) for item in command])
            return types.SimpleNamespace(returncode=0)

        def fake_mknod(path: Path, mode: int, device: int) -> None:
            del mode, device
            path.touch()

        with (
            mock.patch.object(builder.sys, "platform", "linux"),
            mock.patch.object(builder.os, "geteuid", return_value=0),
            mock.patch.object(builder, "load", side_effect=fake_load),
            mock.patch.object(builder.subprocess, "run", side_effect=fake_run),
            mock.patch.object(builder.os, "mknod", side_effect=fake_mknod),
            mock.patch.object(builder.os.path, "ismount", return_value=False),
        ):
            with self.assertRaisesRegex(ValueError, "changed during preparation"):
                self._build(output, image_mib=3072)

        self.assertTrue(output.is_dir())
        self.assertTrue((output / "commands.log").is_file())
        self.assertFalse((output / "build-receipt.json").exists())
        self.assertFalse(any(command[0] in {"mke2fs", "e2fsck"} for command in calls))

    def test_input_digest_drift_after_mkfs_keeps_no_success_receipt(self) -> None:
        self._mark_source()
        output = self.root / "output"
        image = output / "omarchy.ext4"

        fake_sanitizer = types.SimpleNamespace(__file__=str(MODULE_PATH))
        fake_sanitizer._require_input = mock.Mock()
        fake_sanitizer._preflight_source = mock.Mock()
        fake_sanitizer.sanitize = lambda source, destination: self._populate_synthetic_sanitized_root(destination)
        fake_configurator = types.SimpleNamespace(configure=lambda root: self.assertTrue(root.is_dir()))
        calls: list[list[str]] = []

        def fake_load(name: str) -> object:
            return {"sanitize-omarchy": fake_sanitizer, "configure-omarchy-demo": fake_configurator}[name]

        def fake_run(command: list[str], **_: object) -> types.SimpleNamespace:
            calls.append([str(item) for item in command])
            if command[0] == "mke2fs":
                self.selection.write_text(json.dumps({"versions": {"demo": "mkfs-drift"}}), encoding="utf-8")
            return types.SimpleNamespace(returncode=0)

        def fake_mknod(path: Path, mode: int, device: int) -> None:
            del mode, device
            path.touch()

        real_open = Path.open

        class NonAllocatingCreate:
            def __init__(self, stream: object) -> None:
                self.stream = stream

            def __enter__(self) -> "NonAllocatingCreate":
                return self

            def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
                self.stream.close()

            def truncate(self, _: int) -> None:
                # The test needs the builder's admission ordering, not a
                # multi-gigabyte sparse-file allocation.
                self.stream.truncate(0)

        def safe_open(path: Path, mode: str = "r", *args: object, **kwargs: object) -> object:
            stream = real_open(path, mode, *args, **kwargs)
            if path == image and mode == "xb":
                return NonAllocatingCreate(stream)
            return stream

        with (
            mock.patch.object(builder.sys, "platform", "linux"),
            mock.patch.object(builder.os, "geteuid", return_value=0),
            mock.patch.object(builder, "load", side_effect=fake_load),
            mock.patch.object(builder.subprocess, "run", side_effect=fake_run),
            mock.patch.object(builder.os, "mknod", side_effect=fake_mknod),
            mock.patch.object(builder.os.path, "ismount", return_value=False),
            mock.patch.object(builder.Path, "open", new=safe_open),
        ):
            with self.assertRaisesRegex(ValueError, "changed during mkfs"):
                self._build(output, image_mib=3072)

        self.assertTrue(image.is_file())
        self.assertTrue(output.is_dir())
        self.assertFalse((output / "build-receipt.json").exists())
        self.assertEqual([command[0] for command in calls].count("mke2fs"), 1)
        self.assertEqual([command[0] for command in calls].count("e2fsck"), 1)


if __name__ == "__main__":
    unittest.main()
