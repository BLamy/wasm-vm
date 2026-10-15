"""Independent real-reader admission regressions for the native application image.

The tiny tar files are deliberately unsigned: preflight proves identity and paths,
not signature trust. The recorded native gpgv control covers cryptographic refusal.
No fixture invokes pacman, chroot, mounts, or the network.
"""
import copy
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest

SOURCE = Path(os.environ.get("OMARCHY_CRITIC_INSTALLER", Path(__file__).with_name("install-omarchy-apps.py")))
SPEC = importlib.util.spec_from_file_location("native_app_packaging_critic_subject", SOURCE)
subject = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(subject)


@unittest.skipUnless(shutil.which("bsdtar"), "actual bsdtar required; Linux image-tool gate executes this class")
class RealArchiveAdmission(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="native-app-critic-")
        self.root = Path(self.temporary.name)
        self.records = []
        for name in ("chromium", "libreoffice-fresh", "nodejs", "npm"):
            archive = name + "-7-3-riscv64.pkg.tar.zst"
            self.records.append({"name": name, "version": "7-3", "archive": archive,
                                 "architecture": "riscv64", "repository": "extra",
                                 "url": "https://riscv.mirror.pkgbuild.com/repo/extra/" + archive})
            self.write_archive(self.records[-1])
        self.lock = {"schema": 1, "kind": "omarchy-native-app-archives", "architecture": "riscv64", "packages": self.records}

    def tearDown(self):
        self.temporary.cleanup()

    def write_archive(self, record, member="usr/bin/fixture", metadata=None):
        info = metadata or {"pkgname": record["name"], "pkgver": record["version"], "arch": record["architecture"]}
        path = self.root / record["archive"]
        with tarfile.open(path, "w", format=tarfile.USTAR_FORMAT) as stream:
            for name, data in ((".PKGINFO", "".join(k + " = " + v + "\n" for k, v in info.items()).encode()),
                               (member, b"read-only fixture payload\n")):
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                stream.addfile(entry, io.BytesIO(data))
        signature = path.with_name(path.name + ".sig")
        signature.write_bytes(b"explicit unsigned preflight fixture\n")
        record.update(bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                      signatureBytes=signature.stat().st_size,
                      signatureSha256=hashlib.sha256(signature.read_bytes()).hexdigest())

    def test_real_archive_reader_positive(self):
        self.assertEqual(subject.preflight(self.lock, self.root), self.records)

    def test_real_reader_relative_and_absolute_escape(self):
        for member in ("../outside", "usr/bin/../../../outside", "/absolute"):
            with self.subTest(member=member):
                self.write_archive(self.records[0], member=member)
                with self.assertRaisesRegex(ValueError, "unsafe archive member"):
                    subject.preflight(self.lock, self.root)

    def test_rehashed_real_metadata_still_must_match_lock(self):
        base = {"pkgname": "chromium", "pkgver": "7-3", "arch": "riscv64"}
        for field, value in (("pkgname", "not-chromium"), ("pkgver", "8-1"), ("arch", "x86_64")):
            with self.subTest(field=field):
                metadata = dict(base, **{field: value})
                self.write_archive(self.records[0], metadata=metadata)
                with self.assertRaisesRegex(ValueError, "actual archive metadata mismatch"):
                    subject.preflight(self.lock, self.root)

    def test_changed_payload_and_signature_refuse_old_identity(self):
        for suffix in ("", ".sig"):
            with self.subTest(suffix=suffix):
                path = self.root / (self.records[0]["archive"] + suffix)
                original = path.read_bytes()
                path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
                with self.assertRaisesRegex(ValueError, "archive/signature identity mismatch"):
                    subject.preflight(self.lock, self.root)
                path.write_bytes(original)

    def test_symlink_even_to_identical_owned_file_is_not_archive(self):
        path = self.root / self.records[0]["archive"]
        real = self.root / "unchanged-owned-body"
        path.rename(real)
        path.symlink_to(real)
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            subject.preflight(self.lock, self.root)

    def test_lock_url_repository_arch_and_duplicate(self):
        for field, value, reason in (("url", "https://example.invalid/a", "unexpected package source"),
                                     ("repository", "foreign", "wrong architecture or repository"),
                                     ("architecture", "x86_64", "wrong architecture or repository"),
                                     ("archive", "../escape.pkg.tar.zst", "unsafe archive filename")):
            with self.subTest(field=field):
                lock = copy.deepcopy(self.lock)
                lock["packages"][0][field] = value
                with self.assertRaisesRegex(ValueError, reason):
                    subject.preflight(lock, self.root)
        lock = copy.deepcopy(self.lock)
        lock["packages"].append(copy.deepcopy(lock["packages"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate or invalid"):
            subject.preflight(lock, self.root)


class NativeElfInventory(unittest.TestCase):
    def test_native_headers_positive_then_foreign_runtime_refusal(self):
        with tempfile.TemporaryDirectory(prefix="native-elf-critic-") as directory:
            root = Path(directory)
            paths = ("usr/lib/chromium/chromium", "usr/lib/libreoffice/program/soffice.bin", "usr/bin/node")
            for relative in paths:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                header = bytearray(64)
                header[:6] = b"\x7fELF\x02\x01"
                header[16:18] = (3).to_bytes(2, "little")
                header[18:20] = (243).to_bytes(2, "little")
                path.write_bytes(header)
            self.assertEqual(len(subject.elf_inventory(root)), 3)
            foreign = root / "opt/foreign.so"
            foreign.parent.mkdir()
            header[18:20] = (62).to_bytes(2, "little")
            foreign.write_bytes(header)
            with self.assertRaisesRegex(ValueError, "non-RISC-V runtime ELF: opt/foreign.so"):
                subject.elf_inventory(root)


class DownloadCacheAdmission(unittest.TestCase):
    def fetcher(self):
        spec = importlib.util.spec_from_file_location("native_app_critic_fetcher", Path(__file__).with_name("fetch-omarchy-app-packages.py"))
        result = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(result)
        return result

    def record(self):
        filename = "fixture-7-3-riscv64.pkg.tar.zst"
        return {"name": "fixture", "archive": filename, "repository": "extra",
                "url": "https://riscv.mirror.pkgbuild.com/repo/extra/" + filename,
                "bytes": 3, "sha256": hashlib.sha256(b"pkg").hexdigest(),
                "signatureBytes": 3, "signatureSha256": hashlib.sha256(b"sig").hexdigest()}

    def test_real_existing_cache_identity_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory(prefix="app-cache-critic-") as directory:
            root = Path(directory)
            record = self.record()
            archive = root / record["archive"]
            archive.write_bytes(b"pkg")
            archive.with_name(archive.name + ".sig").write_bytes(b"sig")
            fetcher = self.fetcher()
            self.assertEqual(fetcher.fetch(record, root)["sha256"], record["sha256"])
            archive.write_bytes(b"bad")
            with self.assertRaisesRegex(ValueError, "existing cache identity mismatch"):
                fetcher.fetch(record, root)
            archive.unlink()
            target = root / "owned-sentinel"
            target.write_bytes(b"pkg")
            archive.symlink_to(target)
            with self.assertRaisesRegex(ValueError, "symlinked cache file"):
                fetcher.fetch(record, root)
            self.assertEqual(target.read_bytes(), b"pkg")

    def test_inherited_partial_file_or_symlink_cannot_be_truncated(self):
        with tempfile.TemporaryDirectory(prefix="app-partial-critic-") as directory:
            root = Path(directory)
            record = self.record()
            partial = root / (record["archive"] + ".partial")
            sentinel = root / "owned-sentinel"
            sentinel.write_bytes(b"must remain exact")
            for symlink in (False, True):
                with self.subTest(symlink=symlink):
                    if symlink:
                        partial.symlink_to(sentinel)
                    else:
                        partial.write_bytes(b"existing partial")
                    with self.assertRaises(FileExistsError):
                        self.fetcher().fetch(record, root)
                    self.assertEqual(sentinel.read_bytes(), b"must remain exact")
                    self.assertFalse((root / record["archive"]).exists())
                    if not symlink:
                        self.assertEqual(partial.read_bytes(), b"existing partial")
                    partial.unlink()


if __name__ == "__main__":
    unittest.main()
