#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:-"$repo/releases/wasmvm-agent-riscv64"}
target_dir=${CARGO_TARGET_DIR:-"$repo/target/guest-agent-riscv64"}
mkdir -p "$(dirname -- "$out")"

# Keep this build independent of the caller's incremental state and host timestamps. The linker
# wrapper supplies the pinned riscv64-musl Zig target used by the other Alpine agents.
export SOURCE_DATE_EPOCH=1731542400
export CARGO_INCREMENTAL=0
export CARGO_TARGET_RISCV64GC_UNKNOWN_LINUX_MUSL_LINKER="$repo/tools/zig-riscv64-linux-musl.sh"
export RUSTFLAGS="-C debuginfo=0 -C strip=symbols -C codegen-units=1 -C link-arg=-Wl,--build-id=none -C panic=abort"
export ZIG_GLOBAL_CACHE_DIR="$target_dir/zig-global-cache"
export ZIG_LOCAL_CACHE_DIR="$target_dir/zig-local-cache"

CARGO_TARGET_DIR="$target_dir" cargo build \
  --locked \
  --release \
  --target riscv64gc-unknown-linux-musl \
  -p wasm-vm-guest-agent \
  --bin wasmvm-agent

cp "$target_dir/riscv64gc-unknown-linux-musl/release/wasmvm-agent" "$out"
chmod 0755 "$out"
