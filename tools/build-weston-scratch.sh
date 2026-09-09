#!/usr/bin/env bash
# E5-T16c: build the disposable Weston finalist image used by the native workload driver.
#
# The image is deliberately kept under target/ by default: it is a replay input, not the E5-T17
# production disk. The builder still goes through the signed riscv64 APK path from E2-T18 and
# emits a package/file manifest beside the image so the workload evidence can bind to its inputs.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

out="${E5_T16C_OUT:-target/e5-t16c/weston-image}"
size="${E5_T16C_IMG_SIZE:-1G}"
mkdir -p "$out"

# Weston splits its DRM backend and desktop shell into separate Alpine packages. Keep those
# package names explicit so a successful capture cannot silently fall back to a different backend
# or shell. Transitive dependencies are resolved by signed apk against the real Alpine v3.20
# riscv64 repositories and are frozen in MANIFEST.txt.
display_packages="weston weston-backend-drm weston-shell-desktop foot seatd eudev udev-init-scripts pixman xkeyboard-config wl-clipboard font-dejavu"
if [ -n "${E5_T16C_EXTRA_PKGS:-}" ]; then
  display_packages="$display_packages ${E5_T16C_EXTRA_PKGS}"
fi

if [ "${E5_T16C_UPDATE_MANIFEST:-0}" = 1 ]; then
  update_manifest=1
elif [ -s "$out/MANIFEST.txt" ]; then
  update_manifest=0
else
  update_manifest=1
fi

ROOTFS_OUT="$out" \
IMG_SIZE="$size" \
EXTRA_PKGS="$display_packages" \
DISPLAY_CANDIDATE=weston \
UPDATE_MANIFEST="$update_manifest" \
bash tools/build-rootfs.sh

printf '%s\n' "weston scratch image: $out/alpine-rootfs.ext4"
printf '%s\n' "package manifest: $out/MANIFEST.txt"
printf '%s\n' "file manifest: $out/FILE-MANIFEST.txt"
