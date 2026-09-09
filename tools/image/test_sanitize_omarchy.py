#!/usr/bin/env python3
"""Focused safety tests for sanitize-omarchy.py.

The fixture contains sentinel secrets only so the tests can prove they do not
survive or appear in diagnostics.  It is synthetic and never reads a real
user, VM, SSH, or tailnet file.
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("sanitize-omarchy.py")
SPEC = importlib.util.spec_from_file_location("sanitize_omarchy", MODULE_PATH)
assert SPEC and SPEC.loader
sanitizer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sanitizer)


class SanitizerTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_parent = "/private/tmp" if Path("/private/tmp").is_dir() else None
        self.temp = tempfile.TemporaryDirectory(prefix="sanitize-omarchy-test-", dir=temp_parent)
        self.root = Path(self.temp.name)
        self.source = self.root / "extracted"
        self.source.mkdir()
        (self.source / sanitizer.INPUT_MARKER).write_bytes(sanitizer.INPUT_MARKER_CONTENT)
        self._write("etc/passwd", "root:x:0:0:Source root GECOS:/source-root:/bin/zsh\n" "root-alias:x:0:0:Alias GECOS:/home/alias:/bin/fish\n" "daemon:x:2:2:daemon:/sbin:/sbin/nologin\n" "blamy:x:1000:1000:Bootstrap:/home/blamy:/bin/bash\n")
        self._write("etc/group", "root:x:0:\n" "daemon:x:2:\n" "wheel:x:10:blamy\n")
        self._write("etc/shadow", "root:$6$source-secret-hash:::::::\n" "daemon:*:::::::\n" "blamy:$6$bootstrap-secret-hash:::::::\n")
        self._write("etc/gshadow", "root:*::\n" "daemon:*::\n" "wheel:*::blamy\n")
        self._write("etc/skel/.profile", "export PS1=personalized-bootstrap\\$ \n")
        self._write("usr/share/omarchy/skel/.wasm-vm-packaged-skeleton", sanitizer.PACKAGED_SKEL_MARKER_CONTENT.decode())
        self._write("usr/share/omarchy/skel/.config/omarchy/demo.conf", "packaged=true\n")
        self._write("usr/share/omarchy/skel/.profile", "export PS1=packaged-omarchy\\$ \n")
        self._write("usr/lib/pacman/local/placeholder/desc", "NAME = placeholder\n")
        self._write("etc/ssh/sshd_config", "Port 22\n")
        self._write("etc/ssh/ssh_host_ed25519_key", "HOST-PRIVATE-KEY-SENTINEL\n")
        self._write("etc/tailscale/state", "TAILNET-SECRET-SENTINEL\n")
        self._write("var/log/old.log", "LOG-SECRET-SENTINEL\n")
        self._write("var/cache/pkg.cache", "CACHE-SENTINEL\n")
        self._write("home/blamy/.config/private.conf", "PRIVATE-HOME-SENTINEL\n")
        self._write("home/blamy/.ssh/id_ed25519", "SSH-SECRET-SENTINEL\n")
        self._write("root/.bash_history", "history-secret-sentinel\n")
        self._write("etc/sudoers.d/bootstrap", "blamy ALL=(ALL) NOPASSWD: ALL\n")
        self._write("etc/systemd/system/multi-user.target.wants/sshd.service", "")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write(self, relative: str, content: str) -> None:
        path = self.source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def _run(self, destination: Path) -> tuple[int, str, str]:
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = sanitizer.main([str(self.source), str(destination)])
        return code, stdout.getvalue(), stderr.getvalue()

    def test_public_root_removes_identity_secrets_and_keeps_boot_assets(self) -> None:
        output = self.root / "public"
        code, stdout, stderr = self._run(output)
        self.assertEqual(code, 0, stderr)
        self.assertEqual(stdout, "sanitize-omarchy: public root ready\n")
        self.assertEqual(stderr, "")
        self.assertEqual((output / sanitizer.OUTPUT_MARKER).read_bytes(), sanitizer.OUTPUT_MARKER_CONTENT)
        self.assertTrue((output / "usr/lib/pacman/local/placeholder/desc").is_file())
        self.assertEqual((output / "home/omarchy/.profile").read_text(), "export PS1=packaged-omarchy\\$ \n")
        self.assertEqual((output / "home/omarchy/.config/omarchy/demo.conf").read_text(), "packaged=true\n")
        self.assertNotIn("personalized-bootstrap", (output / "etc/skel/.profile").read_text())
        self.assertTrue((output / "etc/systemd/system/getty.target.wants/serial-getty@ttyS0.service").is_symlink())
        self.assertFalse((output / "home/blamy").exists())
        self.assertFalse((output / "root/.bash_history").exists())
        self.assertFalse((output / "etc/ssh/ssh_host_ed25519_key").exists())
        self.assertFalse((output / "etc/tailscale").exists())
        self.assertFalse((output / "etc/sudoers.d").exists())
        self.assertTrue((output / "etc/systemd/system/sshd.service").is_symlink())
        self.assertEqual((output / "etc/systemd/system/sshd.service").readlink(), Path("/dev/null"))
        self.assertFalse((output / "etc/inittab").exists())
        passwd = (output / "etc/passwd").read_text()
        shadow = (output / "etc/shadow").read_text()
        self.assertIn("root:x:0:0:root:/root:/bin/bash", passwd)
        self.assertIn("nobody:x:65534:65534:nobody:/:/usr/bin/nologin", passwd)
        self.assertIn("omarchy:x:1000:1000", passwd)
        self.assertNotIn("root-alias", passwd)
        self.assertNotIn("Source root GECOS", passwd)
        self.assertNotIn("/source-root", passwd)
        self.assertNotIn("/bin/zsh", passwd)
        self.assertNotIn("daemon:", passwd)
        self.assertNotIn("blamy", passwd)
        self.assertIn("root:!:", shadow)
        self.assertIn("nobody:!:", shadow)
        self.assertIn("omarchy:!:", shadow)
        self.assertNotIn("source-secret-hash", shadow)
        self.assertNotIn("bootstrap-secret-hash", shadow)
        self.assertEqual(json_text(output / "etc/wasm-vm/omarchy-sanitized.json")["accounts"], ["root", "nobody", "omarchy"])
        self.assertEqual(stat.S_IMODE((output / "root").stat().st_mode), 0o700)
        self.assertFalse((output / ".wasm-vm-omarchy-staging").exists())

        combined = stdout + stderr
        for secret in ("HOST-PRIVATE-KEY-SENTINEL", "TAILNET-SECRET-SENTINEL", "PRIVATE-HOME-SENTINEL", "SSH-SECRET-SENTINEL", "NOPASSWD"):
            self.assertNotIn(secret, combined)

    def test_repeated_copy_is_idempotent_by_content(self) -> None:
        first, second = self.root / "first", self.root / "second"
        self.assertEqual(self._run(first)[0], 0)
        self.assertEqual(self._run(second)[0], 0)
        self.assertEqual(tree_digest(first), tree_digest(second))
        # A marked output is safely replaceable, so a repeat to the same target
        # also exercises the guarded replacement path.
        self.assertEqual(self._run(first)[0], 0)
        self.assertEqual(tree_digest(first), tree_digest(second))

    def test_missing_source_gshadow_still_creates_all_fresh_groups(self) -> None:
        source = self.source / "etc/gshadow"
        if source.exists():
            source.unlink()
        output = self.root / "public"
        self.assertEqual(self._run(output)[0], 0)
        self.assertEqual((output / "etc/gshadow").read_text(), "root:!::\nnobody:!::\nomarchy:!::\n")

    def test_missing_marker_fails_before_destination_mutation(self) -> None:
        (self.source / sanitizer.INPUT_MARKER).unlink()
        destination = self.root / "public"
        sentinel = self.root / "destination-sentinel"
        sentinel.write_text("untouched", encoding="utf-8")
        code, stdout, stderr = self._run(destination)
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        self.assertIn("missing the exact disposable-root marker", stderr)
        self.assertFalse(destination.exists())
        self.assertEqual(sentinel.read_text(), "untouched")

    def test_external_symlink_fails_before_any_output_mutation(self) -> None:
        outside = self.root / "outside"
        outside.write_text("OUT-OF-ROOT-SENTINEL", encoding="utf-8")
        os.symlink(os.path.relpath(outside, self.source / "etc"), self.source / "etc/outside-link")
        destination = self.root / "public"
        code, stdout, stderr = self._run(destination)
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        self.assertIn("symlink that escapes", stderr)
        self.assertFalse(destination.exists())
        self.assertEqual(outside.read_text(), "OUT-OF-ROOT-SENTINEL")

    def test_source_ancestor_symlink_fails_closed(self) -> None:
        alias = self.root / "source-alias"
        os.symlink(self.source, alias)
        destination = self.root / "public"
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = sanitizer.main([str(alias), str(destination)])
        self.assertEqual(code, 2)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("symlink ancestor", stderr.getvalue())
        self.assertFalse(destination.exists())

    def test_generated_parent_symlink_is_rejected_before_copy(self) -> None:
        original = self.source / "etc/systemd"
        original.rename(self.source / "systemd-fixture-backup")
        os.symlink("/guest-systemd", original)
        destination = self.root / "public"
        code, _, stderr = self._run(destination)
        self.assertEqual(code, 2)
        self.assertIn("generated configuration parent", stderr)
        self.assertFalse(destination.exists())

    def test_generated_file_dangling_symlink_cannot_create_host_file(self) -> None:
        target = self.root / "must-not-be-created"
        (self.source / "etc/passwd").unlink()
        os.symlink(str(target), self.source / "etc/passwd")
        destination = self.root / "public"
        code, _, stderr = self._run(destination)
        self.assertEqual(code, 2)
        self.assertIn("must be a regular file", stderr)
        self.assertFalse(destination.exists())
        self.assertFalse(target.exists())

    @unittest.skipUnless(sys.platform.startswith("linux") and os.geteuid() == 0, "requires Linux metadata semantics")
    def test_chown_does_not_clear_copied_setuid_bits(self) -> None:
        executable = self.source / "usr/bin/fixture-helper"
        executable.parent.mkdir(parents=True, exist_ok=True)
        executable.write_bytes(b"fixture")
        executable.chmod(0o4755)
        destination = self.root / "public"
        self.assertEqual(self._run(destination)[0], 0)
        self.assertEqual(stat.S_IMODE((destination / "usr/bin/fixture-helper").stat().st_mode), 0o4755)

    def test_destination_ancestor_symlink_fails_closed(self) -> None:
        parent = self.root / "destination-parent"
        real_parent = self.root / "real-destination-parent"
        real_parent.mkdir()
        os.symlink(real_parent, parent)
        destination = parent / "public"
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = sanitizer.main([str(self.source), str(destination)])
        self.assertEqual(code, 2)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("symlink ancestor", stderr.getvalue())
        self.assertFalse((real_parent / "public").exists())

    def test_absolute_guest_symlink_is_preserved_without_host_lookup(self) -> None:
        link = self.source / "etc/missing-guest-target"
        os.symlink("/guest-only/path-that-does-not-exist-on-host", link)
        output = self.root / "public"
        code, _, stderr = self._run(output)
        self.assertEqual(code, 0, stderr)
        self.assertEqual((output / "etc/missing-guest-target").readlink(), Path("/guest-only/path-that-does-not-exist-on-host"))

    def test_destination_symlink_and_workspace_like_roots_are_refused(self) -> None:
        destination = self.root / "link-destination"
        sentinel = self.root / "sentinel"
        sentinel.write_text("untouched", encoding="utf-8")
        os.symlink(sentinel, destination)
        code, _, stderr = self._run(destination)
        self.assertEqual(code, 2)
        self.assertIn("symlink", stderr)
        self.assertEqual(sentinel.read_text(), "untouched")

    def test_unmarked_skeleton_directory_is_not_trusted(self) -> None:
        marker = self.source / "usr/share/omarchy/skel/.wasm-vm-packaged-skeleton"
        marker.unlink()
        output = self.root / "public"
        self.assertEqual(self._run(output)[0], 0)
        self.assertFalse((output / "home/omarchy/.config/omarchy/demo.conf").exists())

    def test_copied_modes_and_symlink_metadata_are_preserved(self) -> None:
        file_path = self.source / "usr/lib/pacman/local/placeholder/desc"
        file_path.chmod(0o640)
        link_path = self.source / "usr/bin/guest-link"
        link_path.parent.mkdir(parents=True, exist_ok=True)
        os.symlink("/guest/bin/demo", link_path)
        output = self.root / "public"
        self.assertEqual(self._run(output)[0], 0)
        self.assertEqual(stat.S_IMODE((output / "usr/lib/pacman/local/placeholder/desc").stat().st_mode), 0o640)
        source_link = os.lstat(link_path)
        copied_link = os.lstat(output / "usr/bin/guest-link")
        self.assertEqual((copied_link.st_uid, copied_link.st_gid), (source_link.st_uid, source_link.st_gid))

    def test_linux_extended_attributes_are_preserved(self) -> None:
        setxattr = getattr(os, "setxattr", None)
        getxattr = getattr(os, "getxattr", None)
        if not (setxattr and getxattr):
            self.skipTest("extended attributes are unavailable on this platform")
        source_file = self.source / "usr/lib/pacman/local/placeholder/desc"
        try:
            setxattr(source_file, "user.wasm_vm_test", b"trusted-tree")
        except OSError as exc:
            self.skipTest(f"test filesystem does not support user xattrs: {exc}")
        output = self.root / "public"
        self.assertEqual(self._run(output)[0], 0)
        self.assertEqual(getxattr(output / "usr/lib/pacman/local/placeholder/desc", "user.wasm_vm_test"), b"trusted-tree")

    def test_demo_home_is_fixed_identity_on_linux(self) -> None:
        output = self.root / "public"
        self.assertEqual(self._run(output)[0], 0)
        if os.uname().sysname.lower() == "linux":
            for path in [output / "home/omarchy", *sorted((output / "home/omarchy").rglob("*"))]:
                info = os.lstat(path)
                self.assertEqual((info.st_uid, info.st_gid), (1000, 1000))

    def test_source_is_never_modified(self) -> None:
        before = tree_digest(self.source)
        destination = self.root / "public"
        self.assertEqual(self._run(destination)[0], 0)
        self.assertEqual(tree_digest(self.source), before)
        self.assertTrue((self.source / "home/blamy/.ssh/id_ed25519").exists())


def json_text(path: Path) -> dict:
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        digest.update(rel.encode() + b"\0")
        info = path.lstat()
        digest.update(str(stat.S_IFMT(info.st_mode)).encode() + b"\0")
        if stat.S_ISLNK(info.st_mode):
            digest.update(os.readlink(path).encode() + b"\0")
        elif stat.S_ISREG(info.st_mode):
            digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()


if __name__ == "__main__":
    unittest.main()
