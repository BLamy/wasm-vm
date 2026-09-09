#!/usr/bin/env bash
# Cross-build read-only display evidence tools against the pinned guest ABI.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"
out="${E5_T22C_TOOLS_OUT:-target/e5-t22c/display-tools}"
case "$out" in target/*) ;; *) echo 'display tools output must be a repository target/ path' >&2; exit 2 ;; esac
case "/$out/" in */../*) echo 'output traversal refused' >&2; exit 2 ;; esac
[ "$(zig version)" = 0.16.0 ] || { echo 'display tools require Zig 0.16.0' >&2; exit 2; }
mkdir -p "$out/sysroot"
docker build -q -f tools/rootfs.Dockerfile -t wasm-vm-rootfs-build:local tools >/dev/null
docker run --rm \
  -v "$repo/$out/sysroot:/sysroot" \
  -v "$repo/tools/image/e5-t22c/display-tools-packages.txt:/packages.txt:ro" \
  wasm-vm-rootfs-build:local -c '
    set -euo pipefail
    mapfile -t packages < <(sed -E "s/-([0-9][^-]*-r[0-9]+)$/=\1/" /packages.txt)
    apk.static --arch riscv64 -X https://dl-cdn.alpinelinux.org/alpine/v3.20/main \
      -X https://dl-cdn.alpinelinux.org/alpine/v3.20/community \
      --keys-dir /usr/share/apk/keys/riscv64 -U --root /sysroot --initdb --no-scripts add "${packages[@]}"
    apk.static --root /sysroot info -v | sort > /sysroot/PACKAGES.txt
    diff -u /packages.txt /sysroot/PACKAGES.txt
  '
display_sysroot="$repo/$out/sysroot"
# Use the exact upstream internal backend declarations, not hand-written offsets.
# The selected packaged libweston provides the exported native-mode switch.
weston_archive="$out/weston-12.0.4.tar.xz"
weston_sha=efdb21859b38f8cbc2b4b39ad65cc1ea3ed1adab23ac28bf501a8a9f80a31727
if [ ! -f "$weston_archive" ]; then
  curl --fail --location --retry 3 \
    https://gitlab.freedesktop.org/wayland/weston/-/releases/12.0.4/downloads/weston-12.0.4.tar.xz \
    -o "$weston_archive"
fi
[ "$(shasum -a 256 "$weston_archive" | cut -d' ' -f1)" = "$weston_sha" ] || { echo 'Weston source digest mismatch' >&2; exit 1; }
tar -xJf "$weston_archive" -C "$out"
weston_source="$repo/$out/weston-12.0.4"
cmp "$weston_source/include/libweston/libweston.h" "$display_sysroot/usr/include/libweston-12/libweston/libweston.h"
[ "$(shasum -a 256 "$display_sysroot/usr/lib/libweston-12.so.0.0.4" | cut -d' ' -f1)" = 5cb698515755daf1ebe26441abcdfaeabe0c2f7511c443fd57cbddf3762ce9f2 ] || { echo 'Weston binary ABI digest mismatch' >&2; exit 1; }
zig cc -target riscv64-linux-musl -O2 -g0 -s -Wall -Wextra -Werror \
  -ffile-prefix-map="$repo"=/wasm-vm -Wl,--build-id=none \
  -I "$display_sysroot/usr/include" \
  tools/guest/wv-display-query.c -L "$display_sysroot/usr/lib" -lwayland-client \
  -o "$out/wv-display-query"
file "$out/wv-display-query"
shasum -a 256 "$out/wv-display-query"
zig cc -target riscv64-linux-musl -O2 -g0 -s -Wall -Wextra -Werror \
  -ffile-prefix-map="$repo"=/wasm-vm -Wl,--build-id=none -shared -fPIC \
  -isystem "$display_sysroot/usr/include" -isystem "$display_sysroot/usr/include/libweston-12" \
  -isystem "$display_sysroot/usr/include/pixman-1" -isystem "$display_sysroot/usr/include/libdrm" \
  -isystem "$repo/tools/image/e5-t22c" -isystem "$weston_source" \
  -isystem "$weston_source/libweston" -isystem "$weston_source/include" \
  tools/guest/wv-display-resize.c -L "$display_sysroot/usr/lib" \
  -lweston-12 -lwayland-server -ldrm -o "$out/wv-display-resize.so"
file "$out/wv-display-resize.so"
shasum -a 256 "$out/wv-display-resize.so"
