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
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

GUARD = Path(__file__).with_name("check-no-replay-backend.py")
MARKER = b"SYNTHETIC-PRIVATE-MARKER-7f3a9c"
DRIVER = b"\x7fELF" + os.urandom(4096) + MARKER + os.urandom(4096)


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
