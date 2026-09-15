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
        self.assertEqual(self.calls, [
            ("chroot", self.root, "/usr/bin/systemd-hwdb", "update", "--usr", "--strict"),
            ("chroot", self.root, "/usr/bin/journalctl", "--update-catalog"),
            ("chroot", self.root, "/usr/lib/systemd/systemd-update-done"),
        ])

    def test_each_cache_and_stamp_rejects_missing_empty_directory_or_symlink(self):
        caches = ("etc/ld.so.cache", "usr/lib/udev/hwdb.bin", "var/lib/systemd/catalog/database")
        stamps = ("etc/.updated", "var/.updated")
        for relative in caches + stamps:
            for fault in ("missing", "empty", "directory", "symlink"):
                with self.subTest(path=relative, fault=fault), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory).resolve()
                    calls = []
                    for name in caches:
                        path = root / name
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(b"independent cache fixture\n")

                    def corrupt():
                        path = root / relative
                        path.unlink()
                        if fault == "empty":
                            path.touch()
                        elif fault == "directory":
                            path.mkdir()
                        elif fault == "symlink":
                            target = root / "outside-sentinel"
                            target.write_bytes(b"sentinel\n")
                            path.symlink_to(target)

                    if relative in caches:
                        corrupt()

                    def run(*args):
                        calls.append(args)
                        if args[2] == "/usr/lib/systemd/systemd-update-done":
                            for name in stamps:
                                path = root / name
                                path.parent.mkdir(parents=True, exist_ok=True)
                                path.write_bytes(b"completed\n")
                            if relative in stamps:
                                corrupt()

                    message = "required package cache" if relative in caches else "completion was not recorded"
                    with self.assertRaisesRegex(ValueError, message):
                        builder.prepare_boot_caches(root, run)
                    if relative in caches:
                        self.assertEqual(len(calls), 2)
                        self.assertFalse((root / "etc/.updated").exists())
                        self.assertFalse((root / "var/.updated").exists())
                    if fault == "symlink":
                        self.assertEqual((root / "outside-sentinel").read_bytes(), b"sentinel\n")

    def test_failure_at_each_command_stops_the_sequence(self):
        for failed_index in range(3):
            with self.subTest(failed_index=failed_index), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                for name in ("etc/ld.so.cache", "usr/lib/udev/hwdb.bin", "var/lib/systemd/catalog/database"):
                    path = root / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"cache\n")
                calls = []

                def run(*args):
                    calls.append(args)
                    if len(calls) == failed_index + 1:
                        raise RuntimeError("injected command failure")

                with self.assertRaisesRegex(RuntimeError, "injected command failure"):
                    builder.prepare_boot_caches(root, run)
                self.assertEqual(len(calls), failed_index + 1)
                self.assertFalse((root / "etc/.updated").exists())
                self.assertFalse((root / "var/.updated").exists())

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
