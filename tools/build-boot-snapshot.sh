#!/usr/bin/env bash
# E4 restore-on-first-load — build the shipped, build-time busybox BOOT SNAPSHOT.
#
# Boots the busybox host once (native CLI) to the "busybox userland up" console marker, takes a
# whole-machine resume snapshot at that point, stamps it with the coherence identity the BROWSER
# build will validate against (so the guard accepts it for the matching build only), compresses it,
# and records it in web/artifacts.json as a `bootSnapshot` entry.
#
#   bash tools/build-boot-snapshot.sh            # build the snapshot (reuses an existing release CLI)
#   REBUILD=1 bash tools/build-boot-snapshot.sh  # force `cargo build --release -p wasm-vm-cli` first
#
# Coherence identity (see web/boot-path.js + crates/wasm build_core_hash / crates/cli --snapshot-*-id):
#   core_hash  = the wasm crate version bytes, zero-padded to 32 — a DIFFERENT build rejects the blob.
#   base_id    = SHA-256("<kernelSha256>\n<initramfsSha256>") — a kernel/initramfs swap rejects it.
# The browser derives BOTH identically, so a stale shipped snapshot falls back to a normal cold boot.
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=target/release/wasm-vm
KERNEL=releases/kernel/6.6.63/Image
INITRD=releases/initramfs/initramfs.cpio.gz
OUT_DIR=releases/boot-snapshot
OUT_GZ="$OUT_DIR/busybox-ready.snap.gz"
TRIGGER="busybox userland up"

for f in "$KERNEL" "$INITRD"; do
  [ -f "$f" ] || { echo "build-boot-snapshot: missing $f — fetch the pinned artifacts first" >&2; exit 1; }
done

if [ "${REBUILD:-0}" = "1" ] || [ ! -x "$BIN" ]; then
  echo "[boot-snapshot] building release CLI…"
  cargo build --release -p wasm-vm-cli
fi

# --- Coherence identity, computed to match the browser build exactly. -------------------------------
# The wasm crate inherits the workspace version; build_core_hash() = its bytes zero-padded to 32.
VER=$(awk -F'"' '/^version[[:space:]]*=/{print $2; exit}' Cargo.toml)
CORE_HEX=$(printf '%s' "$VER" | xxd -p | tr -d '\n')
CORE_HEX=$(printf '%-64s' "$CORE_HEX" | tr ' ' '0')

KSHA=$(shasum -a 256 "$KERNEL" | awk '{print $1}')
ISHA=$(shasum -a 256 "$INITRD" | awk '{print $1}')
# base_id = SHA-256 of the UTF-8 bytes "<kernelSha>\n<initramfsSha>" (matches deriveBootSnapshotBaseId).
BASE_HEX=$(printf '%s\n%s' "$KSHA" "$ISHA" | shasum -a 256 | awk '{print $1}')

echo "[boot-snapshot] core_id=$CORE_HEX (version $VER)"
echo "[boot-snapshot] base_id=$BASE_HEX"

TMP_SNAP=$(mktemp -t wvbootsnap.XXXXXX)
trap 'rm -f "$TMP_SNAP"' EXIT

# Device topology MUST match the browser busybox machine (crates/wasm assemble, DiskChoice::None) so
# the snapshot's device sections restore cleanly there: NO --drive (empty virtio slots, like the
# browser), plus --net (loopback virtio-net in slot 1) and --virtio-rng (slot 2), which the browser
# attaches unconditionally on every boot.
echo "[boot-snapshot] booting busybox to \"$TRIGGER\" and snapshotting (device set matched to the browser)…"
"$BIN" boot \
  --kernel "$KERNEL" \
  --initrd "$INITRD" \
  --net \
  --virtio-rng \
  --no-input \
  --max-instrs 30000000000 \
  --snapshot-trigger "$TRIGGER" \
  --snapshot-out "$TMP_SNAP" \
  --snapshot-core-id "$CORE_HEX" \
  --snapshot-base-id "$BASE_HEX"

[ -s "$TMP_SNAP" ] || { echo "build-boot-snapshot: no snapshot was written" >&2; exit 1; }
RAW_SIZE=$(wc -c < "$TMP_SNAP" | tr -d ' ')

mkdir -p "$OUT_DIR"
gzip -9 -c "$TMP_SNAP" > "$OUT_GZ"
GZ_SIZE=$(wc -c < "$OUT_GZ" | tr -d ' ')
GZ_SHA=$(shasum -a 256 "$OUT_GZ" | awk '{print $1}')

echo "[boot-snapshot] raw=${RAW_SIZE}B  gz=${GZ_SIZE}B  sha256=$GZ_SHA"
echo "[boot-snapshot] wrote $OUT_GZ"

# Cloudflare Pages caps files at 25 MiB. A compressed busybox snapshot is a few MB and ships on Pages;
# if a (bigger) snapshot ever exceeds the cap, move it to R2 like the kernel/initramfs and repoint it.
if [ "$GZ_SIZE" -gt $((25 * 1024 * 1024)) ]; then
  echo "[boot-snapshot] WARNING: $OUT_GZ is over Cloudflare Pages' 25 MiB limit — ship it via R2 instead." >&2
fi

echo "[boot-snapshot] regenerating web/artifacts.json…"
bash tools/gen-web-manifest.sh
