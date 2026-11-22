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
  check-no-replay-backend.py --git-range A..B    scan every blob each commit in A..B introduced
  check-no-replay-backend.py --staged            scan the git index (pre-commit)
  --markers FILE / --digests FILE                override the private list locations
"""
from __future__ import annotations

import argparse
import bz2
import gzip
import hashlib
import lzma
import os
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


class _ProcStream:
    """A subprocess decoder's stdout that raises if the decoder fails (no silent empty read)."""

    def __init__(self, proc):
        self.proc = proc

    def read(self, n):
        data = self.proc.stdout.read(n)
        if not data and self.proc.wait() != 0:
            raise ValueError(f"decoder exited {self.proc.returncode}")
        return data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.proc.stdout.close()
        if self.proc.poll() is None:
            self.proc.kill()
        self.proc.wait()


def open_decoded(path: Path):
    """Return (decoded stream, kind) for a recognised compressed file, else (None, None)."""
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
            proc = subprocess.Popen(["zstd", "-dcq", str(path)], stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL)
            return _ProcStream(proc), "zstd"
        return zstandard.ZstdDecompressor().stream_reader(path.open("rb")), "zstd"
    return None, None


def scan_stream(stream, markers: list[bytes]) -> tuple[list[bytes], str]:
    """Return (markers found, sha256 of the stream)."""
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
SELF_REL = "tools/privacy/check-no-replay-backend.py"


def _label(m: bytes, markers) -> str:
    return m.decode(errors="replace") if m in PUBLIC_MARKERS else f"private marker #{markers.index(m)}"


def scan_file(path: Path, markers, digests, problems: list[str], label: str | None = None) -> None:
    """Scan the raw bytes ALWAYS, and additionally the decoded bytes of compressed files.

    Raw scanning cannot be skipped by a fake or corrupt compression header: a file is
    only cleared when its shipped bytes are clean and (if it decodes) its content is too.
    """
    label = label or str(path)
    if any(d in label.lower() for d in PATH_DENY):
        problems.append(f"{label}: private driver/backend path")
    with path.open("rb") as fh:
        found, raw = scan_stream(fh, markers)
    if raw in digests:
        problems.append(f"{label}: matches a private driver binary digest")
    for m in found:
        problems.append(f"{label}: contains {_label(m, markers)}")
    stream, kind = open_decoded(path)
    if stream is None:
        return
    try:
        with stream:
            found, decoded = scan_stream(stream, markers)
    except (OSError, EOFError, lzma.LZMAError, ValueError) as err:
        if os.environ.get("PRIVACY_VERBOSE"):
            print(f"[privacy] note: {label}: undecodable {kind} ({err}); raw bytes scanned",
                  file=sys.stderr)
        return
    if decoded in digests:
        problems.append(f"{label} ({kind}): decompresses to a private driver binary")
    for m in found:
        problems.append(f"{label} ({kind}): contains {_label(m, markers)}")


def scan_paths(paths, markers, digests, problems) -> int:
    """Walk trees FOLLOWING symlinks: uploaders such as wrangler publish link targets."""
    count = 0
    seen_dirs: set[str] = set()
    for root in paths:
        root = Path(root)
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
