#!/usr/bin/env python3
"""Fetch only the public archives/signatures pinned in the native app lock."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.request


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def fetch(record, cache):
    filename = record["archive"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9+_.:-]*\.pkg\.tar\.zst", filename):
        raise ValueError("unsafe archive filename")
    expected = f"https://riscv.mirror.pkgbuild.com/repo/{record['repository']}/{filename}"
    if record["repository"] not in ("core", "extra", "unsupported") or record["url"] != expected:
        raise ValueError("unexpected package source")
    for suffix, size, pin in (("", record["bytes"], record["sha256"]),
                              (".sig", record["signatureBytes"], record["signatureSha256"])):
        target = cache / (filename + suffix)
        if target.is_symlink():
            raise ValueError("symlinked cache file")
        if target.exists():
            if not target.is_file() or target.stat().st_size != size or sha(target) != pin:
                raise ValueError("existing cache identity mismatch: " + filename + suffix)
            continue
        temporary = target.with_name(target.name + ".partial")
        # Do not follow or truncate an inherited partial file.
        with temporary.open("xb") as output:
            with urllib.request.urlopen(expected + suffix, timeout=120) as response:
                if response.geturl() != expected + suffix:
                    raise ValueError("unexpected package redirect")
                for block in iter(lambda: response.read(1024 * 1024), b""):
                    if output.tell() + len(block) > size:
                        raise ValueError("oversized package response")
                    output.write(block)
        if temporary.stat().st_size != size or sha(temporary) != pin:
            raise ValueError("download identity mismatch: " + filename + suffix)
        temporary.rename(target)
    return {"name": record["name"], "sha256": record["sha256"], "signatureSha256": record["signatureSha256"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    if args.cache.is_symlink() or args.receipt.exists():
        raise ValueError("real cache and fresh receipt required")
    lock = json.loads(args.lock.read_text())
    if lock.get("kind") != "omarchy-native-app-archives" or lock.get("architecture") != "riscv64":
        raise ValueError("native RISC-V lock required")
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(fetch, record, args.cache) for record in lock["packages"]]
        records = [future.result() for future in as_completed(futures)]
    args.receipt.write_text(json.dumps({"lockSha256": sha(args.lock), "packages": sorted(records, key=lambda r: r["name"]),
                                       "seconds": time.monotonic() - started, "signatureAuthentication": "required separately during offline installation"}, indent=2) + "\n")
    print(f"Authenticated download identities for {len(records)} archives and detached signatures")
