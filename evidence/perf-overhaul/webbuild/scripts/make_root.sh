#!/usr/bin/env bash
# Scratch screening scripts from the webbuild A/B (paths point at the session scratch dir; edit S= / W= to rerun).
# make_root.sh NAME RAW WASMOPT_ARGS...  -> $S/roots/NAME (web root sharing the worktree's web/ except pkg)
set -euo pipefail
S=/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild
W=/Users/blamy/Documents/Codex/wasm-vm-t-webbuild/web
WO=$HOME/Library/Caches/.wasm-pack/wasm-opt-50385c9e73ccee70/bin/wasm-opt
NAME=$1; RAW=$2; shift 2
R=$S/roots/$NAME
rm -rf $R; mkdir -p $R/pkg
for e in $W/*; do b=$(basename $e); [ "$b" = pkg ] || [ "$b" = dist ] || ln -s $e $R/$b; done
cp -R $S/raw/$RAW/. $R/pkg/
rm -f $R/pkg/.gitignore
if [ $# -gt 0 ]; then
  start=$(date +%s)
  $WO $S/raw/$RAW/wasm_vm_wasm_bg.wasm -o $R/pkg/wasm_vm_wasm_bg.wasm "$@"
  echo "$NAME: wasm-opt $* in $(( $(date +%s)-start ))s"
fi
echo "$NAME: $(stat -f %z $R/pkg/wasm_vm_wasm_bg.wasm) bytes sha $(shasum -a 256 $R/pkg/wasm_vm_wasm_bg.wasm | cut -c1-12)"
