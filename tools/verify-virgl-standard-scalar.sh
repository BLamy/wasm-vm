#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${VIRGL_STANDARD_SCALAR_EVIDENCE_DIR:-target/evidence/virgl-standard-scalar}
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
for file in renderer/virgl-command/{decoder,state}.mjs renderer/virgl-command/tests/{standard-scalar-vertex-fetch,standard-compact-vertex-fetch,standard-compact-vertex-fetch-adversarial,standard-instanced-draws}.mjs tools/verify-virgl-standard-scalar.mjs tools/virgl-command/standard-scalar-{oracle,pixels,retained-critic}.mjs; do node --check "$file"; done
python3 -m py_compile tools/virgl-command/standard-scalar-{receipt,cold,seal}.py
bash -n tools/verify-virgl-standard-scalar.sh
mkdir -p "$evidence/abi"
for mode in native sanitize; do
  flags=(-g)
  if [[ $mode == sanitize ]]; then flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer); fi
  clang -std=gnu11 -Wall -Wextra -Werror -DUTIL_ARCH_LITTLE_ENDIAN=1 -DUTIL_ARCH_BIG_ENDIAN=0 "${flags[@]}" -Irenderer/virgl-shader/vendor/src/gallium/include -Irenderer/virgl-shader/vendor/src/mesa/pipe -Irenderer/virgl-shader/vendor/src/mesa/compat -Irenderer/virgl-shader/vendor/src/mesa -Irenderer/virgl-shader/vendor/src tools/virgl-command/standard-scalar-enums.c -o "$evidence/abi/scalar-$mode"
  "$evidence/abi/scalar-$mode" > "$evidence/abi/scalar-$mode.json"
done
# Compiler/allocator/interface/resources and earlier point/list/restart behavior
# are unchanged. Rebuild the delivered Wasm, bind D12 critic pins and carry HELD
# evidence; only the affected compact scalar branches are rerun here.
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-standard-compact.mjs --output "$evidence/retained-compact/wire" --node-only true
node tools/verify-virgl-standard-compact.mjs --output "$evidence/retained-compact/hardware"
for fault in native-normalize constant-unpack; do
  if node tools/verify-virgl-standard-compact.mjs --output "$evidence/retained-compact/fault-$fault" --smoke true --mutation "$fault"; then
    echo 'ERROR: original compact scalar fault escaped pixels' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-compact-pixels.mjs "$evidence/retained-compact"
node tools/verify-virgl-standard-compact.mjs --output "$evidence/retained-compact/critic-hardware" --adversarial true
node tools/virgl-command/standard-scalar-retained-critic.mjs "$evidence/retained-compact"
node tools/verify-virgl-standard-scalar.mjs --output "$evidence/wire" --node-only true
node tools/verify-virgl-standard-scalar.mjs --output "$evidence/hardware"
for fault in native-signedness constant-scaled; do
  if node tools/verify-virgl-standard-scalar.mjs --output "$evidence/fault-$fault" --smoke true --mutation "$fault"; then
    echo 'ERROR: actual scalar-fetch fault escaped original pixels' >&2
    exit 1
  fi
done
node tools/virgl-command/standard-scalar-pixels.mjs "$evidence"
set +x
printf 'STANDARD_SCALAR_RECORDING_COMPLETE\n'
python3 tools/virgl-command/standard-scalar-receipt.py "$evidence"
