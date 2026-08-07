#!/usr/bin/env bash
# E3.6-T05 — build the shipped, build-time NODE-ALPINE boot snapshot + overlay-delta.
#
# Parallel to tools/build-alpine-snapshot.sh, but the guest additionally `apk add nodejs npm`s Node
# BEFORE the snapshot is taken, so the restored browser host lands at a shell with `node` already on
# PATH (no boot, no apk wait). The delta is BIG here (node+npm write ~50-80 MB to the ext4), so unlike
# the bare-Alpine delta this one likely exceeds Cloudflare Pages' 25 MiB/file cap — measure the gz and
# ship the large artifact(s) on R2 (see the size report at the end + tools/deploy-cloudflare.sh guard).
#
# Runs on a host with the ext4 rootfs + CLI + chunked image + REAL OUTBOUND NETWORK (e.g. `dev`): the
# guest pulls nodejs/npm from the live Alpine mirrors through the slirp NAT (--net-slirp → host sockets
# + host-resolver DNS). The ~15-min Alpine boot plus the node install runs under the native CLI, driven
# to a POST-INSTALL shell marker that only fires once `node --version` && `npm --version` succeed.
#
#   bash tools/build-node-alpine-snapshot.sh
#   REBUILD=1 bash tools/build-node-alpine-snapshot.sh   # cargo build --release -p wasm-vm-cli first
#
# The ext4 ↔ chunked-base binding + the "delta = writes ∪ drifted-chunk coverage" coherence argument
# are IDENTICAL to tools/build-alpine-snapshot.sh — read that file's header for the full rationale.
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=target/release/wasm-vm
KERNEL=releases/kernel/6.6.63/Image
PRISTINE=releases/rootfs/alpine-rootfs.ext4
CHUNK_MANIFEST=releases/chunked-alpine/manifest.json
CHUNK_DIR=releases/chunked-alpine/chunks
OUT_DIR=releases/boot-snapshot
RAM_GZ="$OUT_DIR/node-alpine-ready.snap.gz"
DELTA_GZ="$OUT_DIR/node-alpine-overlay-delta.bin.gz"
WORK=$(mktemp -t node-alpine-boot.XXXXXX.ext4)
RAW_SNAP=$(mktemp -t node-alpine-ready.XXXXXX.snap)
RAW_DELTA=$(mktemp -t node-alpine-delta.XXXXXX.bin)

for f in "$KERNEL" "$PRISTINE" "$CHUNK_MANIFEST"; do
  [ -f "$f" ] || { echo "build-node-alpine-snapshot: missing $f" >&2; exit 1; }
done
[ -d "$CHUNK_DIR" ] || { echo "build-node-alpine-snapshot: missing chunk dir $CHUNK_DIR" >&2; exit 1; }

if [ "${REBUILD:-0}" = "1" ] || [ ! -x "$BIN" ]; then
  echo "[node-alpine-snapshot] building release CLI…"
  cargo build --release -p wasm-vm-cli
fi

# ── Coherence identity, matched to the browser build exactly (same as build-alpine-snapshot.sh) ─────
VER=$(awk -F'"' '/^version[[:space:]]*=/{print $2; exit}' Cargo.toml)
CORE_HEX=$(printf '%s' "$VER" | xxd -p | tr -d '\n'); CORE_HEX=$(printf '%-64s' "$CORE_HEX" | tr ' ' '0')
BASE_HEX=$(python3 - "$CHUNK_MANIFEST" <<'PY'
import json,hashlib,sys
m=json.load(open(sys.argv[1]))
o={k:m[k] for k in ["version","image_len","chunk_size","layout","chunks"]}
print(hashlib.sha256(json.dumps(o,separators=(",",":")).encode()).hexdigest())
PY
)
echo "[node-alpine-snapshot] core_id=$CORE_HEX (version $VER)"
echo "[node-alpine-snapshot] base_id=$BASE_HEX (chunk manifest base_hash)"

