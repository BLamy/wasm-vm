#!/usr/bin/env bash
# E5-T16b: build the disposable labwc finalist image used by the native workload driver.
#
# The image is deliberately kept under target/ by default: it is a replay input, not the E5-T17
# production disk.  The builder still goes through the signed riscv64 APK path from E2-T18 and
# emits a package/file manifest beside the image so the workload evidence can bind to its inputs.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

out="${E5_T16B_OUT:-target/e5-t16b/labwc-image}"
size="${E5_T16B_IMG_SIZE:-1G}"
mkdir -p "$out"

# Keep the finalist list in one reviewed, ordered string.  Transitive dependencies are resolved by
# signed apk against the real Alpine v3.20 riscv64 repositories and are frozen in MANIFEST.txt.
display_packages="labwc foot seatd eudev udev-init-scripts pixman xkeyboard-config wlr-randr wl-clipboard font-dejavu"
if [ -n "${E5_T16B_EXTRA_PKGS:-}" ]; then
  display_packages="$display_packages ${E5_T16B_EXTRA_PKGS}"
fi

if [ "${E5_T16B_UPDATE_MANIFEST:-0}" = 1 ]; then
  update_manifest=1
elif [ -s "$out/MANIFEST.txt" ]; then
  update_manifest=0
else
  update_manifest=1
fi

ROOTFS_OUT="$out" \
IMG_SIZE="$size" \
EXTRA_PKGS="$display_packages" \
DISPLAY_CANDIDATE=labwc \
UPDATE_MANIFEST="$update_manifest" \
bash tools/build-rootfs.sh

printf '%s\n' "labwc scratch image: $out/alpine-rootfs.ext4"
printf '%s\n' "package manifest: $out/MANIFEST.txt"
printf '%s\n' "file manifest: $out/FILE-MANIFEST.txt"
