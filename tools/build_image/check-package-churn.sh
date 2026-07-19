#!/usr/bin/env bash
# E3-T11 CDN-friendliness attack: add exactly one requested package to the deterministic base,
# build/chunk it, and require a majority of immutable chunk objects to remain shared.
set -euo pipefail
cd "$(dirname "$0")/../.."

PACKAGE="${CHURN_PACKAGE:-htop}"
ROOTFS="releases/rootfs/alpine-rootfs.ext4"
BASE_ART="releases/chunked-alpine"
BASE_DISK="target/e3-t11-churn-base.ext4"
VARIANT_ART="target/e3-t11-churn-${PACKAGE}"
CLI="target/release/wasm-vm"

for required in "$ROOTFS" "$BASE_ART/manifest.json" "$CLI"; do
  [ -e "$required" ] || { echo "check-package-churn: missing $required" >&2; exit 2; }
done

rm -f "$BASE_DISK"
cp -p "$ROOTFS" "$BASE_DISK"
restore() {
  cp -p "$BASE_DISK" "$ROOTFS"
  rm -f "$BASE_DISK" releases/rootfs/MANIFEST.new
}
trap restore EXIT

echo "check-package-churn: building disposable base + $PACKAGE variant…" >&2
EXTRA_PKGS="$PACKAGE" ALLOW_MANIFEST_DRIFT=1 bash tools/build-rootfs.sh
rm -rf "$VARIANT_ART"
"$CLI" chunk "$ROOTFS" --out "$VARIANT_ART" --chunk-size 131072 --layout split
"$CLI" chunk-verify "$VARIANT_ART"
"$CLI" chunk-churn --old "$BASE_ART" --new "$VARIANT_ART" --max-churn-pct 50
echo "check-package-churn: PASS — adding $PACKAGE preserved the majority of chunk objects" >&2
