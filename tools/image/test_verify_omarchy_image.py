#!/usr/bin/env python3
"""Stdlib tests for the bounded Omarchy image/chunk verifier."""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("verify-omarchy-image.py")
SPEC = importlib.util.spec_from_file_location("verify_omarchy_image", MODULE_PATH)
assert SPEC and SPEC.loader
verifier = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = verifier
SPEC.loader.exec_module(verifier)


class VerifyOmarchyImageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="verify-omarchy-image-test-")
        self.root = Path(self.temp.name)
        self.image = self.root / "fresh.ext4"
        self.chunkdir = self.root / "chunkdir"
        self.chunks = self.chunkdir / "chunks"
        self.chunks.mkdir(parents=True)
        self._make_ext4_shaped_image()
        self._write_manifest()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _make_ext4_shaped_image(self) -> None:
        # Three 1024-byte filesystem blocks.  The 1024-byte superblock starts at
        # byte 1024, and chunk_size=2048 below gives a valid short final chunk.
        data = bytearray((index * 17 + 3) % 256 for index in range(3 * 1024))
        superblock = 1024
        data[superblock + 4 : superblock + 8] = (3).to_bytes(4, "little")
        data[superblock + 20 : superblock + 24] = (1).to_bytes(4, "little")
        data[superblock + 24 : superblock + 28] = (0).to_bytes(4, "little")
        data[superblock + 32 : superblock + 36] = (3).to_bytes(4, "little")
        data[superblock + 40 : superblock + 44] = (1).to_bytes(4, "little")
        data[superblock + 56 : superblock + 58] = (0xEF53).to_bytes(2, "little")
        data[superblock + 0x150 : superblock + 0x154] = (0).to_bytes(4, "little")
        self.image.write_bytes(data)

    def _write_manifest(self, **overrides: object) -> dict[str, object]:
        for child in self.chunks.iterdir():
            child.unlink()
        image_bytes = self.image.read_bytes()
        chunk_size = 2048
        chunks = [
            image_bytes[offset : offset + chunk_size]
            for offset in range(0, len(image_bytes), chunk_size)
        ]
        hashes = [hashlib.sha256(chunk).hexdigest() for chunk in chunks]
        for digest, chunk in zip(hashes, chunks):
            (self.chunks / f"{digest}.bin").write_bytes(chunk)
        manifest: dict[str, object] = {
            "version": 1,
            "image_len": len(image_bytes),
            "chunk_size": chunk_size,
            "layout": "split",
            "chunks": hashes,
        }
        manifest.update(overrides)
        self.manifest = self.chunkdir / "manifest.json"
        self.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        return manifest

    def _run(self, *argv: str) -> tuple[int, str, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = verifier.main(list(argv))
        return code, stdout.getvalue(), stderr.getvalue()

    def test_valid_ext4_shaped_image_with_partial_tail_and_receipt(self) -> None:
        code, stdout, stderr = self._run(
            "--image",
            str(self.image),
            "--manifest",
            str(self.manifest),
            "--receipt",
        )
        self.assertEqual(code, 0, stderr)
        self.assertEqual(stderr, "")
        receipt = json.loads(stdout)
        self.assertEqual(receipt["image_len"], 3072)
        self.assertEqual(receipt["chunk_count"], 2)
        self.assertEqual(receipt["chunk_size"], 2048)
        self.assertEqual(receipt["ext4_logical_bytes"], 3072)
        self.assertEqual(receipt["status"], "integrity-verified")
        self.assertIn("not sanitization or browser boot", receipt["scope"])
        hashes = json.loads(self.manifest.read_text())["chunks"]
        self.assertEqual((self.chunks / f"{hashes[-1]}.bin").stat().st_size, 1024)

    def test_tampered_image_is_rejected(self) -> None:
        with self.image.open("r+b") as stream:
            stream.seek(2500)
            stream.write(b"X")
        code, stdout, stderr = self._run(
            "--image",
            str(self.image),
            "--manifest",
            str(self.manifest),
        )
        self.assertEqual(code, 1)
        self.assertEqual(stdout, "")
        self.assertIn("image chunk 1 hash mismatch", stderr)

    def test_tampered_chunk_is_rejected(self) -> None:
        digest = json.loads(self.manifest.read_text())["chunks"][1]
        chunk = self.chunks / f"{digest}.bin"
        chunk.write_bytes(chunk.read_bytes()[:-1] + b"X")
        code, _, stderr = self._run(
            "--image",
            str(self.image),
            "--manifest",
            str(self.manifest),
        )
        self.assertEqual(code, 1)
        self.assertIn("chunk 1 hash mismatch", stderr)

    def test_missing_chunk_is_rejected(self) -> None:
        digest = json.loads(self.manifest.read_text())["chunks"][1]
        (self.chunks / f"{digest}.bin").unlink()
        code, _, stderr = self._run(
            "--image",
            str(self.image),
            "--manifest",
            str(self.manifest),
        )
        self.assertEqual(code, 1)
        self.assertIn("cannot open chunk 1", stderr)

    def test_symlink_chunk_escape_is_rejected(self) -> None:
        digest = json.loads(self.manifest.read_text())["chunks"][1]
        chunk = self.chunks / f"{digest}.bin"
        chunk.unlink()
        sentinel = self.root / "sentinel"
        sentinel.write_bytes(b"do not read")
        chunk.symlink_to(sentinel)
        code, _, stderr = self._run(
            "--image",
            str(self.image),
            "--manifest",
            str(self.manifest),
        )
        self.assertEqual(code, 1)
        self.assertIn("symlink", stderr)

    def test_orphan_chunk_is_rejected(self) -> None:
        (self.chunks / "orphan.bin").write_bytes(b"orphan")
        code, _, stderr = self._run(
            "--image",
            str(self.image),
            "--manifest",
            str(self.manifest),
        )
        self.assertEqual(code, 1)
        self.assertIn("unreferenced", stderr)

    def test_malformed_manifests_are_rejected(self) -> None:
        cases = (
            {"version": 2},
            {"chunks": []},
            {"chunk_size": 3},
            {"layout": "blob"},
            {"chunks": ["../escape"]},
        )
        original = json.loads(self.manifest.read_text())
        for override in cases:
            with self.subTest(override=override):
                malformed = dict(original)
                malformed.update(override)
                self.manifest.write_text(json.dumps(malformed), encoding="utf-8")
                code, _, stderr = self._run(
                    "--image",
                    str(self.image),
                    "--manifest",
                    str(self.manifest),
                )
                self.assertEqual(code, 1)
                self.assertIn("FAIL", stderr)
                self.manifest.write_text(json.dumps(original), encoding="utf-8")

    def test_ext4_signature_and_logical_bounds_are_checked(self) -> None:
        with self.image.open("r+b") as stream:
            stream.seek(1024 + 56)
            stream.write(b"\x00\x00")
        self._write_manifest()
        code, _, stderr = self._run(
            "--image",
            str(self.image),
            "--manifest",
            str(self.manifest),
        )
        self.assertEqual(code, 1)
        self.assertIn("superblock signature", stderr)

        # Restore the signature, then make the filesystem claim more bytes than
        # the image while retaining a valid chunk manifest.
        with self.image.open("r+b") as stream:
            stream.seek(1024 + 56)
            stream.write((0xEF53).to_bytes(2, "little"))
            stream.seek(1024 + 4)
            stream.write((4).to_bytes(4, "little"))
        self._write_manifest()
        code, _, stderr = self._run(
            "--image",
            str(self.image),
            "--manifest",
            str(self.manifest),
        )
        self.assertEqual(code, 1)
        self.assertIn("logical byte count", stderr)


if __name__ == "__main__":
    unittest.main()
