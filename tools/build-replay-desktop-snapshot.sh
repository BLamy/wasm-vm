#!/usr/bin/env bash
# E5-T34e: capture the Replay desktop's warm RAM/device snapshot at REPLAY_DESKTOP_READY.
#
# Same machinery as tools/build-omarchy-snapshot.sh (native CLI `--snapshot-trigger` +
# `save_resume`, `--browser-topology`, the browser's JIT/ICount/quantum flags), applied to the exact
# E5-T34b image and the exact E5-T34c browser boot: 1 GiB RAM, the 6.6.63 kernel, the read-only
# root bootargs. The drive is attached writable, exactly like the browser's chunked disk (no
# VIRTIO_BLK_F_RO), but the guest mounts it `ro`; the capture PROVES that by re-hashing the
# working image afterwards. An unchanged SHA-256 means the RAM snapshot alone is coherent with the
# published image, so no overlay delta is shipped (the manifest says `readOnlyRoot: true`).
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="${BIN:-target/release/wasm-vm}"
KERNEL="${KERNEL:-releases/kernel/6.6.63/Image}"
IMAGE="${REPLAY_DESKTOP_IMAGE:-target/e5-t34b/image/replay-desktop.ext4}"
MANIFEST="${REPLAY_DESKTOP_CHUNKS:-releases/rootfs/replay-desktop-2af6100e9b37.chunks.json}"
OUT_DIR="${REPLAY_DESKTOP_SNAPSHOT_DIR:-releases/boot-snapshot}"
WORK_DIR="${REPLAY_DESKTOP_SNAPSHOT_WORK:-target/e5-t34e/work}"
BOOTLOG="${REPLAY_DESKTOP_BOOT_LOG:-evidence/e5-t34e/capture/native-capture.log}"
RECORD="${REPLAY_DESKTOP_SNAPSHOT_RECORD:-evidence/e5-t34e/capture/snapshot.json}"
MAX_INSTRS="${MAX_INSTRS:-40000000000000}"
# Must equal web/main.js REPLAY_DESKTOP_BOOTARGS (the browser cold boot's command line).
APPEND="root=/dev/vda ro rootfstype=ext4 rootwait init=/sbin/init console=ttyS0 earlycon=sbi quiet loglevel=4"
TRIGGER="REPLAY_DESKTOP_READY uptime="

for f in "$BIN" "$KERNEL" "$IMAGE" "$MANIFEST"; do
  [ -f "$f" ] || { echo "build-replay-desktop-snapshot: missing $f" >&2; exit 1; }
done
if [ "${REBUILD:-0}" = "1" ]; then cargo build --release -p wasm-vm-cli; fi

IMAGE_SHA=$(shasum -a 256 "$IMAGE" | awk '{print $1}')
KERNEL_SHA=$(shasum -a 256 "$KERNEL" | awk '{print $1}')
VER=$(awk -F'"' '/^version[[:space:]]*=/{print $2; exit}' Cargo.toml)
CORE_HEX=$(printf '%s' "$VER" | xxd -p | tr -d '\n')
CORE_HEX=$(printf '%-64s' "$CORE_HEX" | tr ' ' '0')
# ImageManifest::base_hash(): SHA-256 of the manifest's canonical compact JSON (same as Omarchy).
BASE_HEX=$(python3 - "$MANIFEST" "$IMAGE_SHA" <<'PY'
import hashlib, json, sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
identity = {key: manifest[key] for key in ("version", "image_len", "chunk_size", "layout", "chunks")}
print(hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest())
PY
)
echo "[replay-snapshot] image_sha256=$IMAGE_SHA kernel_sha256=$KERNEL_SHA"
echo "[replay-snapshot] core_id=$CORE_HEX (version $VER) base_id=$BASE_HEX"

