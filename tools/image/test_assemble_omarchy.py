#!/usr/bin/env python3
"""Synthetic, no-VM tests for the package-bound Omarchy assembler."""

from __future__ import annotations

import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("assemble-omarchy.py")
SPEC = importlib.util.spec_from_file_location("assemble_omarchy", MODULE_PATH)
assert SPEC and SPEC.loader
assembler = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = assembler
SPEC.loader.exec_module(assembler)


class AssembleTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_parent = "/private/tmp" if Path("/private/tmp").is_dir() else None
        self.temp = tempfile.TemporaryDirectory(prefix="assemble-omarchy-test-", dir=temp_parent)
        self.root = Path(self.temp.name)
        self.source = self.root / "mounted-read-only-root"
        self.source.mkdir()
        self.staging = self.root / "staging"
        self.staging.mkdir()
        (self.staging / assembler.STAGING_MARKER).write_bytes(assembler.STAGING_MARKER_CONTENT)
        self.profile = self.root / "packages.json"
        self.profile.write_text(json.dumps({"schema": 1, "packages": ["demo"], "versions": {"demo": "1.0"}, "installedBytes": 1234}), encoding="utf-8")
        self._write("usr/bin/demo", b"demo-binary\n", 0o755)
        self._write("usr/share/space file", b"space-name\n")
        self._write("usr/share/omarchy-link", b"", 0o777)
        (self.source / "usr/share/omarchy-link").unlink()
        os.symlink("../bin/demo", self.source / "usr/share/omarchy-link")
        self._write("opt/omarchy/app", b"packaged-app\n", 0o755)
        self._write("etc/omarchy-default.conf", b"safe-default=true\n", 0o644)
        self._write("etc/passwd", b"root:x:0:0:root:/root:/bin/bash\nblamy:x:1000:1000:x:/home/blamy:/bin/bash\n")
        self._write("home/blamy/secret", b"HOME-SECRET-SENTINEL\n")
        self._write("root/secret", b"ROOT-SECRET-SENTINEL\n")
        self._write("var/log/secret", b"LOG-SECRET-SENTINEL\n")
        self._write("var/lib/pacman/local/demo-1.0/desc", b"%NAME%\ndemo\n\n%VERSION%\n1.0\n")
        self._write("var/lib/pacman/local/demo-1.0/files", b"%FILES%\nusr/bin/demo\n")
        self._write("var/lib/pacman/local/demo-1.0/install", b"INSTALL-SCRIPT-SENTINEL\n")
        self._write("var/lib/pacman/local/ALPM_DB_VERSION", b"9\n")
        self._write_mtree()
        self._clear_host_xattrs()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write(self, relative: str, data: bytes, mode: int = 0o644) -> None:
        path = self.source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(mode)

    def _mtree(self) -> list[str]:
        demo_hash = hashlib.sha256(b"demo-binary\n").hexdigest()
        app_hash = hashlib.sha256(b"packaged-app\n").hexdigest()
        etc_hash = hashlib.sha256(b"safe-default=true\n").hexdigest()
        space_hash = hashlib.sha256(b"space-name\n").hexdigest()
        return [
            "#mtree",
            "/set uid=0 gid=0 mode=0755",
            "./usr type=dir",
            "./usr/bin type=dir",
            f"./usr/bin/demo type=file mode=0755 sha256digest={demo_hash}",
            "./usr/share type=dir",
            f"./usr/share/space\\040file type=file mode=0644 sha256digest={space_hash}",
            "./usr/share/omarchy-link type=link link=../bin/demo",
            "./opt type=dir",
            f"./opt/omarchy/app type=file mode=0755 sha256digest={app_hash}",
            "./etc type=dir",
            f"./etc/omarchy-default.conf type=file mode=0644 sha256digest={etc_hash}",
            "./.BUILDINFO type=file sha256digest=" + "0" * 64,
            "./.PKGINFO type=file sha256digest=" + "0" * 64,
            "./.INSTALL type=file sha256digest=" + "0" * 64,
            "./.MTREE type=file sha256digest=" + "0" * 64,
        ]

    def _write_mtree(self) -> None:
        path = self.source / "var/lib/pacman/local/demo-1.0/mtree"
        with gzip.open(path, "wt", encoding="utf-8") as stream:
            stream.write("\n".join(self._mtree()) + "\n")

    def _clear_host_xattrs(self) -> None:
        tool = Path("/usr/bin/xattr")
        if not tool.is_file():
            return
        for path in [self.source, *sorted(self.source.rglob("*"))]:
            subprocess.run([os.fspath(tool), "-c", "-s", os.fspath(path)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _run(self, staging: Path | None = None, *extra: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = assembler.main([str(self.source), str(staging or self.staging), "--packages", str(self.profile), *extra])
        return code, out.getvalue(), err.getvalue()

    def test_assembles_only_verified_package_content_and_metadata(self) -> None:
        code, stdout, stderr = self._run()
        self.assertEqual(code, 0, stderr)
        self.assertEqual(stdout, "assemble-omarchy: staging ready\n")
        self.assertEqual(stderr, "")
        self.assertEqual((self.staging / "usr/bin/demo").read_bytes(), b"demo-binary\n")
        self.assertEqual((self.staging / "usr/share/space file").read_bytes(), b"space-name\n")
        self.assertEqual(os.readlink(self.staging / "usr/share/omarchy-link"), "../bin/demo")
        self.assertEqual((self.staging / "opt/omarchy/app").read_bytes(), b"packaged-app\n")
        self.assertEqual((self.staging / "etc/omarchy-default.conf").read_bytes(), b"safe-default=true\n")
        self.assertFalse((self.staging / "home").exists())
        self.assertFalse((self.staging / "root").exists())
        self.assertFalse((self.staging / "var/log").exists())
        self.assertFalse((self.staging / "var/lib/pacman/local/demo-1.0/install").exists())
        self.assertTrue((self.staging / "var/lib/pacman/local/demo-1.0/desc").is_file())
        self.assertTrue((self.staging / "var/lib/pacman/local/demo-1.0/files").is_file())
        self.assertTrue((self.staging / "var/lib/pacman/local/demo-1.0/mtree").is_file())
        self.assertEqual((self.staging / assembler.PACKAGES_TSV_PATH).read_text(), "name\tversion\ndemo\t1.0\n")
        provenance = json.loads((self.staging / assembler.PROVENANCE_PATH).read_text())
        self.assertEqual(provenance["packages"], [{"name": "demo", "version": "1.0"}])
        self.assertEqual(provenance["profile"], "default")
        self.assertEqual(provenance["installed_bytes"], 1234)
        self.assertIsInstance(provenance["metadata_mismatches"], list)
        self.assertNotIn("HOME-SECRET-SENTINEL", stdout + stderr)
        self.assertNotIn("INSTALL-SCRIPT-SENTINEL", stdout + stderr)

    def test_modified_package_file_fails_before_staging_mutation(self) -> None:
        (self.source / "usr/bin/demo").write_bytes(b"MODIFIED-PACKAGE-SENTINEL\n")
        before = sorted(path.relative_to(self.staging).as_posix() for path in self.staging.iterdir())
        code, stdout, stderr = self._run()
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        self.assertIn("usr/bin/demo", stderr)
        self.assertNotIn("MODIFIED-PACKAGE-SENTINEL", stderr)
        self.assertEqual(before, [assembler.STAGING_MARKER])

    def test_reviewed_overlay_allows_only_matching_changed_hash(self) -> None:
        changed = b"REVIEWED-OVERLAY-CONTENT\n"
        (self.source / "usr/bin/demo").write_bytes(changed)
        overlay = self.root / "overlay.json"
        overlay.write_text(json.dumps({"schema": 1, "entries": [{"path": "/usr/bin/demo", "sha256": hashlib.sha256(changed).hexdigest()}]}), encoding="utf-8")
        code, _, stderr = self._run(self.staging, "--overlay", str(overlay))
        self.assertEqual(code, 0, stderr)
        self.assertEqual((self.staging / "usr/bin/demo").read_bytes(), changed)
        provenance = json.loads((self.staging / assembler.PROVENANCE_PATH).read_text())
        self.assertEqual(provenance["overlays"], ["usr/bin/demo"])

    def test_unknown_etc_file_is_recorded_and_mutable_identity_is_omitted(self) -> None:
        self._write("etc/private-config", b"PRIVATE-CONFIG-SENTINEL\n")
        code, _, stderr = self._run()
        self.assertEqual(code, 0, stderr)
        provenance = json.loads((self.staging / assembler.PROVENANCE_PATH).read_text())
        self.assertGreater(provenance["excluded_path_count"], 0)
        self.assertNotIn("etc/private-config", json.dumps(provenance))
        self.assertFalse((self.staging / "etc/passwd").exists())

    def test_symlink_escape_and_special_file_fail_closed(self) -> None:
        (self.source / "usr/share/omarchy-link").unlink()
        os.symlink("../../outside", self.source / "usr/share/omarchy-link")
        code, _, stderr = self._run()
        self.assertEqual(code, 2)
        self.assertIn("usr/share/omarchy-link", stderr)
        self.assertEqual(list(self.staging.iterdir()), [self.staging / assembler.STAGING_MARKER])

    def test_explicit_profile_records_exclusions(self) -> None:
        docs = b"docs\n"
        self._write("usr/share/doc/demo/readme", docs)
        digest = hashlib.sha256(docs).hexdigest()
        lines = self._mtree() + ["./usr/share/doc type=dir", "./usr/share/doc/demo type=dir", f"./usr/share/doc/demo/readme type=file sha256digest={digest}"]
        with gzip.open(self.source / "var/lib/pacman/local/demo-1.0/mtree", "wt", encoding="utf-8") as stream:
            stream.write("\n".join(lines) + "\n")
        code, _, stderr = self._run(self.staging, "--profile", "omit-docs-man-cache-boot-modules")
        self.assertEqual(code, 0, stderr)
        self.assertFalse((self.staging / "usr/share/doc/demo/readme").exists())
        provenance = json.loads((self.staging / assembler.PROVENANCE_PATH).read_text())
        self.assertEqual(provenance["exclusions"], ["usr/share/doc", "usr/share/man", "usr/share/info", "usr/share/cache", "usr/lib/modules", "boot"])

    def test_staging_must_be_initially_empty_and_marked(self) -> None:
        bad = self.root / "bad-staging"
        bad.mkdir()
        (bad / assembler.STAGING_MARKER).write_bytes(assembler.STAGING_MARKER_CONTENT)
        (bad / "sentinel").write_text("untouched", encoding="utf-8")
        code, _, stderr = self._run(bad)
        self.assertEqual(code, 2)
        self.assertIn("new marked directory", stderr)
        self.assertEqual((bad / "sentinel").read_text(), "untouched")

    def test_missing_dependency_and_version_mismatch_are_reported(self) -> None:
        desc = self.source / "var/lib/pacman/local/demo-1.0/desc"
        desc.write_text("%NAME%\ndemo\n\n%VERSION%\n1.0\n\n%DEPENDS%\nmissing-runtime\n", encoding="utf-8")
        code, _, stderr = self._run()
        self.assertEqual(code, 2)
        self.assertIn("missing dependency: demo->missing-runtime", stderr)
        desc.write_text("%NAME%\ndemo\n\n%VERSION%\n1.0\n", encoding="utf-8")
        self.profile.write_text(json.dumps({"schema": 1, "packages": ["demo"], "versions": {"demo": "9.9"}}), encoding="utf-8")
        code, _, stderr = self._run()
        self.assertEqual(code, 2)
        self.assertIn("version mismatch: demo", stderr)

    def test_unselected_installed_package_is_not_imported(self) -> None:
        self._write("usr/share/nonselected", b"NONSELECTED-PACKAGE-SENTINEL\n")
        package_dir = self.source / "var/lib/pacman/local/extra-1.0"
        package_dir.mkdir(parents=True)
        (package_dir / "desc").write_text("%NAME%\nextra\n\n%VERSION%\n1.0\n", encoding="utf-8")
        (package_dir / "files").write_text("%FILES%\nusr/share/nonselected\n", encoding="utf-8")
        digest = hashlib.sha256(b"NONSELECTED-PACKAGE-SENTINEL\n").hexdigest()
        with gzip.open(package_dir / "mtree", "wt", encoding="utf-8") as stream:
            stream.write(f"./usr/share/nonselected type=file mode=0644 uid=0 gid=0 sha256digest={digest}\n")
        self._clear_host_xattrs()
        code, _, stderr = self._run()
        self.assertEqual(code, 0, stderr)
        self.assertFalse((self.staging / "usr/share/nonselected").exists())
        self.assertFalse((self.staging / "var/lib/pacman/local/extra-1.0").exists())

    def test_usrmerge_alias_requires_selected_filesystem_package(self) -> None:
        os.symlink("usr", self.source / "bin")
        code, _, stderr = self._run()
        self.assertEqual(code, 2)
        self.assertIn("bin", stderr)
        self.assertEqual(list(self.staging.iterdir()), [self.staging / assembler.STAGING_MARKER])

    def test_unsupported_xattr_fails_closed(self) -> None:
        path = self.source / "usr/bin/demo"
        tool = Path("/usr/bin/xattr")
        if hasattr(os, "setxattr"):
            try:
                os.setxattr(path, "user.assemble_test", b"unsupported", follow_symlinks=False)
            except OSError:
                self.skipTest("filesystem does not permit synthetic xattrs")
        elif tool.is_file():
            result = subprocess.run([os.fspath(tool), "-w", "-x", "-s", "com.example.assemble-test", "756e737570706f72746564", os.fspath(path)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode != 0:
                self.skipTest("xattr tool cannot set synthetic xattrs")
        else:
            self.skipTest("no xattr API available")
        code, _, stderr = self._run()
        self.assertEqual(code, 2)
        self.assertIn("usr/bin/demo", stderr)

    @unittest.skipUnless(sys.platform.startswith("linux") and os.geteuid() == 0, "requires Linux root for chown/setuid fixture")
    def test_linux_root_preserves_setuid_after_package_owner_restore(self) -> None:
        demo = self.source / "usr/bin/demo"
        demo.chmod(0o4755)
        mtree = self.source / "var/lib/pacman/local/demo-1.0/mtree"
        lines = gzip.decompress(mtree.read_bytes())
        changed = lines.replace(b"./usr/bin/demo type=file mode=0755", b"./usr/bin/demo type=file mode=04755")
        mtree.write_bytes(gzip.compress(changed))
        self.assertIn(b"./usr/bin/demo type=file mode=04755", gzip.decompress(mtree.read_bytes()))
        self._clear_host_xattrs()
        code, _, stderr = self._run()
        self.assertEqual(code, 0, stderr)
        self.assertEqual(stat.S_IMODE((self.staging / "usr/bin/demo").stat().st_mode) & 0o7777, 0o4755)


if __name__ == "__main__":
    unittest.main()
