#!/usr/bin/env bash
# Scratch screening scripts from the webbuild A/B (paths point at the session scratch dir; edit S= / W= to rerun).
# build_real.sh NAME LTO CU OPT [RUSTFLAGS]: cdylib-only build (so cargo actually runs LTO) + wasm-bindgen -> raw/NAME
set -euo pipefail
S=/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild
W=/Users/blamy/Documents/Codex/wasm-vm-t-webbuild
WB=$HOME/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126/wasm-bindgen
NAME=$1; LTO=$2; CU=$3; OPT=$4; RF=${5:-}
export CARGO_TARGET_DIR=$S/tgt/r-$NAME
export CARGO_PROFILE_RELEASE_LTO=$LTO CARGO_PROFILE_RELEASE_CODEGEN_UNITS=$CU CARGO_PROFILE_RELEASE_OPT_LEVEL=$OPT
[ -n "$RF" ] && export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="$RF"
start=$(date +%s)
cd $W && cargo rustc -p wasm-vm-wasm --lib --crate-type cdylib --target wasm32-unknown-unknown --release > $S/raw/$NAME.log 2>&1
rm -rf $S/raw/$NAME; $WB $CARGO_TARGET_DIR/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm --out-dir $S/raw/$NAME --typescript --target web
echo "$NAME built in $(( $(date +%s)-start ))s: $(stat -f %z $S/raw/$NAME/wasm_vm_wasm_bg.wasm) bytes"
