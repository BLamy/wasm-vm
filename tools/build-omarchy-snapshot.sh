#!/usr/bin/env bash
# Build the shipped Omarchy graphical-desktop resume snapshot and its matching disk delta.
#
# The snapshot is captured from the exact browser device topology and from the exact image/chunk
# manifest that production serves. It is deliberately a paired artifact: the RAM image alone is not
# safe because the compositor/session writes state to the ext4 image while it boots.
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="${BIN:-target/release/wasm-vm}"
KERNEL="${KERNEL:-releases/kernel/6.6.63/Image}"
IMAGE="${OMARCHY_IMAGE:-target/omarchy-profile-sdr-r3.ext4}"
CHUNKS="${OMARCHY_CHUNKS:-target/omarchy-profile-chunks-sdr-r3-256k}"
MANIFEST="$CHUNKS/manifest.json"
OUT_DIR="${OMARCHY_SNAPSHOT_DIR:-releases/boot-snapshot}"
RAM_GZ="$OUT_DIR/omarchy-ready.snap.gz"
DELTA_GZ="$OUT_DIR/omarchy-overlay-delta.bin.gz"
MAX_INSTRS="${MAX_INSTRS:-150000000000}"
KEEP_WORK="${OMARCHY_KEEP_WORK:-0}"
case "$KEEP_WORK" in 0|1) ;; *) echo "OMARCHY_KEEP_WORK must be 0 or 1" >&2; exit 1 ;; esac

for f in "$BIN" "$KERNEL" "$IMAGE" "$MANIFEST"; do
  [ -f "$f" ] || { echo "build-omarchy-snapshot: missing $f" >&2; exit 1; }
done

if [ "${REBUILD:-0}" = "1" ] || [ ! -x "$BIN" ]; then
  echo "[omarchy-snapshot] building release CLI…"
  cargo build --release -p wasm-vm-cli
fi

VER=$(awk -F'"' '/^version[[:space:]]*=/{print $2; exit}' Cargo.toml)
CORE_HEX=$(printf '%s' "$VER" | xxd -p | tr -d '\n')
CORE_HEX=$(printf '%-64s' "$CORE_HEX" | tr ' ' '0')
BASE_HEX=$(python3 - "$MANIFEST" <<'PY'
import hashlib, json, sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
identity = {key: manifest[key] for key in ("version", "image_len", "chunk_size", "layout", "chunks")}
print(hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest())
PY
)

echo "[omarchy-snapshot] core_id=$CORE_HEX (version $VER)"
echo "[omarchy-snapshot] base_id=$BASE_HEX"

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/omarchy-snapshot.XXXXXX")
WORK="$WORK_DIR/omarchy.ext4"
RAW_SNAP="$WORK_DIR/omarchy-ready.snap"
RAW_DELTA="$WORK_DIR/omarchy-overlay-delta.bin"
BOOTLOG="${OMARCHY_BOOT_LOG:-evidence/omarchy-profile/native-desktop-capture.log}"
mkdir -p "$(dirname "$BOOTLOG")"
cleanup() {
  if [ "$KEEP_WORK" = "1" ]; then
    echo "[omarchy-snapshot] diagnostic working image preserved in $WORK_DIR"
  else
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

# APFS clone avoids a second 4 GiB physical copy while keeping the release image immutable. The
# ordinary copy fallback is for Linux builders where clonefile is unavailable.
if ! cp -c "$IMAGE" "$WORK" 2>/dev/null; then
  rm -f "$WORK"
  cp "$IMAGE" "$WORK"
fi

echo "[omarchy-snapshot] booting to mapped Foot + the package-owned Omarchy shell…"
node tools/verify/omarchy-native-capture.mjs "$BIN" boot \
  --kernel "$KERNEL" \
  --drive "file=$WORK" \
  --ram-mib 1024 \
  --net \
  --virtio-rng \
  --browser-topology \
  --icount-divider 64 \
  --jit --block-cache --interrupt-batching \
  --append "root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0" \
  --quantum 500000 \
  --max-instrs "$MAX_INSTRS" \
  --snapshot-trigger "WVM_OMARCHY_DESKTOP_READY" \
  --snapshot-out "$RAW_SNAP" \
  --snapshot-core-id "$CORE_HEX" \
  --snapshot-base-id "$BASE_HEX" | tee "$BOOTLOG"
[ -s "$RAW_SNAP" ] || { echo "build-omarchy-snapshot: no snapshot was written" >&2; exit 1; }

echo "[omarchy-snapshot] computing the paired overlay delta against the published chunk base…"
python3 - "$WORK" "$CHUNKS" "$MANIFEST" "$BASE_HEX" "$RAW_DELTA" <<'PY'
import hashlib
import json
import struct
import sys

work_path, chunk_root, manifest_path, base_hex, output_path = sys.argv[1:]
manifest = json.load(open(manifest_path, encoding="utf-8"))
image_len = int(manifest["image_len"])
chunk_size = int(manifest["chunk_size"])
block_size = 4096
chunks = manifest["chunks"]
assert image_len % block_size == 0
assert image_len == chunk_size * len(chunks)

blocks = []
with open(work_path, "rb") as working:
    for chunk_index, digest in enumerate(chunks):
        chunk_path = f"{chunk_root}/chunks/{digest}.bin"
        with open(chunk_path, "rb") as chunk_file:
            base = chunk_file.read()
        if len(base) != chunk_size or hashlib.sha256(base).hexdigest() != digest:
            raise SystemExit(f"chunk integrity mismatch at {chunk_index}: {digest}")
        actual = working.read(chunk_size)
        if len(actual) != chunk_size:
            raise SystemExit(f"working image truncated at chunk {chunk_index}")
        for offset in range(0, chunk_size, block_size):
            base_block = base[offset:offset + block_size]
            actual_block = actual[offset:offset + block_size]
            if actual_block != base_block:
                block_index = (chunk_index * chunk_size + offset) // block_size
                blocks.append((block_index, actual_block))

with open(output_path, "wb") as output:
    output.write(b"WVOD1")
    output.write(struct.pack("<I", block_size))
    output.write(struct.pack("<Q", image_len))
    output.write(bytes.fromhex(base_hex))
    output.write(struct.pack("<Q", 0))
    output.write(struct.pack("<I", len(blocks)))
    for index, block in blocks:
        output.write(struct.pack("<Q", index))
        output.write(block)
print(f"overlay-delta: {len(blocks)} dirty 4KiB blocks / {len(blocks) * block_size} bytes", file=sys.stderr)
PY

mkdir -p "$OUT_DIR"
gzip -9 -c "$RAW_SNAP" > "$RAM_GZ"
gzip -9 -c "$RAW_DELTA" > "$DELTA_GZ"
echo "[omarchy-snapshot] RAM raw=$(wc -c <"$RAW_SNAP")B gz=$(wc -c <"$RAM_GZ")B sha256=$(shasum -a256 "$RAM_GZ" | awk '{print $1}')"
echo "[omarchy-snapshot] delta raw=$(wc -c <"$RAW_DELTA")B gz=$(wc -c <"$DELTA_GZ")B sha256=$(shasum -a256 "$DELTA_GZ" | awk '{print $1}')"
if [ "$OUT_DIR" = "releases/boot-snapshot" ]; then
  bash tools/gen-omarchy-manifest.sh
else
  echo "[omarchy-snapshot] candidate kept in $OUT_DIR; release manifest unchanged"
fi
