#!/usr/bin/env bash
# Reconcile the Alpine warm snapshot with the exact disk bytes it captured.
#
# build-alpine-snapshot.sh intentionally records a large delta against the currently deployed
# chunked base so the snapshot remains safe while the base is being refreshed. This finalizer makes
# the refresh cheap at runtime: reconstruct the post-boot disk, re-chunk it at the existing 128 KiB
# Alpine layout, re-stamp the snapshot's base binding, and replace the large delta with a tiny
# drift-only delta. The resulting chunk base and snapshot are the pair deployed to R2/Pages.
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=target/release/wasm-vm
PRISTINE=releases/rootfs/alpine-rootfs.ext4
BIGDELTA_GZ=releases/boot-snapshot/alpine-overlay-delta.bin.gz
RAM_GZ=releases/boot-snapshot/alpine-ready.snap.gz
WARM_ROOTFS=releases/rootfs/alpine-warm-rootfs.ext4
CHUNK_OUT=releases/chunked-alpine
CHUNK_SIZE=131072
DELTA_OUT_GZ=releases/boot-snapshot/alpine-overlay-delta.bin.gz

for f in "$BIN" "$PRISTINE" "$BIGDELTA_GZ" "$RAM_GZ"; do
  [ -e "$f" ] || { echo "finalize-alpine: missing $f" >&2; exit 1; }
done

echo "[finalize-alpine] reconstructing the post-boot ext4 from the build delta…"
BIGDELTA=$(mktemp -t alpine-big-delta.XXXXXX)
RAWD=""
RAW_SNAP=""
trap 'rm -f "$BIGDELTA" "$RAWD" "$RAW_SNAP"' EXIT
gunzip -c "$BIGDELTA_GZ" > "$BIGDELTA"
cp "$PRISTINE" "$WARM_ROOTFS"
python3 - "$WARM_ROOTFS" "$BIGDELTA" <<'PY'
import struct,sys
disk,delta=sys.argv[1:3]
with open(delta,"rb") as d:
    if d.read(5)!=b"WVOD1": raise SystemExit("bad overlay-delta magic")
    (bs,)=struct.unpack("<I",d.read(4)); (image_len,)=struct.unpack("<Q",d.read(8))
    d.read(32); d.read(8); (count,)=struct.unpack("<I",d.read(4))
    if bs != 4096: raise SystemExit(f"unexpected overlay block size {bs}")
    with open(disk,"r+b") as out:
        out.truncate(image_len)
        for _ in range(count):
            (idx,)=struct.unpack("<Q",d.read(8)); block=d.read(bs)
            if len(block) != bs: raise SystemExit("truncated overlay block")
            out.seek(idx*bs); out.write(block)
    print(f"[finalize-alpine] applied {count} blocks → {disk} ({image_len} bytes)")
PY

echo "[finalize-alpine] re-chunking $WARM_ROOTFS at ${CHUNK_SIZE} bytes…"
rm -rf "$CHUNK_OUT"
"$BIN" chunk "$WARM_ROOTFS" --out "$CHUNK_OUT" --chunk-size "$CHUNK_SIZE"
NCHUNKS=$(find "$CHUNK_OUT/chunks" -type f | wc -l | tr -d ' ')

NEW_BASE=$(python3 - "$CHUNK_OUT/manifest.json" <<'PY'
import hashlib,json,sys
m=json.load(open(sys.argv[1]))
o={k:m[k] for k in ["version","image_len","chunk_size","layout","chunks"]}
print(hashlib.sha256(json.dumps(o,separators=(",",":")).encode()).hexdigest())
PY
)
echo "[finalize-alpine] new base_hash=$NEW_BASE (${NCHUNKS} chunks)"

RAW_SNAP=$(mktemp -t alpine-final-snap.XXXXXX)
gunzip -c "$RAM_GZ" > "$RAW_SNAP"
python3 - "$RAW_SNAP" "$NEW_BASE" <<'PY'
import sys
path,base=sys.argv[1],bytes.fromhex(sys.argv[2])
with open(path,"r+b") as f:
    f.seek(44); f.write(base)
print("[finalize-alpine] re-stamped RAM snapshot base_image_hash")
PY
gzip -9 -c "$RAW_SNAP" > "$RAM_GZ"

echo "[finalize-alpine] computing the tiny delta against the refreshed base…"
RAWD=$(mktemp -t alpine-tiny-delta.XXXXXX)
python3 - "$WARM_ROOTFS" "$CHUNK_OUT/manifest.json" "$NEW_BASE" "$RAWD" <<'PY'
import hashlib,json,struct,sys
disk,manifest_path,base_hex,out=sys.argv[1:5]
m=json.load(open(manifest_path)); image_len=m["image_len"]; chunk_size=m["chunk_size"]
block_size=4096; per_chunk=chunk_size//block_size; drift=[]
with open(disk,"rb") as f:
    for index,want in enumerate(m["chunks"]):
        if hashlib.sha256(f.read(chunk_size)).hexdigest()!=want: drift.append(index)
blocks=[]; block_count=(image_len+block_size-1)//block_size
with open(disk,"rb") as f:
    for chunk in drift:
        for index in range(chunk*per_chunk,min((chunk+1)*per_chunk,block_count)):
            f.seek(index*block_size); block=f.read(block_size)
            if len(block)<block_size: block += b"\0"*(block_size-len(block))
            blocks.append((index,block))
with open(out,"wb") as o:
    o.write(b"WVOD1"); o.write(struct.pack("<I",block_size)); o.write(struct.pack("<Q",image_len))
    o.write(bytes.fromhex(base_hex)); o.write(struct.pack("<Q",0)); o.write(struct.pack("<I",len(blocks)))
    for index,block in blocks:
        o.write(struct.pack("<Q",index)); o.write(block)
print(f"[finalize-alpine] tiny delta: {len(drift)} drift chunks, {len(blocks)} blocks")
PY
gzip -9 -c "$RAWD" > "$DELTA_OUT_GZ"
bash tools/gen-alpine-manifest.sh
echo "[finalize-alpine] RAM sha256=$(shasum -a 256 "$RAM_GZ" | awk '{print $1}')"
echo "[finalize-alpine] delta sha256=$(shasum -a 256 "$DELTA_OUT_GZ" | awk '{print $1}')"
