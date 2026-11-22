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
  check-no-replay-backend.py PATH...            scan files and directories (following
                                                 symlinks): raw bytes, plus every gzip/xz/
                                                 bzip2/zstd stream at any offset (nested
                                                 layers, members inside tar/cpio/ext4 images)
  check-no-replay-backend.py --git-range A..B    scan every blob each commit in A..B introduced
  check-no-replay-backend.py --staged            scan the git index (pre-commit)
  --markers FILE / --digests FILE                override the private list locations
"""
from __future__ import annotations

import argparse
import bz2
import zlib
import hashlib
import lzma
import os
import re
import shutil
import subprocess
import sys
import tempfile
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


# Compressed-stream signatures, searched at EVERY offset (binwalk-style carving), so
# members embedded in tar/cpio/ext4 images and nested layers are decoded too.
_SIG_RE = re.compile(rb"\x1f\x8b\x08|\xfd7zXZ\x00|BZh[1-9]1AY&SY|\x28\xb5\x2f\xfd")
_SIG_LEN = 10
_MAGIC = {"gzip": b"\x1f\x8b\x08", "xz": b"\xfd7zXZ\x00", "bzip2": b"BZh", "zstd": b"\x28\xb5\x2f\xfd"}
FEED = 16 << 10       # input slice per decompress call: bounds per-member copies
MAX_DEPTH = 4         # nested compression layers decoded before failing closed
MAX_CARVES = 200_000  # decode attempts per file before failing closed
MAX_DECODED = int(os.environ.get("PRIVACY_MAX_DECODED", 8 << 30))  # bytes per decoded layer


def _kind(sig: bytes) -> str:
    if sig.startswith(b"\x1f\x8b"):
        return "gzip"
    if sig.startswith(b"\xfd7z"):
        return "xz"
    if sig.startswith(b"BZh"):
        return "bzip2"
    return "zstd"


def scan_stream(stream, markers: list[bytes], found: set[bytes] | None = None,
                carve: set[tuple[int, str]] | None = None) -> tuple[list[bytes], str]:
    """Return (markers found, sha256 of the stream); optionally collect carve offsets."""
    keep = max(max(len(m) for m in markers), _SIG_LEN) - 1
    tail = b""
    pos = 0
    found = set() if found is None else found
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
        if carve is not None:
            base = pos - len(tail)
            for hit in _SIG_RE.finditer(window):
                carve.add((base + hit.start(), _kind(hit.group())))
        pos += len(block)
        tail = window[-keep:] if keep else b""
    return sorted(found), digest.hexdigest()


class _LayerTooLarge(Exception):
    pass


def _write_capped(out, data: bytes, written: int) -> int:
    written += len(data)
    if written > MAX_DECODED:
        raise _LayerTooLarge
    out.write(data)
    return written


def _decode_at(src: Path, offset: int, kind: str, out) -> tuple[int, int | None]:
    """Decode the stream starting at `offset` into `out`, following concatenated members.

    Returns (bytes written, input end offset or None if unknown). Every byte decoded
    before truncation, junk or corruption is kept. Raises _LayerTooLarge past the cap.
    """
    written = 0
    if kind == "zstd":
        try:
            import zstandard  # type: ignore
        except ImportError:
            zstandard = None
        with src.open("rb") as fh:
            fh.seek(offset)
            if zstandard is not None:
                reader = zstandard.ZstdDecompressor().stream_reader(fh, read_across_frames=True)
                try:
                    while chunk := reader.read(CHUNK):
                        written = _write_capped(out, chunk, written)
                except zstandard.ZstdError:
                    pass
                return written, None
            if not shutil.which("zstd"):
                raise FileNotFoundError("zstd decoder unavailable")
            proc = subprocess.Popen(["zstd", "-dcq"], stdin=fh, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL)
            try:
                while chunk := proc.stdout.read(CHUNK):
                    written = _write_capped(out, chunk, written)
            finally:
                proc.stdout.close()
                if proc.poll() is None:
                    proc.kill()
                proc.wait()
            return written, None

    factory = {"gzip": lambda: zlib.decompressobj(31), "xz": lzma.LZMADecompressor,
               "bzip2": bz2.BZ2Decompressor}[kind]
    errors = (OSError, EOFError, lzma.LZMAError, ValueError, zlib.error)
    with src.open("rb") as fh:
        fh.seek(offset)
        dec = factory()
        consumed = offset
        pending = b""
        while True:
            data = pending or fh.read(FEED)
            pending = b""
            if not data:
                return written, consumed
            buf = data
            try:
                while True:
                    if kind == "gzip":
                        chunk = dec.decompress(buf, CHUNK)
                    else:
                        chunk = dec.decompress(buf, max_length=CHUNK)
                    written = _write_capped(out, chunk, written)
                    if dec.eof:
                        break
                    if kind == "gzip":
                        buf = dec.unconsumed_tail
                        if not buf:
                            break
                    elif dec.needs_input:
                        break
                    else:
                        buf = b""
            except errors:
                return written, None
            if dec.eof:
                rest = dec.unused_data
                consumed += len(data) - len(rest)
                magic = _MAGIC[kind]
                if len(rest) < len(magic):
                    rest += fh.read(FEED)
                if not rest.startswith(magic):
                    return written, consumed
                dec = factory()  # a concatenated member: gzip -dc joins them, so do we
                pending = rest
            else:
                consumed += len(data)


SELF = Path(__file__).resolve()
SELF_REL = "tools/privacy/check-no-replay-backend.py"


def _label(m: bytes, markers) -> str:
    return m.decode(errors="replace") if m in PUBLIC_MARKERS else f"private marker #{markers.index(m)}"


def scan_file(path: Path, markers, digests, problems: list[str], label: str | None = None,
              depth: int = 0) -> None:
    """Scan raw bytes, then every compressed stream found at any offset, recursively.

    A file is cleared only when its shipped bytes are clean and every layer that
    decodes from it (nested, embedded in an archive or image, truncated or
    junk-suffixed) is clean too. Undecidable cases fail closed.
    """
    label = label or str(path)
    if depth == 0 and any(d in label.lower() for d in PATH_DENY):
        problems.append(f"{label}: private driver/backend path")
    carve: set[tuple[int, str]] = set()
    with path.open("rb") as fh:
        found, raw = scan_stream(fh, markers, carve=carve)
    if raw in digests:
        problems.append(f"{label}: matches a private driver binary digest")
    for m in found:
        problems.append(f"{label}: contains {_label(m, markers)}")
    if not carve:
        return
    if depth >= MAX_DEPTH:
        problems.append(f"{label}: compressed data nested deeper than {MAX_DEPTH} layers; "
                        "cannot prove it clean")
        return
    covered = -1
    attempts = 0
    for offset, kind in sorted(carve):
        if offset < covered:
            continue
        attempts += 1
        if attempts > MAX_CARVES:
            problems.append(f"{label}: more than {MAX_CARVES} embedded streams; cannot prove it clean")
            return
        with tempfile.NamedTemporaryFile(prefix="privacy-layer-") as out:
            try:
                written, end = _decode_at(path, offset, kind, out)
            except _LayerTooLarge:
                problems.append(f"{label}@{offset} ({kind}): decodes past {MAX_DECODED} bytes; "
                                "cannot prove it clean (raise PRIVACY_MAX_DECODED)")
                continue
            except FileNotFoundError as err:
                problems.append(f"{label}@{offset} ({kind}): {err}; cannot prove it clean")
                continue
            if end is not None:
                covered = end
            if written:
                out.flush()
                scan_file(Path(out.name), markers, digests, problems,
                          label=f"{label}@{offset}:{kind}", depth=depth + 1)


def scan_paths(paths, markers, digests, problems) -> int:
    """Walk trees FOLLOWING symlinks: uploaders such as wrangler publish link targets."""
    count = 0
    seen_dirs: set[str] = set()
    for root in paths:
        root = Path(root)
        if not root.exists():
            problems.append(f"{root}: path does not exist; nothing was proven clean")
            continue
        if root.is_file():
            if root.resolve() != SELF:
                scan_file(root, markers, digests, problems)
                count += 1
            continue
        for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
            real = os.path.realpath(dirpath)
            if real in seen_dirs:
                dirnames[:] = []
                continue
            seen_dirs.add(real)
            dirnames[:] = [d for d in dirnames if d != ".git"]
            for name in filenames:
                p = Path(dirpath, name)
                if not p.is_file():  # dangling links, sockets, devices
                    continue
                if p.resolve() == SELF:
                    continue
                label = f"{p} -> {p.resolve()}" if p.is_symlink() else str(p)
                scan_file(p, markers, digests, problems, label)
                count += 1
    return count


def _git(repo: Path, *args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(repo), *args])


def _scan_blob(repo: Path, spec: str, name: str, markers, digests, problems) -> None:
    if name == SELF_REL:
        return
    if any(d in name.lower() for d in PATH_DENY) or name.startswith("local/"):
        problems.append(f"{spec}: private path in git history")
    data = _git(repo, "cat-file", "blob", spec)
    with tempfile.NamedTemporaryFile(prefix="privacy-blob-") as tmp:
        tmp.write(data)
        tmp.flush()
        scan_file(Path(tmp.name), markers, digests, problems, label=spec)


def scan_git_staged(repo: Path, markers, digests, problems) -> int:
    names = [n for n in _git(repo, "diff", "--cached", "--name-only", "-z",
                             "--diff-filter=ACMRT").decode().split("\0") if n]
    for name in names:
        _scan_blob(repo, f":{name}", name, markers, digests, problems)
    return len(names)


def scan_git_range(repo: Path, rng: str, markers, digests, problems) -> int:
    """Scan every blob any commit in the range introduced, not just the range's tip."""
    commits = [c for c in _git(repo, "rev-list", "--reverse", rng).decode().split() if c]
    count = 0
    for commit in commits:
        names = [n for n in _git(repo, "diff-tree", "-r", "-m", "-z", "--root", "--no-commit-id",
                                 "--name-only", "--diff-filter=ACMRT", commit).decode().split("\0") if n]
        for name in dict.fromkeys(names):
            _scan_blob(repo, f"{commit[:12]}:{name}", name, markers, digests, problems)
            count += 1
    return count


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--git-range")
    ap.add_argument("--staged", action="store_true", help="scan files staged in the git index")
    ap.add_argument("--allow-missing-private", action="store_true",
                    help="(hook use) on machines without the private lists, check public markers only")
    ap.add_argument("--repo", type=Path, default=ROOT, help="git repository for --git-range/--staged")
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
        n += scan_git_range(args.repo, args.git_range, markers, digests, problems)
    if args.staged:
        n += scan_git_staged(args.repo, markers, digests, problems)
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
