#!/usr/bin/env bash
set -euo pipefail
cd renderer/virgl-shader
critic_dir=../../evidence/virgl-vertex-constant/verifier
common=(-std=gnu11 -D_GNU_SOURCE -D_DARWIN_C_SOURCE
 -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0
 -DHAVE___BUILTIN_CLZ=1 -DHAVE___BUILTIN_CLZLL=1 -DHAVE___BUILTIN_POPCOUNT=1
 -I. -Igenerated -Ivendor/src -Ivendor/src/mesa -Ivendor/src/mesa/pipe -Ivendor/src/mesa/compat
 -Ivendor/src/gallium/include -Ivendor/src/gallium/auxiliary -Ivendor/src/gallium/auxiliary/util)
instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined -fprofile-instr-generate -fcoverage-mapping)
clang "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/tgsi_scratch_boundaries.c
clang "${common[@]}" "${instrument[@]}" -Dmalloc=critic_scratch_malloc -c checked_tgsi_sanity.c -o "$critic_dir/fault-scratch.o"
sources=(bridge.c raw_bits.c generated/u_format_table.c checked_upstream.c checked_cso_hash.c)
for source in vendor/src/gallium/auxiliary/tgsi/*.c; do [[ "$source" == */tgsi_sanity.c ]] || sources+=("$source"); done
sources+=(vendor/src/gallium/auxiliary/cso_cache/cso_cache.c vendor/src/mesa/util/u_debug.c)
clang "${common[@]}" "${instrument[@]}" "${sources[@]}" "$critic_dir/fault-scratch.o" native_tests/tgsi_scratch_boundaries.c -lm -o "$critic_dir/scratch-boundary-test"
LLVM_PROFILE_FILE="$critic_dir/critic-scratch.profraw" ASAN_OPTIONS=abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1 "$critic_dir/scratch-boundary-test" > "$critic_dir/scratch-boundaries.json"
