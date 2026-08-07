#!/usr/bin/env bash
# E3.6-T05 — turn the build-node-alpine-snapshot.sh output (RAM snap stamped to the OLD chunked base +
# a BIG overlay-delta over that old base) into the PAGES-hostable Node-Alpine restore:
#   1. reconstruct the Alpine+Node ext4  = pristine ext4 + the big overlay-delta
#   2. NATIVE node-runs proof            = resume the RAM snap (identity zeroed) on that ext4, run node
#   3. re-chunk the ext4 (1 MiB chunks)  → releases/chunked-node-alpine/  (NEW base_hash, ~768 files)
#   4. re-stamp the RAM snap's base_image_hash (header bytes 44..76) → the NEW base_hash (no re-boot:
#      the coherence header carries no checksum; only base binding label changes, RAM is untouched)
#   5. recompute a TINY overlay-delta    = node ext4 vs the NEW chunked base (≈ drift-only, since the
#      base IS the node ext4) bound to the NEW base_hash, generation 0
# Everything then ships ON Cloudflare Pages (relative URLs) — no R2.
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=target/release/wasm-vm
KERNEL=releases/kernel/6.6.63/Image
PRISTINE=releases/rootfs/alpine-rootfs.ext4
RAM_GZ=releases/boot-snapshot/node-alpine-ready.snap.gz
BIGDELTA_GZ=releases/boot-snapshot/node-alpine-overlay-delta.bin.gz
NODE_EXT4=releases/rootfs/alpine-node-rootfs.ext4
CHUNK_OUT=releases/chunked-node-alpine
CHUNK_SIZE=1048576
DELTA_OUT_GZ=releases/boot-snapshot/node-alpine-overlay-delta.bin.gz  # overwritten with the tiny one

for f in "$BIN" "$KERNEL" "$PRISTINE" "$RAM_GZ" "$BIGDELTA_GZ"; do
  [ -e "$f" ] || { echo "finalize: missing $f" >&2; exit 1; }
done

# ── 1. reconstruct the Alpine+Node ext4 = pristine + big overlay-delta ──────────────────────────────
echo "[finalize] reconstructing Alpine+Node ext4 from pristine + big overlay-delta…"
cp "$PRISTINE" "$NODE_EXT4"
BIGDELTA=$(mktemp); gunzip -c "$BIGDELTA_GZ" > "$BIGDELTA"
python3 - "$NODE_EXT4" "$BIGDELTA" <<'PY'
import sys,struct
disk,delta=sys.argv[1:3]
with open(delta,"rb") as d:
    assert d.read(5)==b"WVOD1"
    (bs,)=struct.unpack("<I",d.read(4)); (image_len,)=struct.unpack("<Q",d.read(8))
    d.read(32); d.read(8); (count,)=struct.unpack("<I",d.read(4))
    with open(disk,"r+b") as o:
        for _ in range(count):
            (idx,)=struct.unpack("<Q",d.read(8)); blk=d.read(bs)
            o.seek(idx*bs); o.write(blk)
    print(f"[finalize] applied {count} blocks → {disk}")
PY

# ── 2. NATIVE node-runs proof (resume RAM snap with identity zeroed, against the node ext4) ─────────
echo "[finalize] NATIVE node-runs proof…"
ZSNAP=$(mktemp -t na-zsnap.XXXXXX.snap)
gunzip -c "$RAM_GZ" > "$ZSNAP"
python3 - "$ZSNAP" <<'PY'
import sys
p=sys.argv[1]
with open(p,"r+b") as f:
    f.seek(12); f.write(b"\x00"*64)   # zero core_hash(12..44)+base_image_hash(44..76) → matches a fresh machine
print("[finalize] zeroed snapshot identity for native resume")
PY
FIFO=$(mktemp -u -t na-in.XXXXXX); mkfifo "$FIFO"
PLOG=$(mktemp -t na-proof.XXXXXX.log)
(
  exec 3>"$FIFO"; sleep 6
  printf 'node --version\n' >&3; sleep 3
  printf "node -e 'console.log(6*7)'\n" >&3; sleep 3
  printf "node -e 'let s=0;for(let i=1;i<=1000;i++)s+=i;console.log(\"SUM=\"+s)'\n" >&3; sleep 3
  printf "node -e 'const fs=require(\"fs\");fs.writeFileSync(\"/root/proof.txt\",String(21*2));console.log(\"FILE=\"+fs.readFileSync(\"/root/proof.txt\",\"utf8\"))'\n" >&3; sleep 3
  printf 'echo NODEPROOF_DONE\n' >&3; sleep 10
) &
WPID=$!
"$BIN" boot --kernel "$KERNEL" --drive "file=$NODE_EXT4" --net-slirp --virtio-rng \
  --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" --max-instrs 40000000000 \
  --resume-from "$ZSNAP" < "$FIFO" | tee "$PLOG" &
