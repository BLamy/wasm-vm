#!/usr/bin/env python3
"""Bounded integrity checks for a prepared Omarchy ext4 image.

This verifier checks only the bytes and the chunk manifest.  A successful run is
not evidence that the image was sanitized or that it boots in a browser.

The manifest format is the version-1 ``split`` format emitted by
``tools/chunk_image.py`` and consumed by ``crates/storage``.  Image and chunk
bytes are read through a fixed-size buffer; a multi-gigabyte image is never
materialized in memory.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
from typing import Any, BinaryIO, Iterable


FORMAT_VERSION = 1
READ_BUFFER_BYTES = 1024 * 1024
MAX_MANIFEST_BYTES = 128 * 1024 * 1024
SHA256_RE = re.compile(r"[0-9a-f]{64}\Z")

EXT4_SUPERBLOCK_OFFSET = 1024
EXT4_SUPERBLOCK_BYTES = 1024
EXT4_MAGIC = 0xEF53
EXT4_MAX_LOG_BLOCK_SIZE = 6


class VerificationError(Exception):
    """A deterministic, user-facing verification failure."""


@dataclass(frozen=True)
class Manifest:
    image_len: int
    chunk_size: int
    chunks: tuple[str, ...]


@dataclass(frozen=True)
class Ext4Info:
    block_size: int
    block_count: int
    logical_bytes: int


@dataclass(frozen=True)
class VerificationReceipt:
    image_len: int
    image_sha256: str
    manifest_sha256: str
    chunk_size: int
    chunk_count: int
    ext4_block_size: int
    ext4_logical_bytes: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "chunk_count": self.chunk_count,
            "chunk_size": self.chunk_size,
            "ext4_block_size": self.ext4_block_size,
            "ext4_logical_bytes": self.ext4_logical_bytes,
            "image_len": self.image_len,
            "image_sha256": self.image_sha256,
            "manifest_sha256": self.manifest_sha256,
            "scope": "image/chunk integrity and ext4 superblock bounds only; not sanitization or browser boot",
            "status": "integrity-verified",
        }


def _regular_file(path: Path, label: str) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error:
        raise VerificationError(f"cannot stat {label} {path}: {error}") from error
    if stat.S_ISLNK(info.st_mode):
        raise VerificationError(f"{label} must not be a symlink: {path}")
    if not stat.S_ISREG(info.st_mode):
        raise VerificationError(f"{label} is not a regular file: {path}")
    return info


def _open_regular(path: Path, label: str) -> BinaryIO:
    """Open a chunk without following a final symlink, then re-check its type."""

    flags = os.O_RDONLY
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags | nofollow)
    except OSError as error:
        raise VerificationError(f"cannot open {label} {path}: {error}") from error
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise VerificationError(f"{label} is not a regular file: {path}")
        return os.fdopen(fd, "rb")
    except Exception:
        os.close(fd)
        raise


def _read_bounded_manifest(path: Path) -> bytes:
    info = _regular_file(path, "manifest")
    if info.st_size > MAX_MANIFEST_BYTES:
        raise VerificationError(
            f"manifest is too large ({info.st_size} bytes; limit {MAX_MANIFEST_BYTES})"
        )
    try:
        return path.read_bytes()
    except OSError as error:
        raise VerificationError(f"cannot read manifest {path}: {error}") from error


def _as_nonnegative_int(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise VerificationError(f"manifest field {field!r} must be a non-negative integer")
    return value


def _load_manifest(raw: bytes) -> Manifest:
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"manifest is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise VerificationError("manifest must be a JSON object")

    version = value.get("version")
    if isinstance(version, bool) or not isinstance(version, int):
        raise VerificationError("manifest field 'version' must be an integer")
    if version != FORMAT_VERSION:
        raise VerificationError(f"unsupported manifest version {version}; expected {FORMAT_VERSION}")

    image_len = _as_nonnegative_int(value.get("image_len"), "image_len")
    chunk_size = value.get("chunk_size")
    if (
        isinstance(chunk_size, bool)
        or not isinstance(chunk_size, int)
        or chunk_size <= 0
        or chunk_size & (chunk_size - 1)
    ):
        raise VerificationError("manifest field 'chunk_size' must be a positive power of two")

    if value.get("layout") != "split":
        raise VerificationError("manifest layout must be 'split' for a chunk directory")

    chunks = value.get("chunks")
    if not isinstance(chunks, list):
        raise VerificationError("manifest field 'chunks' must be an array")
    expected_count = (image_len + chunk_size - 1) // chunk_size
    if len(chunks) != expected_count:
        raise VerificationError(
            f"manifest chunk count {len(chunks)} does not match image length "
            f"{image_len} and chunk size {chunk_size} (expected {expected_count})"
        )

    normalized: list[str] = []
    for index, digest in enumerate(chunks):
        if not isinstance(digest, str) or SHA256_RE.fullmatch(digest) is None:
            raise VerificationError(
                f"manifest chunk {index} must be 64 lowercase hexadecimal characters"
            )
        normalized.append(digest)
    return Manifest(image_len, chunk_size, tuple(normalized))


def _expected_chunk_len(manifest: Manifest, index: int) -> int:
    start = index * manifest.chunk_size
    return min(manifest.chunk_size, manifest.image_len - start)


def _hash_stream(stream: BinaryIO, expected_len: int, label: str) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    remaining = expected_len
    while remaining:
        data = stream.read(min(READ_BUFFER_BYTES, remaining))
        if not data:
            raise VerificationError(
                f"{label} is truncated: expected {expected_len} bytes, got {total}"
            )
        digest.update(data)
        total += len(data)
        remaining -= len(data)
    return digest.hexdigest(), total


def _verify_chunk_file(path: Path, digest: str, expected_len: int, index: int) -> None:
    with _open_regular(path, f"chunk {index}") as chunk:
        actual, total = _hash_stream(chunk, expected_len, f"chunk {index}")
        if chunk.read(1):
            raise VerificationError(
                f"chunk {index} is oversized: expected {expected_len} bytes"
            )
    if total != expected_len or actual != digest:
        if actual != digest:
            raise VerificationError(
                f"chunk {index} hash mismatch: expected {digest}, got {actual}"
            )
        raise VerificationError(
            f"chunk {index} has wrong length: expected {expected_len}, got {total}"
        )


def _verify_chunk_directory(manifest_path: Path, manifest: Manifest) -> None:
    chunks_dir = manifest_path.parent / "chunks"
    try:
        info = chunks_dir.lstat()
    except OSError as error:
        raise VerificationError(f"missing chunk directory {chunks_dir}: {error}") from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise VerificationError(f"chunk directory must be a real directory: {chunks_dir}")

    referenced = {f"{digest}.bin" for digest in manifest.chunks}
    try:
        entries = list(os.scandir(chunks_dir))
    except OSError as error:
        raise VerificationError(f"cannot list chunk directory {chunks_dir}: {error}") from error
    for entry in entries:
        if entry.name not in referenced:
            raise VerificationError(f"unreferenced or unsafe chunk entry: {entry.name}")
        if entry.is_symlink():
            raise VerificationError(f"chunk path escapes through symlink: {entry.name}")
        if not entry.is_file(follow_symlinks=False):
            raise VerificationError(f"chunk entry is not a regular file: {entry.name}")

    for index, digest in enumerate(manifest.chunks):
        path = chunks_dir / f"{digest}.bin"
        resolved_chunks = chunks_dir.resolve()
        if not path.resolve().is_relative_to(resolved_chunks):
            raise VerificationError(f"chunk path escapes chunk directory: {path}")
        _verify_chunk_file(path, digest, _expected_chunk_len(manifest, index), index)


def _read_ext4_info(image: Path, image_len: int) -> Ext4Info:
    if image_len < EXT4_SUPERBLOCK_OFFSET + EXT4_SUPERBLOCK_BYTES:
        raise VerificationError("image is too small to contain a complete ext4 superblock")
    try:
        with _open_regular(image, "image") as stream:
            stream.seek(EXT4_SUPERBLOCK_OFFSET)
            superblock = stream.read(EXT4_SUPERBLOCK_BYTES)
    except OSError as error:
        raise VerificationError(f"cannot read ext4 superblock: {error}") from error
    if len(superblock) != EXT4_SUPERBLOCK_BYTES:
        raise VerificationError("ext4 superblock is truncated")

    magic = struct.unpack_from("<H", superblock, 56)[0]
    if magic != EXT4_MAGIC:
        raise VerificationError(f"invalid ext4 superblock signature 0x{magic:04x}")
    log_block_size = struct.unpack_from("<I", superblock, 24)[0]
    if log_block_size > EXT4_MAX_LOG_BLOCK_SIZE:
        raise VerificationError(f"ext4 block-size exponent is out of bounds: {log_block_size}")
    block_size = 1024 << log_block_size
    block_count = struct.unpack_from("<I", superblock, 4)[0]
    block_count |= struct.unpack_from("<I", superblock, 0x150)[0] << 32
    if block_count == 0:
        raise VerificationError("ext4 superblock declares zero blocks")
    logical_bytes = block_count * block_size
    if logical_bytes != image_len:
        raise VerificationError(
            f"ext4 logical byte count {logical_bytes} does not equal image length {image_len}"
        )

    first_data_block = struct.unpack_from("<I", superblock, 20)[0]
    if first_data_block >= block_count:
        raise VerificationError("ext4 first data block is outside the filesystem")
    blocks_per_group = struct.unpack_from("<I", superblock, 32)[0]
    if blocks_per_group == 0 or blocks_per_group > block_count:
        raise VerificationError("ext4 blocks-per-group is outside filesystem bounds")
    inodes_per_group = struct.unpack_from("<I", superblock, 40)[0]
    if inodes_per_group == 0:
        raise VerificationError("ext4 inodes-per-group must be non-zero")
    return Ext4Info(block_size, block_count, logical_bytes)


def verify_image(image_path: Path, manifest_path: Path) -> VerificationReceipt:
    image_info = _regular_file(image_path, "image")
    manifest_raw = _read_bounded_manifest(manifest_path)
    manifest = _load_manifest(manifest_raw)
    if image_info.st_size != manifest.image_len:
        raise VerificationError(
            f"image length {image_info.st_size} does not match manifest image_len {manifest.image_len}"
        )

    _verify_chunk_directory(manifest_path, manifest)

    image_digest = hashlib.sha256()
    total = 0
    try:
        with _open_regular(image_path, "image") as image:
            opened_size = os.fstat(image.fileno()).st_size
            if opened_size != manifest.image_len:
                raise VerificationError(
                    f"opened image length {opened_size} does not match manifest image_len "
                    f"{manifest.image_len}"
                )
            for index, expected in enumerate(manifest.chunks):
                expected_len = _expected_chunk_len(manifest, index)
                chunk_digest = hashlib.sha256()
                remaining = expected_len
                while remaining:
                    data = image.read(min(READ_BUFFER_BYTES, remaining))
                    if not data:
                        raise VerificationError(
                            f"image chunk {index} is truncated: expected {expected_len} bytes"
                        )
                    chunk_digest.update(data)
                    image_digest.update(data)
                    total += len(data)
                    remaining -= len(data)
                actual = chunk_digest.hexdigest()
                if actual != expected:
                    raise VerificationError(
                        f"image chunk {index} hash mismatch: expected {expected}, got {actual}"
                    )
            if image.read(1):
                raise VerificationError("image has bytes beyond manifest image_len")
    except OSError as error:
        raise VerificationError(f"cannot read image {image_path}: {error}") from error
    if total != manifest.image_len:
        raise VerificationError(
            f"streamed image byte count {total} does not match manifest image_len {manifest.image_len}"
        )

    ext4 = _read_ext4_info(image_path, manifest.image_len)
    return VerificationReceipt(
        image_len=manifest.image_len,
        image_sha256=image_digest.hexdigest(),
        manifest_sha256=hashlib.sha256(manifest_raw).hexdigest(),
        chunk_size=manifest.chunk_size,
        chunk_count=len(manifest.chunks),
        ext4_block_size=ext4.block_size,
        ext4_logical_bytes=ext4.logical_bytes,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="verify a prepared ext4 image and its version-1 split chunk manifest"
    )
    parser.add_argument("--image", required=True, type=Path, help="candidate ext4 image")
    parser.add_argument("--manifest", required=True, type=Path, help="chunkdir/manifest.json")
    parser.add_argument(
        "--receipt",
        action="store_true",
        help="emit a deterministic JSON receipt (integrity scope only)",
    )
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        receipt = verify_image(args.image, args.manifest)
    except VerificationError as error:
        print(f"verify-omarchy-image: FAIL: {error}", file=sys.stderr)
        return 1
    if args.receipt:
        print(json.dumps(receipt.as_dict(), sort_keys=True, separators=(",", ":")))
    else:
        print(
            "verify-omarchy-image: OK — "
            f"{receipt.image_len} bytes, {receipt.chunk_count} chunks, "
            f"ext4 logical size {receipt.ext4_logical_bytes}; "
            "image/chunk integrity and superblock bounds verified "
            "(not sanitization or browser boot)"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
