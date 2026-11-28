#!/bin/sh
# wasm-vm E5-T45a: gyp's "emulator" for the riscv64 cross build. Every other generator gyp runs
# through it (V8's host tools) is a host binary: run it as is. node_mksnapshot is a target binary:
# it was run inside wasm-vm (the riscv64 target) and its output placed at
# /opt/node-snapshot/node_snapshot.cc; copy that to the action's output (its last argument).
set -e
case "$(basename "$1")" in
  node_mksnapshot)
    src=/opt/node-snapshot/node_snapshot.cc
    [ -s "$src" ] || { echo "emu-copy: $src is missing; run node_mksnapshot in the guest first" >&2; exit 1; }
    for last; do :; done
    cp "$src" "$last"
    ;;
  *) exec "$@" ;;
esac
