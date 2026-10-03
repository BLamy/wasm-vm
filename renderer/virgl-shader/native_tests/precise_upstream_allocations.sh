#!/usr/bin/env bash
# Promoted fresh verifier test; build exclusively in the supplied scratch dir.
set -euo pipefail
shader_dir=$(cd "$(dirname "$0")/.." && pwd)
test_output=${1:?Provide an isolated test output directory}
mkdir -p "$test_output"
test_output=$(cd "$test_output" && pwd)
cd "$shader_dir"
python3 verify_sources.py
sources=(bridge.c raw_bits.c generated/u_format_table.c checked_upstream.c
  vendor/src/gallium/auxiliary/tgsi/*.c
  vendor/src/gallium/auxiliary/cso_cache/cso_hash.c
  vendor/src/gallium/auxiliary/cso_cache/cso_cache.c vendor/src/mesa/util/u_debug.c)
common=(-std=gnu11 -D_GNU_SOURCE -D_DARWIN_C_SOURCE
  -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0
  -DHAVE___BUILTIN_CLZ=1 -DHAVE___BUILTIN_CLZLL=1 -DHAVE___BUILTIN_POPCOUNT=1
  -I. -Igenerated -Ivendor/src -Ivendor/src/mesa -Ivendor/src/mesa/pipe
  -Ivendor/src/mesa/compat -Ivendor/src/gallium/include
  -Ivendor/src/gallium/auxiliary -Ivendor/src/gallium/auxiliary/util)
"${CC:-clang}" "${common[@]}" -g -O1 -fno-omit-frame-pointer \
  -fsanitize=address,undefined -DBRIDGE_UPSTREAM_ALLOCATION_TEST \
  "${sources[@]}" native_tests/precise_upstream_allocations.c -lm \
  -o "$test_output/precise-upstream-allocations"
UBSAN_OPTIONS=halt_on_error=1 ASAN_OPTIONS=abort_on_error=1 \
  "$test_output/precise-upstream-allocations" > "$test_output/results.jsonl"
tail -1 "$test_output/results.jsonl"
