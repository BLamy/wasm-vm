#!/usr/bin/env bash
# Isolated synchronous control transport; production VIRGL/capsets remain disabled.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_CONTROL_EVIDENCE_DIR:-target/evidence/virgl-control}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
run_logged() {
  local name=$1
  shift
  "$@" 2>&1 | tee "$evidence_dir/$name.log"
}
if [[ ! -d web/node_modules/playwright ]]; then (cd web && npm ci --no-audit --no-fund); fi
if [[ -z ${EMCC:-} ]]; then EMCC=$(bash tools/setup-virgl-emsdk.sh); fi
export EMCC
set -x
git rev-parse HEAD
node --check renderer/virgl-command/control-bridge.mjs
node --check renderer/virgl-command/tests/control-acceptance.mjs
node --check tools/verify-virgl-control.mjs
node --check tools/verify-virgl-default-demo.mjs
python3 -m py_compile tools/virgl-command/control-receipt.py tools/virgl-command/control-cold.py
run_logged format cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm
run_logged clippy-default cargo clippy -p wasm-vm-core --lib -- -D warnings
run_logged clippy-control cargo clippy -p wasm-vm-core --lib --test virtio_gpu_control3d --test virtio_gpu_machine --features virgl-control-proof,gpu-trace -- -D warnings
run_logged clippy-wasm cargo clippy -p wasm-vm-wasm --lib --target wasm32-unknown-unknown --features virgl-control-proof -- -D warnings
run_logged native-control cargo test -p wasm-vm-core --features virgl-control-proof,gpu-trace --test virtio_gpu_control3d -- --nocapture --test-threads=1
run_logged native-gpu cargo test -p wasm-vm-core --features virgl-control-proof,gpu-trace --lib dev::virtio::gpu:: -- --quiet
run_logged native-machine cargo test -p wasm-vm-core --features virgl-control-proof,gpu-trace --test virtio_gpu_machine -- --quiet
run_logged wasm-core-default cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown
run_logged wasm-default cargo build -p wasm-vm-wasm-web --target wasm32-unknown-unknown
# wasm-pack resolves its own cached runner; absence from PATH is not a reason to
# silently skip the existing protocol tests. A setup/test failure fails this gate.
run_logged wasm-gpu-protocol wasm-pack test --node crates/wasm --test gpu_protocol -- --nocapture
# Put wasm-pack options before --features, whose arguments are forwarded to cargo.
run_logged wasm-proof wasm-pack build crates/wasm --dev --target web --out-dir ../../target/virgl-control/pkg --features virgl-control-proof
run_logged shader-build bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-control.mjs --output "$evidence_dir/hardware"
if node tools/verify-virgl-control.mjs --output "$evidence_dir/sabotage-skip-context" --sabotage skip-context; then
  echo 'ERROR: omitted renderer context escaped the independent ownership oracle' >&2
  exit 1
fi
node tools/verify-virgl-default-demo.mjs --output "$evidence_dir/default-demo"
python3 tools/virgl-command/control-receipt.py "$evidence_dir"
