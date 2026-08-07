#!/usr/bin/env bash
# Generate the local browser manifest that pairs the pinned kernel with the production Alpine
# image. The rootfs remains outside web/; serve-dev maps /releases/* without copying 512 MiB.
set -euo pipefail
cd "$(dirname "$0")/.."

kernel="releases/kernel/6.6.63/Image"
rootfs="releases/rootfs/alpine-rootfs.ext4"
out="web/artifacts-alpine.json"

[ -f "$kernel" ] || { echo "gen-alpine-manifest: missing $kernel" >&2; exit 2; }
[ -f "$rootfs" ] || { echo "gen-alpine-manifest: missing $rootfs" >&2; exit 2; }

ksha=$(shasum -a 256 "$kernel" | awk '{print $1}')
ksize=$(wc -c < "$kernel" | tr -d ' ')
rsha=$(shasum -a 256 "$rootfs" | awk '{print $1}')
rsize=$(wc -c < "$rootfs" | tr -d ' ')

# E4 restore-on-load: include the Alpine RAM boot-snapshot + overlay-delta artifacts when present
# (produced by tools/build-alpine-snapshot.sh). Both ship ON Pages (URLs kept relative; deploy-cloudflare
# keeps them relative and copies the files). Their absence just means Alpine cold-boots.
ram="releases/boot-snapshot/alpine-ready.snap.gz"
delta="releases/boot-snapshot/alpine-overlay-delta.bin.gz"
extra=""
if [ -f "$ram" ] && [ -f "$delta" ]; then
  rsnap_sha=$(shasum -a 256 "$ram" | awk '{print $1}'); rsnap_size=$(wc -c < "$ram" | tr -d ' ')
  dsha=$(shasum -a 256 "$delta" | awk '{print $1}'); dsize=$(wc -c < "$delta" | tr -d ' ')
  extra=$(cat <<JSON
,
    "bootSnapshot": { "url": "$ram", "sha256": "$rsnap_sha", "size": $rsnap_size },
    "overlayDelta": { "url": "$delta", "sha256": "$dsha", "size": $dsize }
JSON
)
fi

cat > "$out" <<JSON
{
  "generated": "LOCAL-ONLY production Alpine manifest (tools/gen-alpine-manifest.sh)",
  "artifacts": {
    "kernel": { "url": "releases/kernel/6.6.63/Image", "sha256": "$ksha", "size": $ksize },
    "rootfs": { "url": "releases/rootfs/alpine-rootfs.ext4", "sha256": "$rsha", "size": $rsize }$extra
  }
}
JSON
echo "gen-alpine-manifest: wrote $out (rootfs $rsize bytes, sha256 $rsha)" >&2
