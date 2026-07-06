#!/usr/bin/env python3
"""E3-T01: split a disk image into the chunked format (fixed-size chunks + a hashed JSON manifest),
or reassemble/verify one. Dev-grade: used by tests and by T02's lazy fetch until the T11 pipeline
lands. The manifest is exactly the `ImageManifest` the core reader (`crates/storage`) parses —
version, image_len, chunk_size, layout, and per-chunk sha256 (see docs/design/chunked-image.md).

  # split (default layout=split: one content-addressed file per chunk under <out>/chunks/)
  tools/chunk_image.py split IMAGE --out DIR [--chunk-size 131072] [--layout split|blob]

  # reassemble from a manifest + chunks and check the whole-image sha256 round-trips
  tools/chunk_image.py verify DIR/manifest.json --image IMAGE
"""
import argparse
import hashlib
import json
import os
import sys

FORMAT_VERSION = 1
DEFAULT_CHUNK_SIZE = 128 * 1024  # 128 KiB — power of two; measure before changing (see the design doc)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def split(args) -> int:
    cs = args.chunk_size
    if cs <= 0 or (cs & (cs - 1)) != 0:
        print(f"chunk_image: --chunk-size must be a positive power of two, got {cs}", file=sys.stderr)
        return 2
    if args.layout not in ("split", "blob"):
        print(f"chunk_image: --layout must be split|blob, got {args.layout}", file=sys.stderr)
        return 2

    os.makedirs(args.out, exist_ok=True)
    chunk_dir = os.path.join(args.out, "chunks")
    if args.layout == "split":
        os.makedirs(chunk_dir, exist_ok=True)

    image_len = os.path.getsize(args.image)
    chunks = []
    with open(args.image, "rb") as f:
        while True:
            buf = f.read(cs)  # the last read is short → the tail chunk
            if not buf:
                break
            h = sha256_hex(buf)
            chunks.append(h)
            if args.layout == "split":
                # Content-addressed, immutable, CDN/cache friendly. Identical chunks dedupe for free.
                with open(os.path.join(chunk_dir, f"{h}.bin"), "wb") as out:
                    out.write(buf)
        # blob layout keeps the single image file; the manifest's byte ranges address it via HTTP Range.

    manifest = {
        "version": FORMAT_VERSION,
        "image_len": image_len,
        "chunk_size": cs,
        "layout": args.layout,
        "chunks": chunks,
    }
    mpath = os.path.join(args.out, "manifest.json")
    with open(mpath, "w") as m:
        json.dump(manifest, m, indent=2)
        m.write("\n")
    print(f"chunk_image: {image_len} bytes → {len(chunks)} chunks of {cs} B ({args.layout}); wrote {mpath}", file=sys.stderr)
    return 0


def verify(args) -> int:
    with open(args.manifest) as f:
        m = json.load(f)
    if m.get("version") != FORMAT_VERSION:
        print(f"chunk_image: unsupported version {m.get('version')}", file=sys.stderr)
        return 1
    cs = m["chunk_size"]
    base = os.path.dirname(args.manifest)
    reassembled = hashlib.sha256()
    total = 0
    if m["layout"] == "split":
        for i, h in enumerate(m["chunks"]):
            path = os.path.join(base, "chunks", f"{h}.bin")
            with open(path, "rb") as c:
                buf = c.read()
            if sha256_hex(buf) != h:
                print(f"chunk_image: chunk {i} content does not match its hash", file=sys.stderr)
                return 1
            reassembled.update(buf)
            total += len(buf)
    else:  # blob: read the ranges back out of the image
        if not args.image:
            print("chunk_image: verify of a blob-layout manifest needs --image", file=sys.stderr)
            return 2
        with open(args.image, "rb") as img:
            for i, h in enumerate(m["chunks"]):
                buf = img.read(cs)
                if sha256_hex(buf) != h:
                    print(f"chunk_image: blob chunk {i} does not match its hash", file=sys.stderr)
                    return 1
                reassembled.update(buf)
                total += len(buf)
    if total != m["image_len"]:
        print(f"chunk_image: reassembled {total} bytes != manifest image_len {m['image_len']}", file=sys.stderr)
        return 1
    if args.image:
        with open(args.image, "rb") as f:
            if reassembled.hexdigest() != hashlib.sha256(f.read()).hexdigest():
                print("chunk_image: reassembled image sha256 != original — NOT byte-identical", file=sys.stderr)
                return 1
    print(f"chunk_image: OK — {len(m['chunks'])} chunks reassemble to {total} bytes, sha256 round-trips", file=sys.stderr)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="chunked disk-image format tool (E3-T01)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("split")
    sp.add_argument("image")
    sp.add_argument("--out", required=True)
    sp.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE)
    sp.add_argument("--layout", default="split")
    sp.set_defaults(func=split)
    vp = sub.add_parser("verify")
    vp.add_argument("manifest")
    vp.add_argument("--image", default=None)
    vp.set_defaults(func=verify)
    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
