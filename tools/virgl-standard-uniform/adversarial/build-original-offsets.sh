#!/usr/bin/env bash
set -euo pipefail
test_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$test_dir/../../.." && pwd)
mkdir -p "${1:?native output directory required}"
output=$(cd "$1" && pwd)
cd "$repo_root/renderer/virgl-shader"
python3 verify_sources.py
sources=(bridge.c raw_bits.c generated/u_format_table.c checked_upstream.c
  checked_tgsi_sanity.c checked_cso_hash.c)
for source in vendor/src/gallium/auxiliary/tgsi/*.c; do
  [[ "$source" == */tgsi_sanity.c ]] || sources+=("$source")
done
sources+=(vendor/src/gallium/auxiliary/cso_cache/cso_cache.c vendor/src/mesa/util/u_debug.c standard_guard.c standard_emit.c)
common=(-std=gnu11 -D_GNU_SOURCE -D_DARWIN_C_SOURCE
  -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0
  -DHAVE___BUILTIN_CLZ=1 -DHAVE___BUILTIN_CLZLL=1 -DHAVE___BUILTIN_POPCOUNT=1
  -I. -Igenerated -Ivendor/src -Ivendor/src/mesa -Ivendor/src/mesa/pipe
  -Ivendor/src/mesa/compat -Ivendor/src/gallium/include
  -Ivendor/src/gallium/auxiliary -Ivendor/src/gallium/auxiliary/util)
"${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only "$test_dir/original-offsets.c"
"${CC:-clang}" "${common[@]}" -g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer \
  -fprofile-instr-generate -fcoverage-mapping "${sources[@]}" "$test_dir/original-offsets.c" \
  -lm -o "$output/original-offsets"
