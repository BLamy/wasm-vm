#!/usr/bin/env bash
# E4 Alpine restore-on-first-load — build the shipped, build-time ALPINE boot snapshot + overlay-delta.
#
# The Alpine equivalent of tools/build-boot-snapshot.sh (busybox). Unlike busybox (initramfs, no disk),
# Alpine boots from a CHUNKED disk base + IndexedDB copy-on-write overlay in the browser, so a browser
# restore needs BOTH artifacts, captured in lockstep:
#   1. the RAM snapshot  (releases/boot-snapshot/alpine-ready.snap.gz, ~15 MB)
#   2. the overlay-delta (releases/boot-snapshot/alpine-overlay-delta.bin.gz, ~1 MB) — every 4 KiB disk
#      block the boot dirtied RELATIVE TO THE CHUNKED BASE (not the raw pristine ext4; see below).
#
# Runs on a host that has the ext4 rootfs + CLI + the chunked image (e.g. `dev`). The ~15-min Alpine
# boot happens under the native CLI, driven to a POST-LOGIN, container-ready shell marker.
#
# Requires the CLI to support --snapshot-{trigger,out,core-id,base-id} and --resume-from (E3-T12c4).
#
#   bash tools/build-alpine-snapshot.sh
#   REBUILD=1 bash tools/build-alpine-snapshot.sh   # cargo build --release -p wasm-vm-cli first
#
# ── The ext4 ↔ chunked-base binding (why the delta is computed against the chunk manifest) ───────────
# The browser fetches the pristine base as CHUNKS described by releases/chunked-alpine/manifest.json; its
# base_hash (= SHA-256 of the manifest's compact JSON) is the coherence identity we stamp the RAM
# snapshot with (--snapshot-base-id) and that the overlay store is namespaced by. The overlay we seed in
# the browser sits over exactly those chunks. THEREFORE the delta must be "post-boot ext4 vs the image
# those chunks reassemble to" — NOT vs the local pristine ext4, which can drift from the chunked base in
# the ext4 superblock (block 0: last-mount-time / mount-count / state). Computing the delta per-block
# against the chunk objects guarantees the seeded overlay makes every cache-miss read return the exact
# post-boot bytes the restored guest's page cache expects. The boot MUST run on an ext4 whose non-drift
# content matches the chunk base (the same rootfs the chunks were produced from).
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=target/release/wasm-vm
KERNEL=releases/kernel/6.6.63/Image
PRISTINE=releases/rootfs/alpine-rootfs.ext4
CHUNK_MANIFEST=releases/chunked-alpine/manifest.json
CHUNK_DIR=releases/chunked-alpine/chunks
OUT_DIR=releases/boot-snapshot
RAM_GZ="$OUT_DIR/alpine-ready.snap.gz"
DELTA_GZ="$OUT_DIR/alpine-overlay-delta.bin.gz"
WORK=$(mktemp -t alpine-boot.XXXXXX.ext4)
RAW_SNAP=$(mktemp -t alpine-ready.XXXXXX.snap)
RAW_DELTA=$(mktemp -t alpine-delta.XXXXXX.bin)
trap 'rm -f "$WORK" "$RAW_SNAP" "$RAW_DELTA"' EXIT

for f in "$KERNEL" "$PRISTINE" "$CHUNK_MANIFEST"; do
  [ -f "$f" ] || { echo "build-alpine-snapshot: missing $f" >&2; exit 1; }
done
[ -d "$CHUNK_DIR" ] || { echo "build-alpine-snapshot: missing chunk dir $CHUNK_DIR" >&2; exit 1; }

if [ "${REBUILD:-0}" = "1" ] || [ ! -x "$BIN" ]; then
  echo "[alpine-snapshot] building release CLI…"
  cargo build --release -p wasm-vm-cli
fi

# ── Coherence identity, matched to the browser build exactly ──────────────────────────────────────
VER=$(awk -F'"' '/^version[[:space:]]*=/{print $2; exit}' Cargo.toml)
CORE_HEX=$(printf '%s' "$VER" | xxd -p | tr -d '\n'); CORE_HEX=$(printf '%-64s' "$CORE_HEX" | tr ' ' '0')
# base_id = SHA-256 of the compact serde JSON of the chunk manifest (== ImageManifest::base_hash).
BASE_HEX=$(python3 - "$CHUNK_MANIFEST" <<'PY'
import json,hashlib,sys
m=json.load(open(sys.argv[1]))
o={k:m[k] for k in ["version","image_len","chunk_size","layout","chunks"]}
print(hashlib.sha256(json.dumps(o,separators=(",",":")).encode()).hexdigest())
PY
)
echo "[alpine-snapshot] core_id=$CORE_HEX (version $VER)"
echo "[alpine-snapshot] base_id=$BASE_HEX (chunk manifest base_hash)"

