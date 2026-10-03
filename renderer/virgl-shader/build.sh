#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 verify_sources.py
mode=${1:-native}
mkdir -p "build/$mode"
sources=(bridge.c raw_bits.c generated/u_format_table.c vendor/src/vrend/vrend_shader.c
  vendor/src/gallium/auxiliary/tgsi/*.c
  vendor/src/gallium/auxiliary/cso_cache/cso_hash.c vendor/src/gallium/auxiliary/cso_cache/cso_cache.c
  vendor/src/mesa/util/u_debug.c)
common=(-std=gnu11 -D_GNU_SOURCE -D_DARWIN_C_SOURCE
  -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0
  -DHAVE___BUILTIN_CLZ=1 -DHAVE___BUILTIN_CLZLL=1 -DHAVE___BUILTIN_POPCOUNT=1
  -I. -Igenerated -Ivendor/src -Ivendor/src/mesa -Ivendor/src/mesa/pipe
  -Ivendor/src/mesa/compat -Ivendor/src/gallium/include
  -Ivendor/src/gallium/auxiliary -Ivendor/src/gallium/auxiliary/util)
case "$mode" in
  guard-check)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only bridge.c raw_bits.c native_tests/captured.c native_tests/components.c native_tests/pairs.c native_tests/banks.c native_tests/raw_bits.c native_tests/integer_masks.c
    ;;
  native)
    "${CC:-clang}" "${common[@]}" -O2 "${sources[@]}" cli.c -lm -o build/native/virgl-shader
    ;;
  sanitize)
    "${CC:-clang}" "${common[@]}" -g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined \
      "${sources[@]}" native_tests/hostile.c -lm -o build/sanitize/hostile-test
    UBSAN_OPTIONS=halt_on_error=1 ASAN_OPTIONS=abort_on_error=1 build/sanitize/hostile-test
    ;;
  captured-sanitize)
    "${CC:-clang}" "${common[@]}" -g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined \
      "${sources[@]}" native_tests/captured.c -lm -o build/captured-sanitize/captured-test
    ;;
  component-sanitize)
    "${CC:-clang}" "${common[@]}" -g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined \
      "${sources[@]}" native_tests/components.c -lm -o build/component-sanitize/component-test
    ;;
  pair-sanitize)
    "${CC:-clang}" "${common[@]}" -g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined \
      "${sources[@]}" native_tests/pairs.c -lm -o build/pair-sanitize/pair-test
    ;;
  bank-sanitize)
    "${CC:-clang}" "${common[@]}" -g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined \
      "${sources[@]}" native_tests/banks.c -lm -o build/bank-sanitize/bank-test
    ;;
  raw-bit-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -fstack-usage -c "$source.c" -o "build/raw-bit-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/raw-bit-sanitize/bridge.o build/raw-bit-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/raw_bits.c -lm -o build/raw-bit-sanitize/raw-bit-test
    ;;
  integer-mask-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -fstack-usage -c "$source.c" -o "build/integer-mask-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/integer-mask-sanitize/bridge.o build/integer-mask-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/integer_masks.c -lm -o build/integer-mask-sanitize/integer-mask-test
    ;;
  wasm)
    emcc=${EMCC:-${EMSDK:+$EMSDK/upstream/emscripten/emcc}}
    if [[ -z "$emcc" ]]; then echo 'Set EMCC to the pinned Emscripten 4.0.22 compiler.' >&2; exit 1; fi
    "$emcc" --version | head -1 | grep -q ' 4\.0\.22 ' || { echo 'Emscripten 4.0.22 required.' >&2; exit 1; }
    "$emcc" "${common[@]}" -O2 "${sources[@]}" -lm -o build/wasm/virgl-shader.mjs \
      -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sFILESYSTEM=0 \
      -sINITIAL_MEMORY=16777216 -sALLOW_MEMORY_GROWTH=0 \
      -sSTACK_SIZE=262144 -sABORTING_MALLOC=0 \
      '-sEXPORTED_FUNCTIONS=["_bridge_translate","_bridge_translate_pair","_malloc","_free"]' \
      '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8"]'
    ;;
  *) echo 'Usage: build.sh guard-check|native|sanitize|captured-sanitize|component-sanitize|pair-sanitize|bank-sanitize|raw-bit-sanitize|integer-mask-sanitize|wasm' >&2; exit 2 ;;
esac
