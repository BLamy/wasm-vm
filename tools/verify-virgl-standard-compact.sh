#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_COMPACT_EVIDENCE_DIR:-target/evidence/virgl-standard-compact}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
rm -f "$evidence/receipt.json"
exec > >(tee "$evidence/acceptance.log") 2>&1
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
git diff --check
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/standard-compact-vertex-fetch.mjs tools/verify-virgl-standard-compact.mjs tools/virgl-command/standard-compact-{oracle,pixels}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-compact-{receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-compact.sh
mkdir -p "$evidence/abi"
for mode in native sanitize; do
  flags=(-g)
  if [[ $mode == sanitize ]]; then flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer); fi
  clang -std=gnu11 -Wall -Wextra -Werror -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0 "${flags[@]}" -Irenderer/virgl-shader/vendor/src/gallium/include -Irenderer/virgl-shader/vendor/src/mesa/pipe -Irenderer/virgl-shader/vendor/src/mesa/compat -Irenderer/virgl-shader/vendor/src/mesa -Irenderer/virgl-shader/vendor/src tools/virgl-command/standard-compact-enums.c -o "$evidence/abi/compact-$mode"
  "$evidence/abi/compact-$mode" > "$evidence/abi/compact-$mode.json"
done
# Compiler, allocator, typed shader/program interface and resource storage are
# byte-identical to D11. Rebuild the delivered Wasm and carry its sealed proof.
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-standard-points.mjs --output "$evidence/retained-points/hardware"
for fault in size-selection coord-y; do
  if node tools/verify-virgl-standard-points.mjs --output "$evidence/retained-points/fault-$fault" --smoke true --mutation "$fault"; then exit 1; fi
done
node tools/virgl-command/standard-point-pixels.mjs "$evidence/retained-points"
node tools/verify-virgl-standard-assembly.mjs --output "$evidence/retained-assembly/hardware"
for fault in list-order provoking; do
  if node tools/verify-virgl-standard-assembly.mjs --output "$evidence/retained-assembly/fault-$fault" --smoke true --mutation "$fault"; then exit 1; fi
done
node tools/virgl-command/standard-assembly-pixels.mjs "$evidence/retained-assembly"
node tools/verify-virgl-standard-restart.mjs --output "$evidence/retained-restart/hardware"
if node tools/verify-virgl-standard-restart.mjs --output "$evidence/retained-restart/fault-restart" --smoke true --mutation restart; then exit 1; fi
node tools/virgl-command/standard-restart-pixels.mjs "$evidence/retained-restart"
node tools/verify-virgl-standard-compact.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-compact.mjs --output "$evidence/hardware"
for fault in native-normalize constant-unpack; do
  if node tools/verify-virgl-standard-compact.mjs --output "$evidence/fault-$fault" --smoke true --mutation "$fault"; then
    echo 'ERROR: actual compact-fetch fault escaped original pixel oracle' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-compact-pixels.mjs "$evidence"
set +x
printf 'STANDARD_COMPACT_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-compact-receipt.py "$evidence"