# ── Boot the working copy, apk-add node, and snapshot at a post-install shell ───────────────────────
cp "$PRISTINE" "$WORK"
echo "[node-alpine-snapshot] booting Alpine, apk add nodejs npm, then snapshotting (long: boot ~15min + install)…"
FIFO=$(mktemp -u -t wvin.XXXXXX); mkfifo "$FIFO"
BOOTLOG=$(mktemp -t node-alpine-boot-log.XXXXXX)
trap 'rm -f "$WORK" "$RAW_SNAP" "$RAW_DELTA" "$FIFO" "$BOOTLOG"' EXIT
(
  # Hold the FIFO open for writing for the whole run so the CLI never sees stdin EOF.
  exec 3>"$FIFO"
  for _ in $(seq 1 1800); do grep -q "login:" "$BOOTLOG" 2>/dev/null && break; sleep 1; done
  sleep 2; printf 'root\n'  >&3      # username
  sleep 3; printf '\n'      >&3      # answer a possible empty-password prompt / redraw the shell
  # Bring up eth0 via DHCP (slirp), then pull node+npm from the live mirror. The OUTPUT-ONLY marker
  # (`echo WVSNAP"READY"` — a quote between P and R so the echoed command never prints the literal
  # marker) is gated behind `node --version && npm --version`, so the snapshot fires ONLY at a shell
  # where Node is verified on PATH.
  sleep 3; printf 'udhcpc -i eth0 2>&1; apk update 2>&1; apk add nodejs npm 2>&1; node --version && npm --version && echo WVSNAP"READY"\n' >&3
  sleep 5400                          # keep the FIFO writer alive across the boot + apk install
) &
WRITER=$!

# Device topology MUST match the browser chunked/persistent Alpine machine: virtio-blk slot 0
# (--drive), virtio-net slot 1 (--net-slirp for real outbound), virtio-rng slot 2 (--virtio-rng).
# The slirp vs loopback backend is NOT part of the snapshotted device topology (the browser restores
# with its own slirp backend), so --net-slirp here is compatible with the shipped bare-Alpine snapshot.
"$BIN" boot \
  --kernel "$KERNEL" \
  --drive "file=$WORK" \
  --net-slirp \
  --virtio-rng \
  --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" \
  --max-instrs 1500000000000 \
  --snapshot-trigger "WVSNAPREADY" \
  --snapshot-out "$RAW_SNAP" \
  --snapshot-core-id "$CORE_HEX" \
  --snapshot-base-id "$BASE_HEX" < "$FIFO" | tee "$BOOTLOG"
kill "$WRITER" 2>/dev/null || true

[ -s "$RAW_SNAP" ] || { echo "build-node-alpine-snapshot: no snapshot written (marker never fired — check apk/node in the log above)" >&2; exit 1; }

# ── Compute the overlay-delta, coherent against the DEPLOYED R2 chunk base WITHOUT fetching R2 ──────
# Identical algorithm to build-alpine-snapshot.sh: a block is included (POST-BOOT content) when EITHER
# the boot WROTE it (post-boot ext4 ≠ pristine), OR it lies in a chunk that DRIFTS from the manifest.
echo "[node-alpine-snapshot] computing overlay-delta (writes ∪ drifted-chunk coverage vs the R2 base)…"
python3 - "$WORK" "$PRISTINE" "$CHUNK_MANIFEST" "$BASE_HEX" "$RAW_DELTA" <<'PY'
import json,sys,struct,hashlib
work,pristine,manifest_path,base_hex,out=sys.argv[1:6]
m=json.load(open(manifest_path))
image_len=m["image_len"]; cs=m["chunk_size"]; chunks=m["chunks"]
OB=4096
per_chunk=cs//OB
drift_chunks=set()
with open(pristine,"rb") as p:
    for ci,exp in enumerate(chunks):
        if hashlib.sha256(p.read(cs)).hexdigest()!=exp:
            drift_chunks.add(ci)
blocks=[]
nblk=(image_len+OB-1)//OB
with open(work,"rb") as w, open(pristine,"rb") as p:
    for i in range(nblk):
        w.seek(i*OB); wb=w.read(OB)
        p.seek(i*OB); pb=p.read(OB)
        if len(wb)<OB: wb=wb+b"\x00"*(OB-len(wb))
        if len(pb)<OB: pb=pb+b"\x00"*(OB-len(pb))
        if wb!=pb or (i//per_chunk) in drift_chunks:
            blocks.append((i,wb))
print(f"overlay-delta: {len(drift_chunks)} drifting chunks covered",file=sys.stderr)
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
echo "[node-alpine-snapshot] RAM   raw=$(wc -c <"$RAW_SNAP")B  gz=$(wc -c <"$RAM_GZ")B  sha256=$(shasum -a256 "$RAM_GZ"|awk '{print $1}')"
echo "[node-alpine-snapshot] delta raw=$(wc -c <"$RAW_DELTA")B  gz=$(wc -c <"$DELTA_GZ")B  sha256=$(shasum -a256 "$DELTA_GZ"|awk '{print $1}')"
echo "[node-alpine-snapshot] wrote $RAM_GZ and $DELTA_GZ"

for f in "$RAM_GZ" "$DELTA_GZ"; do
  if [ "$(wc -c <"$f")" -gt $((25*1024*1024)) ]; then
    echo "[node-alpine-snapshot] NOTE: $f exceeds Cloudflare Pages' 25 MiB cap — ship it via R2." >&2
  fi
done
