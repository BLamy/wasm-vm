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
IMAGE="${REPLAY_DESKTOP_IMAGE:-target/e5-t41a/image/replay-desktop.ext4}"
MANIFEST="${REPLAY_DESKTOP_CHUNKS:-releases/rootfs/replay-desktop-20f03da7c51d.chunks.json}"
OUT_DIR="${REPLAY_DESKTOP_SNAPSHOT_DIR:-releases/boot-snapshot}"
WORK_DIR="${REPLAY_DESKTOP_SNAPSHOT_WORK:-target/e5-t41b/work}"
BOOTLOG="${REPLAY_DESKTOP_BOOT_LOG:-evidence/e5-t41b/capture/native-capture.log}"
RECORD="${REPLAY_DESKTOP_SNAPSHOT_RECORD:-evidence/e5-t41b/capture/snapshot.json}"
MAX_INSTRS="${MAX_INSTRS:-100000000000}"
# Must equal web/main.js REPLAY_DESKTOP_BOOTARGS (the browser cold boot's command line).
APPEND="root=/dev/vda ro rootfstype=ext4 rootwait init=/sbin/init console=ttyS0 earlycon=sbi quiet loglevel=4"
# The monitor prints REPLAY_DESKTOP_READY when the desktop is up and REPLAY_NODE_SNAPSHOT (always
# after it) once Node's startup snapshot is in tmpfs. The capture then types one command line
# into the serial root shell and fires on the line it prints last:
#
#   1. `sleep 30` — Chrome schedules start-up work for its first 10-20 guest seconds (measured:
#      1.65 s of guest CPU between uptime 11 s and 21 s, then under 0.1% for minutes). Captured
#      after it, a resumed desktop is idle from its first second; under the paced clock that
#      work would otherwise run in the user's first real half minute.
#   2. Compaction. A RAM snapshot stores every page that is not zero, including pages the
#      kernel has freed (their old contents stay) and page cache nobody maps; building Node's
#      snapshot leaves about 75 MiB of both. So: drop the unmapped page cache (everything is
#      re-readable from the read-only root), run node the ways a user's first command does
#      (a bare start, printing, -p, -e code that loads fs/os/path and starts a child, a
#      script file, an ES module, a shebang script, the REPL, crypto, zlib and Intl in two locales — E5-T41b's round-2 verifier found each of the last five
#      reading 0.1-6.8 MB; a worker thread, 4.2 MB more, is left out to stay under 135 MB): the
#      parts of its binary those touch are cached again, and the first `node` of a resumed
#      session reads nothing from disk — `node -e 0` alone left 576 KiB of a printing start
#      uncached (E5-T41b's verifier), then hand nearly all free memory to one `dd` that only zeroes it and exits.
#      16 MiB stay untouched so nothing else is pushed out meanwhile (48 gave 135.8 MB with the
#      wider warm-up; E5-T41b round 3).
#
# The marker is typed as two adjacent shell words, so the console's echo of the command line
# cannot fire the trigger. If any step fails the guest powers off: the capture ends at once
# with no snapshot instead of running to MAX_INSTRS. A boot whose Node snapshot build failed
# prints REPLAY_NODE_SNAPSHOT_FAILED and is never captured either.
NODE_MARKER="REPLAY_NODE_SNAPSHOT bytes="
SETTLE_GUEST_SECONDS="${REPLAY_DESKTOP_SETTLE_SECONDS:-30}"
TRIGGER="REPLAY_DESKTOP_COMPACTED zeroed_mib="
# The compaction is typed as a script, one short line at a time (busybox's line editor cuts a
# typed line at about 1 KiB), then run; any failing step powers the guest off.
read -r -d '' COMPACT_SCRIPT <<'SCRIPT' || true
set -e
N=/usr/local/bin/node
sleep __SETTLE__
sync
echo 1 > /proc/sys/vm/drop_caches
$N -e 0
$N -e 'console.log(1)' >/dev/null
$N -p process.version >/dev/null
$N -e 'const cp=require("child_process"),fs=require("fs"),os=require("os"),path=require("path");fs.readFileSync("/etc/hostname");cp.execFileSync(process.execPath,["-p","6*7"]);console.log(os.arch(),path.sep)' >/dev/null
echo 'console.log(1)' > /tmp/warm.js
echo 'import os from "node:os"; console.log(os.arch())' > /tmp/warm.mjs
$N /tmp/warm.js >/dev/null
$N /tmp/warm.mjs >/dev/null
echo '#!/usr/bin/env node' > /tmp/warm
echo 'console.log(1)' >> /tmp/warm
chmod +x /tmp/warm
/tmp/warm >/dev/null
printf '1+1\n.exit\n' | $N -i >/dev/null
$N -e 'require("crypto").createHash("sha256").update("x").digest("hex");require("zlib").gzipSync("x")' >/dev/null
$N -e 'console.log(new Intl.DateTimeFormat("de",{month:"long"}).format(0),new Intl.NumberFormat("en").format(1234.5),new Date(0).toLocaleString())' >/dev/null
rm -f /tmp/warm /tmp/warm.js /tmp/warm.mjs
z=$(($(awk '/^MemFree:/{print int($2/1024)}' /proc/meminfo) - 16))
[ $z -gt 0 ]
dd if=/dev/zero of=/dev/null bs=${z}M count=1 2>/dev/null
echo REPLAY_DESKTOP_COMPACT''ED zeroed_mib=$z uptime=$(cut -d' ' -f1 /proc/uptime)
SCRIPT
COMPACT_SCRIPT=${COMPACT_SCRIPT//__SETTLE__/$SETTLE_GUEST_SECONDS}

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
cleanup() { [ -z "${FEEDER:-}" ] || kill "$FEEDER" 2>/dev/null || true; [ "${REPLAY_DESKTOP_KEEP_WORK:-0}" = 1 ] || rm -rf "$WORK_DIR"; }
trap cleanup EXIT
# APFS clone: no second physical copy; the release image stays immutable.
cp -c "$IMAGE" "$WORK" 2>/dev/null || cp "$IMAGE" "$WORK"

echo "[replay-snapshot] cold-booting to $TRIGGER (browser device topology)…"
T0=$(date +%s)
# The guest's console input: nothing until the Node marker, then the one command.
STDIN_FIFO="$WORK_DIR/console-in"
mkfifo "$STDIN_FIFO"
: > "$BOOTLOG"
(
  exec 3>"$STDIN_FIFO"
  until grep -aq "$NODE_MARKER" "$BOOTLOG"; do sleep 1; done
  sleep 2 # let the monitor's line end and the shell sit at its prompt
  printf '%s\n' "cat > /tmp/compact.sh <<'COMPACT_EOF'" >&3
  printf '%s\n' "$COMPACT_SCRIPT" >&3
  printf '%s\n' "COMPACT_EOF" "sh /tmp/compact.sh || poweroff -f" >&3
  exec sleep 86400 # (exec: the cleanup's kill of $FEEDER then ends it)
) &
FEEDER=$!
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
  --snapshot-base-id "$BASE_HEX" <"$STDIN_FIFO" 2>&1 | tee "$BOOTLOG"
T1=$(date +%s)
kill "$FEEDER" 2>/dev/null || true
grep -aq "$NODE_MARKER" "$BOOTLOG" || { echo "build-replay-desktop-snapshot: the guest never reported its Node startup snapshot" >&2; exit 1; }
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
  "task": "E5-T41b", "url": "releases/boot-snapshot/$NAME", "sha256": "$GZ_SHA", "size": $GZ_LEN,
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
