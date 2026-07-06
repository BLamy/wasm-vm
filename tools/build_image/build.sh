#!/usr/bin/env bash
# E3-T11: one command to build the production Alpine riscv64 disk image REPRODUCIBLY, chunk it
# into the E3-T01 format, and emit a CDN-ready artifact directory with an image-info record.
#
#   bash tools/build_image/build.sh
#     → releases/rootfs/alpine-rootfs.ext4            (E2-T18 reproducible ext4)
#     → releases/chunked-alpine/{manifest.json,chunks/<hash>.bin}
#     → releases/chunked-alpine/image-info.json       (build inputs, pinned versions)
#     runs chunk-verify (manifest ↔ chunks/ integrity) and fails on any defect.
#
# Env knobs:
#   REPRO_CHECK=1   build the ext4 TWICE and fail if manifest.json differs (reproducibility gate)
#   CHUNK_SIZE=N    override the chunk size (default 128 KiB — matches the loader)
#   UPDATE_MANIFEST=1  accept an Alpine package-set drift (passed through to build-rootfs)
#
# Docker-only host requirement (same as the kernel/rootfs builds). Everything determinism-
# sensitive (pinned base image by digest, version-pinned apk tools, fixed FS UUID +
# SOURCE_DATE_EPOCH, mke2fs -d with -O ^metadata_csum) lives in tools/build-rootfs.sh /
# tools/rootfs-inner.sh; this script orchestrates + chunks + verifies + records.
set -euo pipefail
cd "$(dirname "$0")/../.."

CHUNK_SIZE="${CHUNK_SIZE:-$((128 * 1024))}"
ROOTFS="releases/rootfs/alpine-rootfs.ext4"
ART="releases/chunked-alpine"
CLI="target/release/wasm-vm"

log() { echo "build_image: $*" >&2; }

# 0. The native CLI does the chunk/verify/churn — build it once (release for speed on the big image).
log "building the wasm-vm CLI (release)…"
cargo build --release -p wasm-vm-cli >/dev/null

# 1. Reproducible ext4 rootfs (E2-T18). Optionally build twice and diff manifests up front.
build_and_chunk_to() {
  local dest="$1"
  log "building the Alpine rootfs (Docker)…"
  bash tools/build-rootfs.sh
  # Keep a copy of the image alongside its chunk set so a failed REPRO_CHECK can dumpe2fs-diff.
  cp -f "$ROOTFS" "${dest}.ext4" 2>/dev/null || true
  log "chunking → $dest (chunk-size $CHUNK_SIZE)…"
  rm -rf "$dest"
  "$CLI" chunk "$ROOTFS" --out "$dest" --chunk-size "$CHUNK_SIZE" --layout split
}

if [ "${REPRO_CHECK:-0}" = 1 ]; then
  log "REPRODUCIBILITY GATE: building twice and diffing manifests…"
  build_and_chunk_to "target/repro-a"
  build_and_chunk_to "target/repro-b"
  if ! diff -q "target/repro-a/manifest.json" "target/repro-b/manifest.json" >/dev/null; then
    log "FAIL: two builds produced different manifests — the image is not byte-reproducible."
    "$CLI" chunk-churn --old target/repro-a --new target/repro-b >&2 || true
    # Pinpoint the nondeterministic ext4 metadata: which chunk INDICES differ (index 0-3 =
    # superblock/group-descriptors/inode-table). A dumpe2fs of both images (kept as
    # target/repro-{a,b}.ext4 when REPRO_CHECK) narrows it to a superblock field / inode order.
    python3 - <<'PY' >&2 || true
import json
a=json.load(open('target/repro-a/manifest.json'))['chunks']
b=json.load(open('target/repro-b/manifest.json'))['chunks']
d=[i for i,(x,y) in enumerate(zip(a,b)) if x!=y]
print("build_image: differing chunk indices:", d[:32], "total", len(d))
print("build_image: (0-3 = ext4 superblock/GDT/inode-table metadata; dumpe2fs both to pinpoint)")
PY
    exit 1
  fi
  log "reproducibility OK: identical manifest across two builds."
  rm -rf target/repro-b
  mv target/repro-a "$ART.tmp" && rm -rf "$ART" && mv "$ART.tmp" "$ART"
else
  build_and_chunk_to "$ART"
fi

# 2. Integrity gate: manifest ↔ chunks/ must be mutually consistent (no missing/corrupt/orphan,
#    no oversized chunk). Fails the build on any defect.
log "verifying the artifact directory…"
"$CLI" chunk-verify "$ART"

# 3. image-info.json — the build provenance (safe to serve immutable; names are content hashes).
#    Records the Alpine release, mirror, epoch, chunk size, and the exact resolved package set.
IMAGE_SHA=$(shasum -a 256 "$ROOTFS" | awk '{print $1}')
IMAGE_LEN=$(wc -c < "$ROOTFS" | tr -d ' ')
NCHUNKS=$(find "$ART/chunks" -type f | wc -l | tr -d ' ')
ALPINE_BRANCH=$(grep -m1 '^ALPINE_BRANCH=' tools/build-rootfs.sh | cut -d= -f2)
MIRROR=$(grep -m1 '^MIRROR=' tools/build-rootfs.sh | cut -d'"' -f2)
EPOCH=$(grep -m1 'SOURCE_DATE_EPOCH=' tools/build-rootfs.sh | grep -oE '[0-9]+' | head -1)
# The committed, drift-gated package lock (E2-T18) IS the exact-version record.
PKGS_JSON=$(awk 'NF{printf "%s\"%s\"", (NR>1?",":""), $0}' releases/rootfs/MANIFEST.txt 2>/dev/null || echo "")
cat > "$ART/image-info.json" <<JSON
{
  "generated_by": "tools/build_image/build.sh (E3-T11)",
  "alpine_branch": "${ALPINE_BRANCH}",
  "mirror": "${MIRROR}",
  "source_date_epoch": ${EPOCH:-0},
  "chunk_size": ${CHUNK_SIZE},
  "image": { "path": "releases/rootfs/alpine-rootfs.ext4", "sha256": "${IMAGE_SHA}", "size": ${IMAGE_LEN} },
  "chunks": ${NCHUNKS},
  "packages": [${PKGS_JSON}]
}
JSON
log "wrote $ART/image-info.json (${NCHUNKS} chunks, image ${IMAGE_LEN} bytes)"

# 4. Regenerate the local-only web manifest so the demo boots this exact image.
if [ -f tools/demo-capstone.sh ]; then
  log "note: run tools/demo-capstone.sh to refresh web/artifacts-alpine.json for the local demo."
fi
log "DONE. To measure CDN churn vs a previous build: \
$CLI chunk-churn --old <old-art-dir> --new $ART --max-churn-pct 50"
