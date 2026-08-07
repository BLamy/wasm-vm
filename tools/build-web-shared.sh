#!/usr/bin/env bash
# E4-T22: build the SHARED-MEMORY variant of the main core module (wasm-vm-wasm).
#
# The threaded CPU worker imports one shared `WebAssembly.Memory` that backs guest RAM + CpuState +
# TLBs. Emitting a module that uses a shared memory requires wasm32 built with
# `+atomics,+bulk-memory,+mutable-globals`; atomics are still unstable so std must be recompiled with
# the same target-features (`-Z build-std`), which needs the nightly toolchain + `rust-src`. This is
# the ONLY place in the build that needs nightly — the single-threaded FALLBACK (`make wasm`) stays
# on pinned stable and emits a normal non-shared memory. See docs/e4-t22-cpu-worker-coop-coep.md.
#
# We pass `--shared-memory --import-memory --max-memory=N` to lld so the emitted module IMPORTS a
# shared memory directly (verifiable with wasm-objdump, no bindgen needed — the headless gate).
#
# wasm-bindgen glue (`--target web`) is a SECOND step: wasm-bindgen must be the exact version of the
# `wasm-bindgen` crate (0.2.126) or it refuses to run. The repo drives that via wasm-pack (`make
# wasm` bundles a version-matched bindgen), so the glue step here is best-effort and completed on
# dev; the shared-memory build itself is fully proven headlessly by step 2.
set -euo pipefail
cd "$(dirname "$0")/.."

NIGHTLY="${WASM_SHARED_TOOLCHAIN:-nightly}"
MAX_MEMORY="${WASM_SHARED_MAX_MEMORY:-2147483648}" # 2 GiB (32768 * 64KiB pages)
OUT_DIR="crates/wasm/pkg-shared"
WASM="target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm"
BINDGEN_CRATE_VER="0.2.126"

if ! rustup component list --toolchain "$NIGHTLY" --installed 2>/dev/null | grep -q '^rust-src'; then
  echo "error: rust-src missing on '$NIGHTLY'. Run: rustup component add rust-src --toolchain $NIGHTLY" >&2
  exit 1
fi

echo "==> [1/3] building shared-memory wasm ($NIGHTLY, build-std, max-memory=$MAX_MEMORY)"
RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals \
  -C link-arg=--shared-memory \
  -C link-arg=--import-memory \
  -C link-arg=--no-check-features \
  -C link-arg=--max-memory=$MAX_MEMORY" \
  cargo "+$NIGHTLY" build -p wasm-vm-wasm --release \
    --target wasm32-unknown-unknown \
    -Z build-std=std,panic_abort

echo "==> [2/3] shared+imported memory proof (lld, no bindgen needed)"
LINE="$(wasm-objdump -x -j Import "$WASM" | grep -i 'memory.*<- env.memory' || true)"
if [ -n "$LINE" ]; then
  echo "   $LINE"
else
  echo "error: built module does not import a shared env.memory" >&2
  exit 1
fi

echo "==> [3/3] wasm-bindgen glue"
BINDGEN_VER="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)"
if [ "$BINDGEN_VER" = "$BINDGEN_CRATE_VER" ]; then
  # wasm-bindgen's --target web threading transform needs the TLS shims that the +atomics build
  # emits. Run on dev with the version-matched bindgen.
  wasm-bindgen "$WASM" --out-dir "$OUT_DIR" --target web --omit-default-module-path
  echo "   glue written to $OUT_DIR"
else
  echo "   skip: global wasm-bindgen is '${BINDGEN_VER:-absent}', crate needs $BINDGEN_CRATE_VER."
  echo "   Complete the glue on dev with the version-matched bindgen ('make wasm' uses wasm-pack, or"
  echo "   cargo install -f wasm-bindgen-cli --version $BINDGEN_CRATE_VER)."
fi

echo "==> shared-memory build OK"