rm -rf "$WORK_DIR"; mkdir -p "$WORK_DIR" "$(dirname "$BOOTLOG")" "$(dirname "$RECORD")" "$OUT_DIR"
WORK="$WORK_DIR/replay-desktop.ext4"
RAW_SNAP="$WORK_DIR/replay-desktop-ready.snap"
cleanup() { [ "${REPLAY_DESKTOP_KEEP_WORK:-0}" = 1 ] || rm -rf "$WORK_DIR"; }
trap cleanup EXIT
# APFS clone: no second physical copy; the release image stays immutable.
cp -c "$IMAGE" "$WORK" 2>/dev/null || cp "$IMAGE" "$WORK"

echo "[replay-snapshot] cold-booting to REPLAY_DESKTOP_READY (browser device topology)…"
T0=$(date +%s)
"$BIN" boot \
  --kernel "$KERNEL" \
  --drive "file=$WORK" \
  --ram-mib 1024 \
  --net \
  --virtio-rng \
  --browser-topology \
  --icount-divider 64 \
  --jit --block-cache --interrupt-batching \
  --quantum 500000 \
  --max-instrs "$MAX_INSTRS" \
  --append "$APPEND" \
  --snapshot-trigger "$TRIGGER" \
  --snapshot-out "$RAW_SNAP" \
  --snapshot-core-id "$CORE_HEX" \
  --snapshot-base-id "$BASE_HEX" </dev/null 2>&1 | tee "$BOOTLOG"
T1=$(date +%s)
[ -s "$RAW_SNAP" ] || { echo "build-replay-desktop-snapshot: no snapshot was written" >&2; exit 1; }

WORK_SHA=$(shasum -a 256 "$WORK" | awk '{print $1}')
if [ "$WORK_SHA" != "$IMAGE_SHA" ]; then
  echo "build-replay-desktop-snapshot: the guest changed its read-only root ($WORK_SHA); a disk delta would be required" >&2
  exit 1
fi
echo "[replay-snapshot] disk unchanged after capture: $WORK_SHA (no overlay delta needed)"

# The snapshot holds guest RAM: run the privacy boundary on it before it can be published.
python3 tools/privacy/check-no-replay-backend.py "$RAW_SNAP" | tee "$(dirname "$RECORD")/privacy-raw.txt"
RAW_SHA=$(shasum -a 256 "$RAW_SNAP" | awk '{print $1}')
RAW_LEN=$(wc -c <"$RAW_SNAP" | tr -d ' ')
gzip -9 -c "$RAW_SNAP" > "$WORK_DIR/snap.gz"
GZ_SHA=$(shasum -a 256 "$WORK_DIR/snap.gz" | awk '{print $1}')
GZ_LEN=$(wc -c <"$WORK_DIR/snap.gz" | tr -d ' ')
NAME="replay-desktop-ready-${GZ_SHA:0:12}.snap.gz"
mv "$WORK_DIR/snap.gz" "$OUT_DIR/$NAME"
python3 tools/privacy/check-no-replay-backend.py "$OUT_DIR/$NAME" | tee "$(dirname "$RECORD")/privacy-gz.txt"
mkdir -p "$(dirname "$RECORD")"
python3 - "$RECORD" <<PY
import json, sys
json.dump({
  "task": "E5-T34e", "url": "releases/boot-snapshot/$NAME", "sha256": "$GZ_SHA", "size": $GZ_LEN,
  "uncompressedSize": $RAW_LEN, "uncompressedSha256": "$RAW_SHA",
  "identity": {"imageSha256": "$IMAGE_SHA", "kernelSha256": "$KERNEL_SHA", "coreId": "$CORE_HEX",
    "baseId": "$BASE_HEX", "ramMib": 1024, "bootargs": "$APPEND", "guestClock": "icount",
    "icountDivider": 64, "deviceLayout": "browser-topology", "readOnlyRoot": True},
  "captureHostSeconds": $((T1 - T0)),
}, open(sys.argv[1], "w"), indent=2)
open(sys.argv[1], "a").write("\n")
PY
echo "[replay-snapshot] RAM raw=${RAW_LEN}B gz=${GZ_LEN}B sha256=$GZ_SHA -> $OUT_DIR/$NAME ($((T1 - T0)) s capture)"
echo "[replay-snapshot] record: $RECORD — copy its url/sha256/size/uncompressed*/identity into web/artifacts-replay-desktop.json artifacts.bootSnapshot"
