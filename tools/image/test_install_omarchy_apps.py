"""Archive admission guard tests; successful signature proof uses real libalpm."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("install_omarchy_apps", Path(__file__).with_name("install-omarchy-apps.py"))
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class ArchiveAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.records = []
        for name in ("chromium", "libreoffice-fresh", "nodejs", "npm"):
            filename = name + "-1-1-riscv64.pkg.tar.zst"
            data, signature = ("fixture: " + name).encode(), b"not an authenticated signature"
            (self.root / filename).write_bytes(data)
            (self.root / (filename + ".sig")).write_bytes(signature)
            self.records.append({"name": name, "archive": filename, "version": "1-1", "architecture": "riscv64",
                                 "repository": "extra", "url": "https://riscv.mirror.pkgbuild.com/repo/extra/" + filename,
                                 "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                                 "signatureBytes": len(signature), "signatureSha256": hashlib.sha256(signature).hexdigest()})
        self.lock = {"schema": 1, "kind": "omarchy-native-app-archives", "architecture": "riscv64", "packages": self.records}

    def tearDown(self):
        self.temporary.cleanup()

    def metadata(self, command, **kwargs):
        if command[1] == "-tf":
            return b".PKGINFO\nusr/bin/application\n"
        name = next(record["name"] for record in self.records if record["archive"] == Path(command[2]).name)
        return f"pkgname = {name}\npkgver = 1-1\narch = riscv64\n".encode()

    def test_preflight_only_checks_identity_not_signature_trust(self):
        with mock.patch.object(installer.subprocess, "check_output", side_effect=self.metadata):
            self.assertEqual(installer.preflight(self.lock, self.root), self.records)

    def test_archive_escape_is_rejected_before_archive_reader(self):
        self.records[0]["archive"] = "../outside.pkg.tar.zst"
        with mock.patch.object(installer.subprocess, "check_output") as reader:
            with self.assertRaisesRegex(ValueError, "unsafe archive filename"):
                installer.preflight(self.lock, self.root)
        reader.assert_not_called()

    def test_wrong_architecture_is_rejected_before_archive_reader(self):
        self.records[0]["architecture"] = "x86_64"
        with mock.patch.object(installer.subprocess, "check_output") as reader:
            with self.assertRaisesRegex(ValueError, "wrong architecture"):
                installer.preflight(self.lock, self.root)
        reader.assert_not_called()

    def test_modified_archive_or_signature_is_rejected(self):
        for suffix in ("", ".sig"):
            with self.subTest(suffix=suffix):
                path = self.root / (self.records[0]["archive"] + suffix)
                original = path.read_bytes()
                path.write_bytes(bytes([original[0] ^ 1]) + original[1:])
                with self.assertRaisesRegex(ValueError, "identity mismatch"):
                    installer.preflight(self.lock, self.root)
                path.write_bytes(original)

    def test_symlinked_archive_is_rejected(self):
        path = self.root / self.records[0]["archive"]
        real = self.root / "external"
        path.rename(real)
        path.symlink_to(real)
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            installer.preflight(self.lock, self.root)

    def test_actual_package_metadata_cannot_be_renamed(self):
        with mock.patch.object(installer.subprocess, "check_output", return_value=b"pkgname = firefox\npkgver = 1-1\narch = riscv64\n"):
            with self.assertRaisesRegex(ValueError, "actual archive metadata mismatch"):
                installer.preflight(self.lock, self.root)

    def test_archive_member_cannot_escape_root(self):
        for member in (b"../../outside\n", b"/absolute\n", b"usr/bin/../../../outside\n"):
            with self.subTest(member=member), mock.patch.object(installer.subprocess, "check_output", return_value=member):
                with self.assertRaisesRegex(ValueError, "unsafe archive member"):
                    installer.preflight(self.lock, self.root)

    def test_duplicate_archive_or_omitted_priority_is_rejected(self):
        with mock.patch.object(installer.subprocess, "check_output", side_effect=self.metadata):
            self.lock["packages"] = self.records + [copy.deepcopy(self.records[0])]
            with self.assertRaisesRegex(ValueError, "duplicate or invalid"):
                installer.preflight(self.lock, self.root)
            self.lock["packages"] = self.records[:-1]
            with self.assertRaisesRegex(ValueError, "priority applications are mandatory"):
                installer.preflight(self.lock, self.root)

    def test_foreign_runtime_elf_is_rejected(self):
        path = self.root / "usr/lib/foreign.so"
        path.parent.mkdir(parents=True)
        header = bytearray(64)
        header[:6] = b"\x7fELF\x02\x01"
        header[16:18] = (3).to_bytes(2, "little")
        header[18:20] = (62).to_bytes(2, "little")
        path.write_bytes(header)
        with self.assertRaisesRegex(ValueError, "non-RISC-V runtime ELF"):
            installer.elf_inventory(self.root)


if __name__ == "__main__":
    unittest.main()
