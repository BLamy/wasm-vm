#!/usr/bin/env bash
# Scratch screening scripts from the webbuild A/B (paths point at the session scratch dir; edit S= / W= to rerun).
# build_raw.sh NAME LTO CU OPT [RUSTFLAGS]  -> $S/raw/NAME/ (wasm-pack --no-opt output)
set -euo pipefail
S=/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild
W=/Users/blamy/Documents/Codex/wasm-vm-t-webbuild
NAME=$1; LTO=$2; CU=$3; OPT=$4; RF=${5:-}
export CARGO_TARGET_DIR=$S/tgt/$NAME
export CARGO_PROFILE_RELEASE_LTO=$LTO CARGO_PROFILE_RELEASE_CODEGEN_UNITS=$CU CARGO_PROFILE_RELEASE_OPT_LEVEL=$OPT
[ -n "$RF" ] && export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="$RF"
mkdir -p $S/raw
start=$(date +%s)
cd $W && wasm-pack build crates/wasm --target web --no-opt --out-dir $S/raw/$NAME > $S/raw/$NAME.log 2>&1
echo "$NAME built in $(( $(date +%s)-start ))s: $(stat -f %z $S/raw/$NAME/wasm_vm_wasm_bg.wasm) bytes"
