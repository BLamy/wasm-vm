#!/usr/bin/env bash
# E5-T17b: assemble the production Alpine riscv64 desktop image from the verified T17a profile.
#
# This wrapper owns the image-assembly slice only. It deliberately leaves T17c's two-build
# reproducibility/chunk gate, T17d's boot-order replay, and T17e's persistence/publication proof to
# their child tasks.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"

profile="$repo/tools/image/e5-t17a-desktop-packages.json"
out="${E5_T17B_OUT:-target/e5-t17b/desktop-image}"
size="${E5_T17B_IMG_SIZE:-1G}"

test -f "$profile"
node tools/verify/e5-t17a-desktop-package-manifest.mjs >/dev/null

# Convert only the T17a package entries into exact apk constraints. Keeping this extraction here
# means a package cannot be added to the production image by editing an unrelated shell variable.
profile_packages="$(node --input-type=module -e '
import { readFileSync } from "node:fs";
const profile = JSON.parse(readFileSync(process.argv[1], "utf8"));
if (profile.task !== "E5-T17a" || profile.architecture !== "riscv64" || profile.resolutionMode !== "online-or-offline") {
  throw new Error("unexpected T17a profile binding");
}
if (!Array.isArray(profile.packages) || profile.packages.length !== 11) throw new Error("unexpected T17a package count");
process.stdout.write(profile.packages.map(({ name, version }) => `${name}=${version}`).join(" "));
' "$profile")"
profile_package_ids="$(node --input-type=module -e '
import { readFileSync } from "node:fs";
const profile = JSON.parse(readFileSync(process.argv[1], "utf8"));
process.stdout.write(profile.packages.map(({ packageId }) => packageId).join("\n"));
' "$profile")"

mkdir -p "$(dirname "$out")"
mkdir -p "$out"

# Keep the requested package transaction identical across fresh output directories. The resolved
# MANIFEST.txt is an output lock (and may include transitive dependencies); feeding that whole file
# back to apk changes /etc/apk/world compared with the first base+desktop transaction. This small
# input lock instead combines the committed E3 package lock with the exact T17a direct package IDs.
{
  cat "$repo/releases/rootfs/MANIFEST.txt"
  printf '%s\n' "$profile_package_ids"
} > "$out/INSTALL-MANIFEST.txt"

had_full_lock=0

# Seed the base lock so the E3-derived package set is installed at the same exact versions as the
# verified rootfs. build-rootfs.sh then appends the profile's exact desktop packages and regenerates
# both package and custom-file manifests in this disposable production output directory.
# A failed first build may have left only the seeded base lock behind. Treat the output as a
# reusable full lock only after the image metadata and custom-file manifest were committed too.
if [ -n "${E5_T17B_PACKAGE_LOCK:-}" ]; then
  test -s "$E5_T17B_PACKAGE_LOCK"
  cp "$E5_T17B_PACKAGE_LOCK" "$out/MANIFEST.txt"
  had_full_lock=1
elif [ -s "$out/MANIFEST.txt" ] && [ -s "$out/FILE-MANIFEST.txt" ] && [ -s "$out/desktop-info.json" ]; then
  had_full_lock=1
else
  test -s "$repo/releases/rootfs/MANIFEST.txt"
  mkdir -p "$out"
  cp "$repo/releases/rootfs/MANIFEST.txt" "$out/MANIFEST.txt"
fi

update_manifest=1
if [ "$had_full_lock" -eq 1 ]; then update_manifest=0; fi

# On a first build, UPDATE_MANIFEST=1 is needed to accept the full base-plus-desktop lock, but the
# base portion must still be installed from the exact E3 lock. On a repeat build the supplied full
# lock is already exact. The force flag is scoped to this builder and does not relax any signature
# or package-drift checks.
force_locked_install=0
if [ "$had_full_lock" -eq 0 ]; then force_locked_install=1; fi

ROOTFS_OUT="$out" \
IMG_SIZE="$size" \
EXTRA_PKGS="$profile_packages" \
DISPLAY_CANDIDATE=desktop \
E5_T18B_INTERACTIVE="${E5_T18B_INTERACTIVE:-0}" \
UPDATE_MANIFEST="$update_manifest" \
FORCE_LOCKED_INSTALL="$force_locked_install" \
bash tools/build-rootfs.sh

test -s "$out/alpine-rootfs.ext4"
test -s "$out/MANIFEST.txt"
test -s "$out/FILE-MANIFEST.txt"

profile_sha=$(shasum -a 256 "$profile" | awk '{print $1}')
image_sha=$(shasum -a 256 "$out/alpine-rootfs.ext4" | awk '{print $1}')
image_size=$(wc -c < "$out/alpine-rootfs.ext4" | tr -d ' ')
package_manifest_sha=$(shasum -a 256 "$out/MANIFEST.txt" | awk '{print $1}')
file_manifest_sha=$(shasum -a 256 "$out/FILE-MANIFEST.txt" | awk '{print $1}')
case "$out" in
  "$repo"/*) info_out="${out#"$repo"/}" ;;
  /*) echo "E5-T17b output must be inside the repository for portable metadata: $out" >&2; exit 2 ;;
  *) info_out="${out#./}" ;;
esac
image_rel="$info_out/alpine-rootfs.ext4"
package_manifest_rel="$info_out/MANIFEST.txt"
file_manifest_rel="$info_out/FILE-MANIFEST.txt"
cat > "$out/desktop-info.json" <<JSON
{
  "schema": "wasm-vm.e5-t17b.desktop-image-info.v1",
  "task": "E5-T17b",
  "profile": {
    "path": "tools/image/e5-t17a-desktop-packages.json",
    "sha256": "$profile_sha"
  },
  "architecture": "riscv64",
  "image": {
    "path": "$image_rel",
    "sha256": "$image_sha",
    "size": $image_size
  },
  "packageManifest": {
    "path": "$package_manifest_rel",
    "sha256": "$package_manifest_sha"
  },
  "fileManifest": {
    "path": "$file_manifest_rel",
    "sha256": "$file_manifest_sha"
  },
  "startup": {
    "backend": "drm",
    "renderer": "pixman",
    "autologinTty": "tty1",
    "desktopUser": "desktop",
    "seatdRunlevel": "default"
  }
}
JSON

printf 'E5T17B_IMAGE=%s\n' "$out/alpine-rootfs.ext4"
printf 'E5T17B_IMAGE_SHA256=%s\n' "$image_sha"
printf 'E5T17B_PACKAGE_MANIFEST=%s\n' "$out/MANIFEST.txt"
printf 'E5T17B_FILE_MANIFEST=%s\n' "$out/FILE-MANIFEST.txt"
