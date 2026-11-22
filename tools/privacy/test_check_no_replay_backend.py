#!/usr/bin/env python3
"""Regression tests for check-no-replay-backend.py (E5-T31).

Uses a synthetic marker and a synthetic "driver" so no private bytes are needed.
Each verifier finding from the 2026-11-22 refutation has a test here.
Run: python3 tools/privacy/test_check_no_replay_backend.py
"""
import bz2
import gzip
import hashlib
import os
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

GUARD = Path(__file__).with_name("check-no-replay-backend.py")
MARKER = b"SYNTHETIC-PRIVATE-MARKER-7f3a9c"
DRIVER = b"\x7fELF" + os.urandom(4096) + MARKER + os.urandom(4096)
# Compressible: once compressed the marker no longer appears in the raw bytes, so only
# decoding can find it (random filler is stored verbatim and would hide decode gaps).
SOFT = b"\x7fELF" + b"A" * 4096 + MARKER + b"B" * 4096
# Low-entropy filler makes zstd Huffman-code its literals, so the marker is not stored raw.
_rng = random.Random(7)
ZSOFT = bytes(_rng.choice(b"abcd") for _ in range(20000)) + MARKER + bytes(
    _rng.choice(b"abcd") for _ in range(20000))


class Guard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.markers = self.dir / "markers.txt"
        self.markers.write_text("# test\n" + MARKER.decode() + "\n")
        self.digests = self.dir / "digests.txt"
        self.digests.write_text(hashlib.sha256(DRIVER).hexdigest() + "\n")
        self.tree = self.dir / "tree"
        self.tree.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def run_guard(self, *args):
        return subprocess.run([sys.executable, str(GUARD), "--markers", str(self.markers),
                               "--digests", str(self.digests), *args],
                              capture_output=True, text=True).returncode

    def put(self, name, data):
        p = self.tree / name
        p.write_bytes(data)
        return p

    def git(self, repo, *args):
        subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t",
                        "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", *args],
                       check=True, capture_output=True)

    def new_repo(self):
        repo = self.dir / "repo"
        repo.mkdir()
        self.git(repo, "init", "-q")
        (repo / "README").write_text("clean\n")
        self.git(repo, "add", "README")
        self.git(repo, "commit", "-qm", "base")
        return repo

    # --- basics ----------------------------------------------------------------
    def test_clean_tree_passes(self):
        self.put("ok.txt", b"nothing private here\n")
        self.assertEqual(self.run_guard(str(self.tree)), 0)

    def test_raw_driver_rejected(self):
        self.put("innocent.bin", DRIVER)
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    def test_gzip_and_bzip2_rejected(self):
        self.put("a.gz", gzip.compress(DRIVER))
        self.assertEqual(self.run_guard(str(self.tree / "a.gz")), 1)
        self.put("b.dat", bz2.compress(DRIVER))
        self.assertEqual(self.run_guard(str(self.tree / "b.dat")), 1)

    def test_marker_across_chunk_boundary(self):
        from importlib import util
        spec = util.spec_from_file_location("guard", GUARD)
        mod = util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        pad = b"x" * (mod.CHUNK - 5)
        self.put("edge.bin", pad + MARKER)
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    def test_missing_path_fails_closed(self):
        self.assertEqual(self.run_guard(str(self.tree / "does-not-exist")), 1)

    def test_fails_closed_without_private_lists(self):
        r = subprocess.run([sys.executable, str(GUARD), "--markers", str(self.dir / "nope"),
                            str(self.tree)], capture_output=True)
        self.assertEqual(r.returncode, 2)

    # --- verifier finding 3: corrupt zstd must not skip the raw scan ------------
    def test_fake_zstd_header_rejected(self):
        self.put("fake.zst", b"\x28\xb5\x2f\xfd" + DRIVER)
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    def test_fake_gzip_header_rejected(self):
        self.put("fake.gz", b"\x1f\x8b" + DRIVER)
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    # --- verifier r2 finding: partial decodes keep their markers ------------------
    def test_compressible_gzip_needs_decoding(self):
        data = gzip.compress(SOFT, mtime=0)
        self.assertNotIn(MARKER, data)
        self.put("soft.gz", data)
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    def test_gzip_with_junk_suffix_rejected(self):
        self.put("junk.gz", gzip.compress(SOFT, mtime=0) + b"JUNKJUNK")
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    def test_truncated_gzip_rejected(self):
        self.put("cut.gz", gzip.compress(SOFT, mtime=0)[:-12])
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    def test_truncated_xz_and_junk_bzip2_rejected(self):
        import lzma
        data = lzma.compress(SOFT)
        self.assertNotIn(MARKER, data)
        self.put("cut.xz", data[:-16])
        self.assertEqual(self.run_guard(str(self.tree / "cut.xz")), 1)
        data = bz2.compress(SOFT)
        self.assertNotIn(MARKER, data)
        self.put("junk.bz2", data + b"JUNKJUNK")
        self.assertEqual(self.run_guard(str(self.tree / "junk.bz2")), 1)

    @unittest.skipUnless(shutil.which("zstd"), "zstd CLI absent")
    def test_zstd_with_junk_suffix_rejected(self):
        data = subprocess.run(["zstd", "-q", "-c"], input=ZSOFT, capture_output=True, check=True).stdout
        self.assertNotIn(MARKER, data)
        self.put("junk.zst", data + b"JUNKJUNK")
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    # --- verifier r3 finding: nested layers and archive members ------------------
    def test_nested_layers_rejected(self):
        import lzma
        cases = {
            "gz_gz": gzip.compress(gzip.compress(SOFT, mtime=0), mtime=0),
            "gz_xz": gzip.compress(lzma.compress(SOFT), mtime=0),
            "xz_bz2": lzma.compress(bz2.compress(SOFT)),
        }
        for name, data in cases.items():
            with self.subTest(name):
                self.assertNotIn(MARKER, data)
                self.put(name, data)
                self.assertEqual(self.run_guard(str(self.tree / name)), 1)

    def _tar(self, members, mode="w"):
        import io, tarfile
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode=mode) as tar:
            for name, data in members.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        return buf.getvalue()

    def test_compressed_member_inside_tar_rejected(self):
        import lzma
        data = self._tar({"mod.bin": lzma.compress(SOFT)})
        self.assertNotIn(MARKER, data)
        self.put("image.tar", data)
        self.assertEqual(self.run_guard(str(self.tree / "image.tar")), 1)

    def test_compressed_member_inside_tar_gz_rejected(self):
        import lzma
        data = self._tar({"x.bin": lzma.compress(SOFT)}, mode="w:gz")
        self.put("image.tgz", data)
        self.assertEqual(self.run_guard(str(self.tree / "image.tgz")), 1)

    @unittest.skipUnless(shutil.which("zstd"), "zstd CLI absent")
    def test_zstd_member_inside_tar_rejected(self):
        z = subprocess.run(["zstd", "-q", "-c"], input=ZSOFT, capture_output=True, check=True).stdout
        data = self._tar({"pad": b"\0" * 777, "k.zst": z})
        self.assertNotIn(MARKER, data)
        self.put("z.tar", data)
        self.assertEqual(self.run_guard(str(self.tree / "z.tar")), 1)

    def test_marker_split_across_gzip_members_rejected(self):
        half = len(MARKER) // 2
        a = gzip.compress(b"A" * 4096 + MARKER[:half], mtime=0)
        b = gzip.compress(MARKER[half:] + b"B" * 4096, mtime=0)
        self.put("split.gz", a + b)
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    def test_too_deep_nesting_fails_closed(self):
        data = b"harmless"
        for _ in range(6):
            data = gzip.compress(data, mtime=0)
        self.put("deep.gz", data)
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    def test_decode_cap_fails_closed_and_bounds_memory(self):
        import lzma
        self.put("bomb.xz", lzma.compress(b"\0" * (64 << 20)))
        r = subprocess.run([sys.executable, str(GUARD), "--markers", str(self.markers),
                            "--digests", str(self.digests), str(self.tree)],
                           capture_output=True, text=True,
                           env={**os.environ, "PRIVACY_MAX_DECODED": str(1 << 20)})
        self.assertEqual(r.returncode, 1)
        self.assertIn("cannot prove", r.stderr)

    def test_many_tiny_members_linear_time(self):
        import time
        member = gzip.compress(b"x", mtime=0)
        self.put("tiny.gz", member * 100_000)  # ~2 MiB of members
        start = time.monotonic()
        self.assertEqual(self.run_guard(str(self.tree)), 0)
        self.assertLess(time.monotonic() - start, 20)

    def test_clean_tar_gz_passes(self):
        data = self._tar({"a.txt": b"hello\n" * 1000, "b.txt.gz": gzip.compress(b"world\n" * 1000)},
                         mode="w:gz")
        self.put("ok.tgz", data)
        self.assertEqual(self.run_guard(str(self.tree)), 0)

    # --- verifier r4 findings: header-field hiding, staging-write failure --------
    @staticmethod
    def _gzip_with_extra(extra: bytes, body: bytes) -> bytes:
        import struct
        header = b"\x1f\x8b\x08\x04" + b"\0\0\0\0" + b"\0\xff" + struct.pack("<H", len(extra)) + extra
        comp = zlib.compressobj(9, zlib.DEFLATED, -15)
        deflated = comp.compress(body) + comp.flush()
        return header + deflated + struct.pack("<II", zlib.crc32(body), len(body))

    def test_stream_hidden_in_gzip_fextra_rejected(self):
        import lzma
        hidden = lzma.compress(SOFT)
        self.assertNotIn(MARKER, hidden)
        # Ten members, all with benign decoded content; one carries a complete xz
        # stream in its FEXTRA field, which decoders read past without output.
        extras = [b"pad"] * 10
        extras[6] = hidden
        members = b"".join(self._gzip_with_extra(e, b"benign changelog text\n") for e in extras)
        self.assertNotIn(MARKER, gzip.decompress(members))
        self.put("CHANGELOG.gz", members)
        self.assertEqual(self.run_guard(str(self.tree)), 1)
        self.put("x.tar", self._tar({"CHANGELOG.gz": members}))
        self.assertEqual(self.run_guard(str(self.tree / "x.tar")), 1)

    def test_staging_write_failure_fails_closed(self):
        import resource
        import signal
        data = gzip.compress(b"\0" * (8 << 20) + SOFT, mtime=0)
        self.put("big.gz", data)

        def limit():
            signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
            resource.setrlimit(resource.RLIMIT_FSIZE, (1 << 20, 1 << 20))

        r = subprocess.run([sys.executable, str(GUARD), "--markers", str(self.markers),
                            "--digests", str(self.digests), str(self.tree)],
                           capture_output=True, text=True, preexec_fn=limit)
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("cannot prove", r.stderr)

    @unittest.skipUnless(shutil.which("zstd"), "zstd CLI absent")
    def test_zstd_spawn_budget_fails_closed(self):
        self.put("many.bin", b"\x28\xb5\x2f\xfd" * 3000)
        r = subprocess.run([sys.executable, str(GUARD), "--markers", str(self.markers),
                            "--digests", str(self.digests), str(self.tree)],
                           capture_output=True, text=True,
                           env={**os.environ, "PRIVACY_MAX_ZSTD_SPAWNS": "100"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("zstd streams", r.stderr)

    # --- verifier finding 2: symlinks are followed -------------------------------
    def test_symlink_to_private_file_rejected(self):
        outside = self.dir / "outside.bin"
        outside.write_bytes(DRIVER)
        (self.tree / "link.bin").symlink_to(outside)
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    def test_symlink_to_private_dir_rejected_and_cycles_terminate(self):
        outside = self.dir / "outside"
        outside.mkdir()
        (outside / "x.so").write_bytes(DRIVER)
        (self.tree / "d").symlink_to(outside, target_is_directory=True)
        (outside / "loop").symlink_to(self.tree, target_is_directory=True)
        self.assertEqual(self.run_guard(str(self.tree)), 1)

    # --- verifier finding 1: type changes are scanned ----------------------------
    def test_type_change_symlink_to_file_rejected(self):
        repo = self.new_repo()
        (repo / "f").symlink_to("README")
        self.git(repo, "add", "f")
        self.git(repo, "commit", "-qm", "link")
        (repo / "f").unlink()
        (repo / "f").write_bytes(DRIVER)
        self.git(repo, "add", "f")
        self.assertEqual(self.run_guard("--repo", str(repo), "--staged"), 1)
        self.git(repo, "commit", "-qm", "typechange")
        self.assertEqual(self.run_guard("--repo", str(repo), "--git-range", "HEAD~1..HEAD"), 1)

    # --- verifier finding 4: every commit in the range is scanned ----------------
    def test_marker_added_then_removed_in_range_rejected(self):
        repo = self.new_repo()
        (repo / "notes.md").write_bytes(b"leak " + MARKER + b"\n")
        self.git(repo, "add", "notes.md")
        self.git(repo, "commit", "-qm", "leak")
        (repo / "notes.md").write_text("scrubbed\n")
        self.git(repo, "add", "notes.md")
        self.git(repo, "commit", "-qm", "scrub")
        self.assertEqual(self.run_guard("--repo", str(repo), "--git-range", "HEAD~1..HEAD"), 0)
        self.assertEqual(self.run_guard("--repo", str(repo), "--git-range", "HEAD~2..HEAD"), 1)

    def test_staged_clean_passes(self):
        repo = self.new_repo()
        (repo / "ok.md").write_text("fine\n")
        self.git(repo, "add", "ok.md")
        self.assertEqual(self.run_guard("--repo", str(repo), "--staged"), 0)


if __name__ == "__main__":
    unittest.main(verbosity=1)