BPID=$!
for _ in $(seq 1 300); do grep -q "NODEPROOF_DONE" "$PLOG" && break; sleep 1; done
kill "$WPID" "$BPID" 2>/dev/null || true; wait 2>/dev/null || true
echo "==================== NATIVE PROOF ===================="
grep -aE "v[0-9]+\.[0-9]+\.[0-9]+|^42$|SUM=|FILE=|NODEPROOF_DONE" "$PLOG" || true
echo "====================================================="
rm -f "$ZSNAP" "$FIFO" "$PLOG"

# ── 3. re-chunk the node ext4 (1 MiB) → NEW base ────────────────────────────────────────────────────
echo "[finalize] chunking $NODE_EXT4 at $CHUNK_SIZE bytes → $CHUNK_OUT…"
rm -rf "$CHUNK_OUT"
"$BIN" chunk "$NODE_EXT4" --out "$CHUNK_OUT" --chunk-size "$CHUNK_SIZE"
NCHUNKS=$(ls "$CHUNK_OUT/chunks" | wc -l | tr -d ' ')
echo "[finalize] $NCHUNKS chunk files"

# ── 4. NEW base_hash (compact JSON of the 5 canonical manifest keys, == ImageManifest::base_hash) ───
NEW_BASE=$(python3 - "$CHUNK_OUT/manifest.json" <<'PY'
import json,hashlib,sys
m=json.load(open(sys.argv[1]))
o={k:m[k] for k in ["version","image_len","chunk_size","layout","chunks"]}
print(hashlib.sha256(json.dumps(o,separators=(",",":")).encode()).hexdigest())
PY
)
echo "[finalize] NEW base_hash = $NEW_BASE"

# ── re-stamp the RAM snap's base_image_hash (bytes 44..76) → NEW base_hash; keep core_hash ──────────
RAW=$(mktemp); gunzip -c "$RAM_GZ" > "$RAW"
python3 - "$RAW" "$NEW_BASE" <<'PY'
import sys
raw,base=sys.argv[1],bytes.fromhex(sys.argv[2])
with open(raw,"r+b") as f:
    f.seek(44); f.write(base)   # base_image_hash[44:76] = new chunked base_hash (core_hash[12:44] kept)
print("[finalize] re-stamped RAM snapshot base_image_hash")
PY
gzip -9 -c "$RAW" > "$RAM_GZ"; rm -f "$RAW"

# ── 5. TINY overlay-delta = node ext4 vs NEW chunked base (writes ∪ drift), base_binding=NEW, gen 0 ─
echo "[finalize] computing TINY overlay-delta vs the new chunked base…"
RAWD=$(mktemp)
python3 - "$NODE_EXT4" "$CHUNK_OUT/manifest.json" "$NEW_BASE" "$RAWD" <<'PY'
import json,sys,struct,hashlib
work,manifest_path,base_hex,out=sys.argv[1:5]
m=json.load(open(manifest_path))
image_len=m["image_len"]; cs=m["chunk_size"]; chunks=m["chunks"]
OB=4096; per_chunk=cs//OB
# The base IS this ext4 (freshly chunked from it), so per-chunk content == work: only include a block
# when the manifest chunk hash disagrees with the ext4's chunk (drift) — expected ~none. Included with
# the ext4's own content so any residual disagreement resolves to what the guest booted from.
drift=set()
with open(work,"rb") as w:
    for ci,exp in enumerate(chunks):
        if hashlib.sha256(w.read(cs)).hexdigest()!=exp: drift.add(ci)
blocks=[]; nblk=(image_len+OB-1)//OB
with open(work,"rb") as w:
    for ci in sorted(drift):
        for b in range(ci*per_chunk, min((ci+1)*per_chunk, nblk)):
            w.seek(b*OB); blk=w.read(OB)
            if len(blk)<OB: blk=blk+b"\x00"*(OB-len(blk))
            blocks.append((b,blk))
with open(out,"wb") as o:
    o.write(b"WVOD1"); o.write(struct.pack("<I",OB)); o.write(struct.pack("<Q",image_len))
    o.write(bytes.fromhex(base_hex)); o.write(struct.pack("<Q",0)); o.write(struct.pack("<I",len(blocks)))
    for i,b in blocks: o.write(struct.pack("<Q",i)); o.write(b)
print(f"[finalize] tiny delta: {len(drift)} drift chunks, {len(blocks)} blocks ({len(blocks)*OB} bytes)")
PY
gzip -9 -c "$RAWD" > "$DELTA_OUT_GZ"; rm -f "$RAWD" "$BIGDELTA"

echo "==================== ARTIFACTS ===================="
echo "base_hash : $NEW_BASE"
echo "chunks    : $NCHUNKS files @ ${CHUNK_SIZE}B in $CHUNK_OUT"
echo "RAM  snap : $(wc -c <"$RAM_GZ")B gz  sha256=$(shasum -a256 "$RAM_GZ"|awk '{print $1}')"
echo "delta     : $(wc -c <"$DELTA_OUT_GZ")B gz  sha256=$(shasum -a256 "$DELTA_OUT_GZ"|awk '{print $1}')"
echo "biggest chunk file: $(ls -S "$CHUNK_OUT/chunks" | head -1) $(ls -Sl "$CHUNK_OUT/chunks" | head -1 | awk '{print $5}')B"
echo "=================================================="
