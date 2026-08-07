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
# Device topology MUST match the browser chunked/persistent Alpine machine (crates/wasm assemble):
# virtio-blk slot 0 (--drive), virtio-net slot 1 (--net), virtio-rng slot 2 (--virtio-rng) — all three
# are attached on EVERY browser boot, so the snapshot's device sections must carry them or load_resume
# rejects the topology mismatch. (Mirrors tools/build-boot-snapshot.sh for busybox.)
# getty FLUSHES pre-typed input when it starts, so input must arrive AFTER the `login:` prompt is up —
# not piped at t=0. We feed the boot's stdin through a FIFO held open by a background writer that watches
# the console log for `login:` and only then sends `root`, an empty line (empty-password answer), and the
# OUTPUT-ONLY marker `echo WVSNAP"READY"` (the typed echo carries a quote between P and R, so the literal
# marker only appears in the command's STDOUT → the trigger fires at a genuinely idle, logged-in shell).
FIFO=$(mktemp -u -t wvin.XXXXXX); mkfifo "$FIFO"
BOOTLOG=$(mktemp -t alpine-boot-log.XXXXXX)
trap 'rm -f "$WORK" "$RAW_SNAP" "$RAW_DELTA" "$FIFO" "$BOOTLOG"' EXIT
(
  # Hold the FIFO open for writing for the whole boot so the CLI never sees stdin EOF.
  exec 3>"$FIFO"
  # Wait for the login prompt to appear in the tee'd console log.
  for _ in $(seq 1 1200); do grep -q "login:" "$BOOTLOG" 2>/dev/null && break; sleep 1; done
  sleep 2; printf 'root\n'  >&3      # username
  sleep 3; printf '\n'      >&3      # answer a possible empty-password prompt / redraw the shell
  sleep 3; printf 'echo WVSNAP"READY"\n' >&3   # output-only marker at the shell
  sleep 8; printf 'echo WVSNAP"READY"\n' >&3   # retry once in case the first landed during login
  sleep 30                            # keep the FIFO writer alive until the snapshot triggers
) &
WRITER=$!

# Device topology MUST match the browser chunked/persistent Alpine machine (crates/wasm assemble):
# virtio-blk slot 0 (--drive), virtio-net slot 1 (--net), virtio-rng slot 2 (--virtio-rng) — all three
# are attached on EVERY browser boot, so the snapshot's device sections must carry them or load_resume
# rejects the topology mismatch. (Mirrors tools/build-boot-snapshot.sh for busybox.) The console is
# tee'd to $BOOTLOG so the input writer can watch for `login:`.
"$BIN" boot \
  --kernel "$KERNEL" \
  --drive "file=$WORK" \
  --net \
  --virtio-rng \
  --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" \
  --max-instrs 60000000000 \
  --snapshot-trigger "WVSNAPREADY" \
  --snapshot-out "$RAW_SNAP" \
  --snapshot-core-id "$CORE_HEX" \
  --snapshot-base-id "$BASE_HEX" < "$FIFO" | tee "$BOOTLOG"
kill "$WRITER" 2>/dev/null || true

[ -s "$RAW_SNAP" ] || { echo "build-alpine-snapshot: no snapshot written" >&2; exit 1; }

# ── Compute the overlay-delta, coherent against the DEPLOYED R2 chunk base (base_hash in the manifest)
# WITHOUT fetching R2. A block is included (with its POST-BOOT content) when EITHER:
#   (a) the boot WROTE it (post-boot ext4 ≠ pristine)          — the copy-on-write set, OR
#   (b) it lies in a chunk that DRIFTS (SHA-256 of the pristine's chunk ≠ the manifest's chunk hash) —
#       i.e. the R2 base serves different bytes there than the pristine the guest booted from. Seeding
#       the post-boot (== pristine for untouched) content for those blocks makes the overlay override the
#       R2 base's drifted bytes, so every cache-miss read returns what the restored guest expects.
# (b) is what makes the artifact coherent against a base that has drifted from the on-disk pristine —
# the block-0 superblock plus ~dozens of other chunks here. Untouched, non-drifting blocks fall through
# to the R2 base, which is byte-identical there.
echo "[alpine-snapshot] computing overlay-delta (writes ∪ drifted-chunk coverage vs the R2 base)…"
python3 - "$WORK" "$PRISTINE" "$CHUNK_MANIFEST" "$BASE_HEX" "$RAW_DELTA" <<'PY'
import json,sys,struct,hashlib
work,pristine,manifest_path,base_hex,out=sys.argv[1:6]
m=json.load(open(manifest_path))
image_len=m["image_len"]; cs=m["chunk_size"]; chunks=m["chunks"]
OB=4096
per_chunk=cs//OB
# (b) which chunks drift: pristine chunk content hash != manifest chunk hash → cover ALL their blocks.
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
