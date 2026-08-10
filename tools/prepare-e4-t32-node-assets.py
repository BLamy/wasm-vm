#!/usr/bin/env python3
"""Prepare the immutable Node chunk store used by E4-T32 CPU-parity evidence.

The production R2 diagnostic intentionally measures the real network. The acceptance matrix instead
serves this verified local mirror so main-thread and whole-worker legs see byte-identical, low-latency
chunks and the <=10% comparison isolates emulator/scheduler throughput.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import urllib.request


DEFAULT_SOURCE = "https://pub-ee599ce692e44e29868ebfa96dd9c7fd.r2.dev/chunked-node-alpine"
EXPECTED_MANIFEST_SHA256 = "ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1"
MAX_LOGICAL_CHUNKS = 10_000
print_lock = threading.Lock()


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "wasm-vm-e4-t32-asset-prep/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
            temp_name = handle.name
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


def prepare_chunk(source: str, chunks_dir: Path, digest: str) -> str:
    destination = chunks_dir / f"{digest}.bin"
    if destination.is_file():
        existing = destination.read_bytes()
        if sha256(existing) == digest:
            return "cached"
    data = fetch(f"{source}/chunks/{digest}.bin")
    actual = sha256(data)
    if actual != digest:
        raise RuntimeError(f"chunk {digest} hash mismatch: got {actual}")
    atomic_write(destination, data)
    return "downloaded"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path, help="cache directory (manifest.json + chunks/)")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="immutable Node chunk-store URL")
    parser.add_argument("--workers", type=int, default=16, help="bounded parallel downloads (default: 16)")
    args = parser.parse_args()
    if not 1 <= args.workers <= 64:
        parser.error("--workers must be in 1..64")

    source = args.source.rstrip("/")
    manifest_bytes = fetch(f"{source}/manifest.json")
    manifest_sha = sha256(manifest_bytes)
    if manifest_sha != EXPECTED_MANIFEST_SHA256:
        raise SystemExit(
            f"refusing unpaired Node manifest: expected {EXPECTED_MANIFEST_SHA256}, got {manifest_sha}"
        )
    manifest = json.loads(manifest_bytes)
    chunks = manifest.get("chunks")
    if (
        manifest.get("version") != 1
        or manifest.get("image_len") != 805_306_368
        or manifest.get("chunk_size") != 131_072
        or not isinstance(chunks, list)
        or len(chunks) != 6_144
        or len(chunks) > MAX_LOGICAL_CHUNKS
        or any(not isinstance(item, str) or len(item) != 64 or any(c not in "0123456789abcdef" for c in item) for item in chunks)
    ):
        raise SystemExit("refusing malformed or unexpected Node chunk manifest")

    destination = args.destination.expanduser().resolve()
    chunks_dir = destination / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    unique_chunks = sorted(set(chunks))
    counts = {"cached": 0, "downloaded": 0}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(prepare_chunk, source, chunks_dir, digest): digest
            for digest in unique_chunks
        }
        for completed, future in enumerate(concurrent.futures.as_completed(futures), 1):
            outcome = future.result()
            counts[outcome] += 1
            if completed % 100 == 0 or completed == len(futures):
                with print_lock:
                    print(
                        f"verified {completed}/{len(futures)} unique chunks "
                        f"({counts['downloaded']} downloaded, {counts['cached']} cached)",
                        flush=True,
                    )

    atomic_write(destination / "manifest.json", manifest_bytes)
    print(f"manifest sha256 {manifest_sha}")
    print(f"E4T32_NODE_ASSET_DIR={destination}")
    print("E4T32_NODE_ASSET_BASE=/e4t32-node-assets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
