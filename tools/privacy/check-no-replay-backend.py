#!/usr/bin/env python3
"""Fail if anything derived from Replay's private backend (src/cpp) is present.

Policy: wasm-vm is public and its guest OS images are downloaded by every visitor.
Normal Replay Chromium / Replay Node builds may ship to the client, but no code or
binary built from Replay's private backend `src/cpp` tree (recording driver, linker,
recording reader, interceptors) may enter a public PR, a guest image, web/dist, or
a Cloudflare deploy.

The identifying byte markers and driver digests are themselves private, so they live
in `local/private-boundary/` (gitignored). Without them this check FAILS CLOSED:
publishing from a machine that cannot run the full check is refused.

Usage:
  check-no-replay-backend.py PATH...            scan files, directories, ext4/tar/cpio
                                                 images (raw bytes) and .gz/.xz/.zst/.bz2
  check-no-replay-backend.py --git-range A..B    scan blobs added/changed in a git range
  --markers FILE / --digests FILE                override the private list locations
"""
from __future__ import annotations

import argparse
import bz2
import gzip
import hashlib
import io
import lzma
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MARKERS = ROOT / "local/private-boundary/markers.txt"
DEFAULT_DIGESTS = ROOT / "local/private-boundary/driver-sha256.txt"

# Public, non-sensitive markers: paths and filenames that only the private tree uses.
PUBLIC_MARKERS = [b"backend/src/cpp/", b"linux-recordreplay.so"]
PATH_DENY = ("recordreplay.so", "/backend/src/cpp")
CHUNK = 8 << 20


def load_lines(path: Path) -> list[str]:
    return [l.strip() for l in path.read_text().splitlines() if l.strip() and not l.startswith("#")]


def open_stream(path: Path):
    with path.open("rb") as probe:
        magic = probe.read(6)
    if magic[:2] == b"\x1f\x8b":
        return gzip.open(path, "rb"), "gzip"
    if magic[:6] == b"\xfd7zXZ\x00":
        return lzma.open(path, "rb"), "xz"
    if magic[:3] == b"BZh":
        return bz2.open(path, "rb"), "bzip2"
    if magic[:4] == b"\x28\xb5\x2f\xfd":
        try:
            import zstandard  # type: ignore
        except ImportError:
            proc = subprocess.Popen(["zstd", "-dc", str(path)], stdout=subprocess.PIPE)
            return proc.stdout, "zstd"
        return zstandard.ZstdDecompressor().stream_reader(path.open("rb")), "zstd"
    return path.open("rb"), None


def scan_stream(stream, markers: list[bytes]) -> tuple[list[bytes], str]:
    """Return (markers found, sha256 of the decoded stream)."""
    keep = max(len(m) for m in markers) - 1
    tail = b""
    found: set[bytes] = set()
    digest = hashlib.sha256()
    while True:
        block = stream.read(CHUNK)
        if not block:
            break
        digest.update(block)
        window = tail + block
        for m in markers:
            if m not in found and m in window:
                found.add(m)
        tail = window[-keep:] if keep else b""
    return sorted(found), digest.hexdigest()


SELF = Path(__file__).resolve()


def scan_file(path: Path, markers, digests, problems: list[str]) -> None:
    if path.resolve() == SELF:
        return
    low = str(path).lower()
    if any(d in low for d in PATH_DENY):
        problems.append(f"{path}: private driver/backend path")
    raw = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            raw.update(block)
    if raw.hexdigest() in digests:
        problems.append(f"{path}: matches a private driver binary digest")
    stream, kind = open_stream(path)
    try:
        with stream:
            found, decoded = scan_stream(stream, markers)
    except (OSError, EOFError, lzma.LZMAError, ValueError) as err:
        # Not actually (or not cleanly) compressed: the raw bytes are what ships.
        problems_note = f"undecodable {kind} stream ({err.__class__.__name__}); scanned raw bytes"
        if os.environ.get("PRIVACY_VERBOSE"):
            print(f"[privacy] note: {path}: {problems_note}", file=sys.stderr)
        kind = None
        with path.open("rb") as fh:
            found, decoded = scan_stream(fh, markers)
    if kind and decoded in digests:
        problems.append(f"{path} ({kind}): decompresses to a private driver binary")
    for m in found:
        label = m.decode(errors="replace") if m in PUBLIC_MARKERS else f"private marker #{markers.index(m)}"
        problems.append(f"{path}{' (' + kind + ')' if kind else ''}: contains {label}")


def scan_paths(paths, markers, digests, problems) -> int:
    count = 0
    for root in paths:
        root = Path(root)
        if root.is_file():
            scan_file(root, markers, digests, problems)
            count += 1
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d != ".git"]
            for name in filenames:
                p = Path(dirpath, name)
                if p.is_symlink() or not p.is_file():
                    continue
                scan_file(p, markers, digests, problems)
                count += 1
    return count


def scan_git_range(rng: str | None, markers, digests, problems) -> int:
    """rng=None scans the index (staged files); otherwise blobs at the range's tip."""
    which = ["--cached"] if rng is None else [rng]
    names = subprocess.check_output(
        ["git", "-C", str(ROOT), "diff", "--name-only", "-z", "--diff-filter=AMR", *which], text=True
    ).split("\0")
    names = [n for n in names if n]
    tip = "" if rng is None else (rng.split("..")[-1] or "HEAD")
    for name in names:
        if name == "tools/privacy/check-no-replay-backend.py":
            continue
        if any(d in name.lower() for d in PATH_DENY) or name.startswith("local/"):
            problems.append(f"{tip}:{name}: private path in git range")
        data = subprocess.check_output(["git", "-C", str(ROOT), "show", f"{tip}:{name}"])
        if hashlib.sha256(data).hexdigest() in digests:
            problems.append(f"{tip}:{name}: matches a private driver binary digest")
        found, _ = scan_stream(io.BytesIO(data), markers)
        for m in found:
            label = m.decode(errors="replace") if m in PUBLIC_MARKERS else f"private marker #{markers.index(m)}"
            problems.append(f"{tip}:{name}: contains {label}")
    return len(names)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--git-range")
    ap.add_argument("--staged", action="store_true", help="scan files staged in the git index")
    ap.add_argument("--allow-missing-private", action="store_true",
                    help="(hook use) on machines without the private lists, check public markers only")
    ap.add_argument("--markers", type=Path, default=DEFAULT_MARKERS)
    ap.add_argument("--digests", type=Path, default=DEFAULT_DIGESTS)
    args = ap.parse_args()
    if not args.paths and not args.git_range and not args.staged:
        ap.error("give PATH..., --git-range and/or --staged")
    missing = [f for f in (args.markers, args.digests) if not f.is_file()]
    if missing and not args.allow_missing_private:
        print(f"[privacy] FAIL CLOSED: private list {missing[0]} is missing; cannot prove the "
              "absence of Replay backend code here.", file=sys.stderr)
        return 2
    markers = PUBLIC_MARKERS + ([] if missing else [m.encode() for m in load_lines(args.markers)])
    digests = set() if missing else set(load_lines(args.digests))
    problems: list[str] = []
    n = 0
    if args.git_range:
        n += scan_git_range(args.git_range, markers, digests, problems)
    if args.staged:
        n += scan_git_range(None, markers, digests, problems)
    if args.paths:
        n += scan_paths(args.paths, markers, digests, problems)
    if problems:
        print("[privacy] FAIL: Replay backend (src/cpp) material found:", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        return 1
    print(f"[privacy] OK: {n} file(s) scanned, no Replay backend material "
          f"({len(markers)} markers, {len(digests)} driver digests)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
