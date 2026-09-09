#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${E5_T22C_TOOLS_OUT:-target/e5-t22c/display-tools}"
case "$out" in target/*) ;; *) exit 2 ;; esac
case "/$out/" in */../*) exit 2 ;; esac
weston="$out/weston-12.0.4"
test -f "$weston/libweston/backend-drm/drm-internal.h"
cc -g -O1 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -isystem tools/verify/fixtures/e5-t22c-platform -isystem tools/image/e5-t22c \
  -isystem "$out/sysroot/usr/include/libweston-12" \
  -isystem "$out/sysroot/usr/include/pixman-1" -isystem "$out/sysroot/usr/include/libdrm" \
  -isystem "$weston" -isystem "$weston/libweston" -isystem "$weston/include" \
  -idirafter "$out/sysroot/usr/include" tools/verify/fixtures/e5-t22c-resize-test.c \
  -o "$out/resize-test"
# Apple's ASan does not support LeakSanitizer. Explicit mode-pool and destroy
# assertions still run here; no Linux leak-sanitizer result is claimed on macOS.
leaks=1
if [ "$(uname -s)" = Darwin ]; then leaks=0; fi
ASAN_OPTIONS="detect_leaks=$leaks" UBSAN_OPTIONS=halt_on_error=1 "$out/resize-test"
