#!/usr/bin/env python3
"""Authenticate a large public R2 object through bounded HTTP range reads."""

import argparse
import hashlib
import re
import sys
import time
import urllib.request


CHUNK_BYTES = 16 * 1024 * 1024
RETRIES = 3


def verify(url: str, size: int, expected_sha256: str) -> None:
    if size <= 0 or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("invalid expected object size or SHA-256")

    digest = hashlib.sha256()
    for start in range(0, size, CHUNK_BYTES):
        end = min(start + CHUNK_BYTES, size) - 1
        length = end - start + 1
        expected_range = f"bytes {start}-{end}/{size}"
        for attempt in range(RETRIES):
            try:
                request = urllib.request.Request(
                    url,
                    headers={
                        "Range": f"bytes={start}-{end}",
                        "Accept-Encoding": "identity",
                        "User-Agent": "curl/8.7.1",
                    },
                )
                with urllib.request.urlopen(request, timeout=60) as response:
                    if response.status != 206 or response.headers.get("Content-Range") != expected_range:
                        raise ValueError(f"unexpected range response at {start}: {response.status}")
                    body = response.read(length + 1)
                    if len(body) != length:
                        raise ValueError(f"short or long range response at {start}: {len(body)}")
                digest.update(body)
                break
            except (OSError, ValueError) as error:
                if attempt == RETRIES - 1:
                    raise RuntimeError(
                        f"range {start}-{end} failed after {RETRIES} attempts: {error}"
                    ) from error
                time.sleep(attempt + 1)

    actual = digest.hexdigest()
    if actual != expected_sha256:
        raise ValueError(f"R2 SHA-256 mismatch: expected {expected_sha256}, got {actual}")
    print(f"[r2-range-check] exact {size} bytes, SHA-256 {actual}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("size", type=int)
    parser.add_argument("sha256")
    args = parser.parse_args()
    try:
        verify(args.url, args.size, args.sha256)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"[r2-range-check] {error}", file=sys.stderr)
        sys.exit(1)