# ── Boot the working copy to a POST-LOGIN, container-ready shell marker and snapshot ──────────────
cp "$PRISTINE" "$WORK"
echo "[alpine-snapshot] booting Alpine to a post-login shell and snapshotting (this is the ~15-min boot)…"
# Drive stdin: `root` login, an empty line (answers an empty-password prompt if getty asks), then an
# OUTPUT-ONLY marker. The typed command echoes as `echo WVSNAP"READY"` (a quote between P and R, so the
# literal marker never appears in the echo); only the command's STDOUT prints `WVSNAPREADY`, so the
# trigger fires at a genuinely idle, logged-in shell — not on the getty banner (see the native proof).
printf 'root\n\necho WVSNAP"READY"\n' | "$BIN" boot \
  --kernel "$KERNEL" \
  --drive "file=$WORK" \
  --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" \
  --max-instrs 60000000000 \
  --snapshot-trigger "WVSNAPREADY" \
  --snapshot-out "$RAW_SNAP" \
  --snapshot-core-id "$CORE_HEX" \
  --snapshot-base-id "$BASE_HEX"

[ -s "$RAW_SNAP" ] || { echo "build-alpine-snapshot: no snapshot written" >&2; exit 1; }

# ── Compute the overlay-delta: every 4 KiB block where the post-boot ext4 differs from the CHUNK BASE.
echo "[alpine-snapshot] computing overlay-delta vs the chunked base (drift-proof)…"
python3 - "$WORK" "$CHUNK_MANIFEST" "$CHUNK_DIR" "$BASE_HEX" "$RAW_DELTA" <<'PY'
import json,sys,hashlib,struct
work,manifest_path,chunk_dir,base_hex,out=sys.argv[1:6]
m=json.load(open(manifest_path))
cs=m["chunk_size"]; image_len=m["image_len"]; chunks=m["chunks"]
OB=4096
def base_block(i):
    # bytes [i*OB, i*OB+OB) of the reassembled chunk base, read from the content-addressed chunk object.
    start=i*OB
    ci=start//cs; off=start-ci*cs
    with open(f"{chunk_dir}/{chunks[ci]}","rb") as f:
        f.seek(off); b=f.read(OB)
    if len(b)<OB: b=b+b"\x00"*(OB-len(b))
    return b
blocks=[]
nblk=(image_len+OB-1)//OB
with open(work,"rb") as w:
    for i in range(nblk):
        w.seek(i*OB); wb=w.read(OB)
        if len(wb)<OB: wb=wb+b"\x00"*(OB-len(wb))
        if wb!=base_block(i):
            blocks.append((i,wb))
# WVOD1: magic(5) block_size(u32) image_len(u64) base_binding(32) generation(u64) count(u32) [idx(u64)+block]
base_binding=bytes.fromhex(base_hex)
with open(out,"wb") as o:
    o.write(b"WVOD1")
    o.write(struct.pack("<I",OB))
    o.write(struct.pack("<Q",image_len))
    o.write(base_binding)
    o.write(struct.pack("<Q",0))          # generation 0 (fresh restore-on-load, paired with the RAM snap)
    o.write(struct.pack("<I",len(blocks)))
    for i,b in blocks:
        o.write(struct.pack("<Q",i)); o.write(b)
print(f"overlay-delta: {len(blocks)} dirty 4KiB blocks / {nblk} ({len(blocks)*OB} bytes)",file=sys.stderr)
PY

mkdir -p "$OUT_DIR"
gzip -9 -c "$RAW_SNAP"  > "$RAM_GZ"
gzip -9 -c "$RAW_DELTA" > "$DELTA_GZ"
echo "[alpine-snapshot] RAM  raw=$(wc -c <"$RAW_SNAP")B  gz=$(wc -c <"$RAM_GZ")B  sha256=$(shasum -a256 "$RAM_GZ"|awk '{print $1}')"
echo "[alpine-snapshot] delta raw=$(wc -c <"$RAW_DELTA")B  gz=$(wc -c <"$DELTA_GZ")B  sha256=$(shasum -a256 "$DELTA_GZ"|awk '{print $1}')"
echo "[alpine-snapshot] wrote $RAM_GZ and $DELTA_GZ"

if [ "$(wc -c <"$RAM_GZ")" -gt $((25*1024*1024)) ]; then
  echo "[alpine-snapshot] WARNING: $RAM_GZ exceeds Cloudflare Pages' 25 MiB cap — ship via R2 instead." >&2
fi

echo "[alpine-snapshot] regenerating web/artifacts-alpine.json…"
bash tools/gen-alpine-manifest.sh
