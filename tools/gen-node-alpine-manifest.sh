#!/usr/bin/env bash
# E3.6-T05 — generate web/artifacts-node-alpine.json: the browser manifest for the NODE-preinstalled
# Alpine restore. Identical to the bare-Alpine manifest (same pinned kernel, same chunked base) EXCEPT
# the bootSnapshot RAM blob + overlayDelta point at the node-alpine artifacts (built by
# tools/build-node-alpine-snapshot.sh), which restore straight to a shell with `node` on PATH.
#
# The node artifacts are BIG (node+npm write ~50-80 MB), so deploy-cloudflare.sh ships them on R2 when
# they exceed the 25 MiB Pages cap; the URLs here stay relative (releases/…) and are rewritten at
# deploy time exactly like the chunked base.
set -euo pipefail
cd "$(dirname "$0")/.."

kernel="releases/kernel/6.6.63/Image"
rootfs="releases/rootfs/alpine-rootfs.ext4"
out="web/artifacts-node-alpine.json"

[ -f "$kernel" ] || { echo "gen-node-alpine-manifest: missing $kernel" >&2; exit 2; }
[ -f "$rootfs" ] || { echo "gen-node-alpine-manifest: missing $rootfs" >&2; exit 2; }

ksha=$(shasum -a 256 "$kernel" | awk '{print $1}')
ksize=$(wc -c < "$kernel" | tr -d ' ')
rsha=$(shasum -a 256 "$rootfs" | awk '{print $1}')
rsize=$(wc -c < "$rootfs" | tr -d ' ')

ram="releases/boot-snapshot/node-alpine-ready.snap.gz"
delta="releases/boot-snapshot/node-alpine-overlay-delta.bin.gz"
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
  "generated": "LOCAL-ONLY node-preinstalled Alpine manifest (tools/gen-node-alpine-manifest.sh)",
  "artifacts": {
    "kernel": { "url": "releases/kernel/6.6.63/Image", "sha256": "$ksha", "size": $ksize },
    "rootfs": { "url": "releases/rootfs/alpine-rootfs.ext4", "sha256": "$rsha", "size": $rsize }$extra
  }
}
JSON
echo "gen-node-alpine-manifest: wrote $out" >&2
