#!/usr/bin/env bash
# Generate the Omarchy browser manifest from the complete matched desktop release.
set -euo pipefail
cd "$(dirname "$0")/.."

kernel="releases/kernel/6.6.63/Image"
out="web/artifacts-omarchy.json"
ram="releases/boot-snapshot/omarchy-ready.snap.gz"
delta="releases/boot-snapshot/omarchy-overlay-delta.bin.gz"

for artifact in "$kernel" "$ram" "$delta"; do
  [ -s "$artifact" ] || { echo "gen-omarchy-manifest: missing $artifact" >&2; exit 2; }
done
ksha=$(shasum -a 256 "$kernel" | awk '{print $1}')
ksize=$(wc -c < "$kernel" | tr -d ' ')

rsha=$(shasum -a 256 "$ram" | awk '{print $1}')
rsize=$(wc -c < "$ram" | tr -d ' ')
dsha=$(shasum -a 256 "$delta" | awk '{print $1}')
dsize=$(wc -c < "$delta" | tr -d ' ')

cat > "$out" <<JSON
{
  "generated": "content-hashed Omarchy desktop (kernel + paired RAM snapshot/disk delta)",
  "artifacts": {
    "kernel": { "url": "releases/kernel/6.6.63/Image", "sha256": "$ksha", "size": $ksize },
    "bootSnapshot": { "url": "$ram", "sha256": "$rsha", "size": $rsize },
    "overlayDelta": { "url": "$delta", "sha256": "$dsha", "size": $dsize }
  }
}
JSON
echo "gen-omarchy-manifest: wrote $out" >&2
