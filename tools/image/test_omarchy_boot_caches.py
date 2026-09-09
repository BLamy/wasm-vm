"""Cache generation must succeed before systemd update stamps are admitted."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("omarchy_cache_builder", Path(__file__).with_name("build-omarchy-image.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BootCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.calls = []

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, relative, content=b"generated\n"):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def command(self, *args):
        self.calls.append(args)
        if "systemd-hwdb" == Path(args[2]).name:
            self.write("usr/lib/udev/hwdb.bin")
        elif "journalctl" == Path(args[2]).name:
            self.write("var/lib/systemd/catalog/database")
        elif "systemd-update-done" == Path(args[2]).name:
            self.write("etc/.updated")
            self.write("var/.updated")

    def test_caches_precede_completion(self):
        self.write("etc/ld.so.cache")
        builder.prepare_boot_caches(self.root, self.command)
        self.assertEqual([Path(c[2]).name for c in self.calls], ["systemd-hwdb", "journalctl", "systemd-update-done"])

    def test_missing_or_empty_cache_never_stamps_success(self):
        for empty in [False, True]:
            with self.subTest(empty=empty):
                if empty:
                    self.write("etc/ld.so.cache", b"")
                with self.assertRaisesRegex(ValueError, "required package cache"):
                    builder.prepare_boot_caches(self.root, self.command)
                self.assertFalse((self.root / "etc/.updated").exists())

    def test_symlink_cache_refused(self):
        self.write("outside")
        (self.root / "etc").mkdir()
        (self.root / "etc/ld.so.cache").symlink_to(self.root / "outside")
        with self.assertRaisesRegex(ValueError, "required package cache"):
            builder.prepare_boot_caches(self.root, self.command)
        self.assertFalse((self.root / "etc/.updated").exists())

    def test_cache_command_failure_propagates(self):
        def fail(*args):
            raise RuntimeError("cache generation failed")
        with self.assertRaisesRegex(RuntimeError, "cache generation failed"):
            builder.prepare_boot_caches(self.root, fail)
        self.assertFalse((self.root / "etc/.updated").exists())

    def test_success_exit_without_update_stamps_rejected(self):
        self.write("etc/ld.so.cache")
        def no_stamps(*args):
            if Path(args[2]).name != "systemd-update-done":
                self.command(*args)
        with self.assertRaisesRegex(ValueError, "completion was not recorded"):
            builder.prepare_boot_caches(self.root, no_stamps)


if __name__ == "__main__":
    unittest.main()
