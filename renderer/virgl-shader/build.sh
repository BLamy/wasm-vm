#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 verify_sources.py
mode=${1:-native}
mkdir -p "build/$mode"
sources=(bridge.c raw_bits.c generated/u_format_table.c checked_upstream.c
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
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only bridge.c raw_bits.c native_tests/captured.c native_tests/components.c native_tests/pairs.c native_tests/banks.c native_tests/raw_bits.c native_tests/integer_masks.c native_tests/float_masks.c native_tests/numeric_floats.c native_tests/component_floats.c native_tests/dot_reciprocals.c native_tests/constant_compiler.c native_tests/structured_conditionals.c native_tests/indirect_constants.c native_tests/bounded_loops.c native_tests/raw_equality.c native_tests/selected_lanes.c native_tests/selected_lanes_pair.c native_tests/radial_domain.c native_tests/precise_words.c native_tests/precise_audit.c native_tests/ordered_masks.c native_tests/raster_bank.c native_tests/precise_arithmetic.c native_tests/original_corpus.c native_tests/precise_fraction.c native_tests/saturation.c native_tests/exponent_logarithm.c
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -Wno-unused-function -DBRIDGE_UPSTREAM_ALLOC_GUARD_ONLY -fsyntax-only checked_upstream.c
    ;;
  native)
    "${CC:-clang}" "${common[@]}" -O2 "${sources[@]}" cli.c -lm -o build/native/virgl-shader
    ;;
  selected-lanes-pair-native)
    "${CC:-clang}" "${common[@]}" -O2 "${sources[@]}" native_tests/selected_lanes_pair.c -lm -o build/selected-lanes-pair-native/pair-test
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
  float-mask-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -fstack-usage -c "$source.c" -o "build/float-mask-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/float-mask-sanitize/bridge.o build/float-mask-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/float_masks.c -lm -o build/float-mask-sanitize/float-mask-test
    ;;
  numeric-float-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -fstack-usage -c "$source.c" -o "build/numeric-float-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/numeric-float-sanitize/bridge.o build/numeric-float-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/numeric_floats.c -lm -o build/numeric-float-sanitize/numeric-float-test
    ;;
  component-float-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -fstack-usage -c "$source.c" -o "build/component-float-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/component-float-sanitize/bridge.o build/component-float-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/component_floats.c -lm -o build/component-float-sanitize/component-float-test
    ;;
  dot-reciprocal-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -fstack-usage -c "$source.c" -o "build/dot-reciprocal-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/dot-reciprocal-sanitize/bridge.o build/dot-reciprocal-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/dot_reciprocals.c -lm -o build/dot-reciprocal-sanitize/dot-reciprocal-test
    ;;
  constant-compiler-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=constant_compiler_calloc -fstack-usage -c "$source.c" -o "build/constant-compiler-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/constant-compiler-sanitize/bridge.o build/constant-compiler-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/constant_compiler.c -lm -o build/constant-compiler-sanitize/constant-compiler-test
    ;;
  structured-conditional-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=structured_conditional_calloc -fstack-usage -c "$source.c" -o "build/structured-conditional-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/structured-conditional-sanitize/bridge.o build/structured-conditional-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/structured_conditionals.c -lm -o build/structured-conditional-sanitize/structured-conditional-test
    ;;
  indirect-constant-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=indirect_constant_calloc -fstack-usage -c "$source.c" -o "build/indirect-constant-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/indirect-constant-sanitize/bridge.o build/indirect-constant-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/indirect_constants.c -lm -o build/indirect-constant-sanitize/indirect-constant-test
    ;;
  bounded-loop-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=bounded_loop_calloc -fstack-usage -c "$source.c" -o "build/bounded-loop-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/bounded-loop-sanitize/bridge.o build/bounded-loop-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/bounded_loops.c -lm -o build/bounded-loop-sanitize/bounded-loop-test
    ;;
  raw-equality-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=raw_equality_calloc -fstack-usage -c "$source.c" -o "build/raw-equality-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/raw-equality-sanitize/bridge.o build/raw-equality-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/raw_equality.c -lm -o build/raw-equality-sanitize/raw-equality-test
    ;;
  selected-lanes-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=selected_lanes_calloc -fstack-usage -c "$source.c" -o "build/selected-lanes-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/selected-lanes-sanitize/bridge.o build/selected-lanes-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/selected_lanes.c -lm -o build/selected-lanes-sanitize/selected-lanes-test
    ;;
  radial-domain-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=radial_domain_calloc -fstack-usage -c "$source.c" -o "build/radial-domain-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/radial-domain-sanitize/bridge.o build/radial-domain-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/radial_domain.c -lm -o build/radial-domain-sanitize/radial-domain-test
    ;;
  precise-word-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=precise_word_calloc -fstack-usage -c "$source.c" -o "build/precise-word-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" -DBRIDGE_UPSTREAM_ALLOCATION_TEST -fstack-usage -c checked_upstream.c -o build/precise-word-sanitize/checked_upstream.o
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/precise-word-sanitize/bridge.o build/precise-word-sanitize/raw_bits.o \
      build/precise-word-sanitize/checked_upstream.o generated/u_format_table.c \
      "${sources[@]:4}" native_tests/precise_words.c -lm -o build/precise-word-sanitize/precise-word-test
    ;;
  ordered-mask-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=precise_word_calloc -fstack-usage -c "$source.c" -o "build/ordered-mask-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" -DBRIDGE_UPSTREAM_ALLOCATION_TEST -fstack-usage -c checked_upstream.c -o build/ordered-mask-sanitize/checked_upstream.o
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/ordered-mask-sanitize/bridge.o build/ordered-mask-sanitize/raw_bits.o \
      build/ordered-mask-sanitize/checked_upstream.o generated/u_format_table.c \
      "${sources[@]:4}" native_tests/ordered_masks.c -lm -o build/ordered-mask-sanitize/ordered-mask-test
    ;;
  raster-bank-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=precise_word_calloc -fstack-usage -c "$source.c" -o "build/raster-bank-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" -DBRIDGE_UPSTREAM_ALLOCATION_TEST -fstack-usage -c checked_upstream.c -o build/raster-bank-sanitize/checked_upstream.o
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/raster-bank-sanitize/bridge.o build/raster-bank-sanitize/raw_bits.o \
      build/raster-bank-sanitize/checked_upstream.o generated/u_format_table.c \
      "${sources[@]:4}" native_tests/raster_bank.c -lm -o build/raster-bank-sanitize/raster-bank-test
    ;;
  precise-arithmetic-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=precise_word_calloc -fstack-usage -c "$source.c" -o "build/precise-arithmetic-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" -DBRIDGE_UPSTREAM_ALLOCATION_TEST -fstack-usage -c checked_upstream.c -o build/precise-arithmetic-sanitize/checked_upstream.o
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      build/precise-arithmetic-sanitize/bridge.o build/precise-arithmetic-sanitize/raw_bits.o \
      build/precise-arithmetic-sanitize/checked_upstream.o generated/u_format_table.c \
      "${sources[@]:4}" native_tests/precise_arithmetic.c -lm -o build/precise-arithmetic-sanitize/precise-arithmetic-test
    ;;
  original-corpus-sanitize)
    "${CC:-clang}" "${common[@]}" -g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined \
      -fprofile-instr-generate -fcoverage-mapping "${sources[@]}" native_tests/original_corpus.c \
      -lm -o build/original-corpus-sanitize/original-corpus-test
    ;;
  compiler-bounds-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Wall -Wextra -Werror -fstack-usage \
      -c native_tests/compiler_bounds.c -o build/compiler-bounds-sanitize/compiler_bounds.o
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" \
      "${sources[@]:2}" build/compiler-bounds-sanitize/compiler_bounds.o -lm -o build/compiler-bounds-sanitize/compiler-bounds-test
    ;;
  hex-literals-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/hex_literals.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/hex_literals.c \
      -lm -o build/hex-literals-sanitize/hex-literals-test
    ;;
  signed-integers-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/signed_integers.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/signed_integers.c \
      -lm -o build/signed-integers-sanitize/signed-integers-test
    ;;
  signed-conversions-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/signed_conversions.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/signed_conversions.c \
      -lm -o build/signed-conversions-sanitize/signed-conversions-test
    ;;
  scalar-operations-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/scalar_operations.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/scalar_operations.c \
      -lm -o build/scalar-operations-sanitize/scalar-operations-test
    ;;
  minimum-selection-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/minimum_selection.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/minimum_selection.c \
      -lm -o build/minimum-selection-sanitize/minimum-selection-test
    ;;
  precise-fraction-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/precise_fraction.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/precise_fraction.c \
      -lm -o build/precise-fraction-sanitize/precise-fraction-test
    ;;
  exact-producer-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/exact_producer.c
    for source in bridge raw_bits; do
      "${CC:-clang}" "${common[@]}" "${instrument[@]}" -Dcalloc=exact_producer_calloc -fstack-usage -c "$source.c" -o "build/exact-producer-sanitize/$source.o"
    done
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" build/exact-producer-sanitize/bridge.o build/exact-producer-sanitize/raw_bits.o \
      "${sources[@]:2}" native_tests/exact_producer.c -lm -o build/exact-producer-sanitize/exact-producer-test
    ;;
  known-branch-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/known_branch.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/known_branch.c \
      -lm -o build/known-branch-sanitize/known-branch-test
    ;;
  known-arithmetic-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/known_arithmetic.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/known_arithmetic.c \
      -lm -o build/known-arithmetic-sanitize/known-test
    ;;
  discard-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/fragment_discard.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/fragment_discard.c \
      -lm -o build/discard-sanitize/discard-test
    ;;
  coordinate-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/fragment_coordinates.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/fragment_coordinates.c \
      -lm -o build/coordinate-sanitize/coordinate-test
    ;;
  power-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/power.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/power.c \
      -lm -o build/power-sanitize/power-test
    ;;
  sine-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/sine.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/sine.c \
      -lm -o build/sine-sanitize/sine-test
    ;;
  exponent-logarithm-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/exponent_logarithm.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/exponent_logarithm.c \
      -lm -o build/exponent-logarithm-sanitize/exponent-logarithm-test
    ;;
  saturation-sanitize)
    instrument=(-g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined
      -fprofile-instr-generate -fcoverage-mapping)
    "${CC:-clang}" "${common[@]}" -Wall -Wextra -Werror -fsyntax-only native_tests/saturation.c
    "${CC:-clang}" "${common[@]}" "${instrument[@]}" "${sources[@]}" native_tests/saturation.c \
      -lm -o build/saturation-sanitize/saturation-test
    ;;
  precise-token-audit)
    "${CC:-clang}" "${common[@]}" -g -O1 -fno-omit-frame-pointer -fsanitize=address,undefined \
      "${sources[@]}" native_tests/precise_audit.c -lm -o build/precise-token-audit/precise-token-audit
    ;;
  compiler-bounds-wasm-stack)
    emcc=${EMCC:-${EMSDK:+$EMSDK/upstream/emscripten/emcc}}
    if [[ -z "$emcc" ]]; then echo 'Set EMCC to the pinned Emscripten 4.0.22 compiler.' >&2; exit 1; fi
    "$emcc" --version | head -1 | grep -q ' 4\.0\.22 ' || { echo 'Emscripten 4.0.22 required.' >&2; exit 1; }
    # Same owned source and optimization as the delivered module. These objects
    # only measure compiler stack frames; the public acceptance uses build/wasm.
    for source in bridge raw_bits; do
      "$emcc" "${common[@]}" -O2 -fstack-usage -c "$source.c" -o "build/$mode/$source.o"
    done
    ;;
  wasm)
    emcc=${EMCC:-${EMSDK:+$EMSDK/upstream/emscripten/emcc}}
    if [[ -z "$emcc" ]]; then echo 'Set EMCC to the pinned Emscripten 4.0.22 compiler.' >&2; exit 1; fi
    "$emcc" --version | head -1 | grep -q ' 4\.0\.22 ' || { echo 'Emscripten 4.0.22 required.' >&2; exit 1; }
    "$emcc" "${common[@]}" -O2 "${sources[@]}" -lm -o build/wasm/virgl-shader.mjs \
      -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sFILESYSTEM=0 \
      -sINITIAL_MEMORY=16777216 -sALLOW_MEMORY_GROWTH=0 \
      -sSTACK_SIZE=262144 -sABORTING_MALLOC=0 \
      '-sEXPORTED_FUNCTIONS=["_bridge_translate","_bridge_translate_pair","_bridge_translate_exact","_malloc","_free"]' \
      '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8"]'
    ;;
  *) echo 'Usage: build.sh guard-check|native|sanitize|captured-sanitize|component-sanitize|pair-sanitize|bank-sanitize|raw-bit-sanitize|integer-mask-sanitize|float-mask-sanitize|numeric-float-sanitize|component-float-sanitize|dot-reciprocal-sanitize|wasm' >&2; exit 2 ;;
esac
