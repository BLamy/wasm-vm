#!/usr/bin/env bash
# Isolated real guest submission/DMA proof; production VIRGL remains disabled.
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_SUBMIT_EVIDENCE_DIR:-target/evidence/virgl-submit}
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
node --check renderer/virgl-command/tests/submit-acceptance.mjs
node --check tools/verify-virgl-submit.mjs
python3 -m py_compile tools/virgl-command/submit-receipt.py tools/virgl-command/submit-cold.py
run_logged format cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm
run_logged clippy-default cargo clippy -p wasm-vm-core --lib -- -D warnings
run_logged clippy-submit cargo clippy -p wasm-vm-core --lib --test virtio_gpu_submit3d --test virtio_gpu_control3d --test virtio_gpu_machine --features virgl-control-proof,gpu-trace -- -D warnings
run_logged clippy-wasm cargo clippy -p wasm-vm-wasm --lib --target wasm32-unknown-unknown --features virgl-control-proof -- -D warnings
run_logged native-submit cargo test -p wasm-vm-core --features virgl-control-proof,gpu-trace --test virtio_gpu_submit3d -- --nocapture --test-threads=1
run_logged native-control cargo test -p wasm-vm-core --features virgl-control-proof,gpu-trace --test virtio_gpu_control3d -- --nocapture --test-threads=1
run_logged native-virtio cargo test -p wasm-vm-core --features virgl-control-proof,gpu-trace --lib dev::virtio:: -- --quiet
run_logged native-bus cargo test -p wasm-vm-core --features virgl-control-proof,gpu-trace --lib mmio:: -- --quiet
run_logged native-machine cargo test -p wasm-vm-core --features virgl-control-proof,gpu-trace --test virtio_gpu_machine -- --quiet
run_logged wasm-core-default cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown
run_logged wasm-default cargo build -p wasm-vm-wasm-web --target wasm32-unknown-unknown
run_logged wasm-gpu-protocol wasm-pack test --node crates/wasm --test gpu_protocol -- --nocapture
run_logged wasm-control-proof wasm-pack build crates/wasm --dev --target web --out-dir ../../target/virgl-control/pkg --features virgl-control-proof
run_logged wasm-proof wasm-pack build crates/wasm --dev --target web --out-dir ../../target/virgl-submit/pkg --features virgl-control-proof
run_logged shader-build bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-control.mjs --output "$evidence_dir/control-regression"
node tools/verify-virgl-submit.mjs --output "$evidence_dir/hardware"
if node tools/verify-virgl-submit.mjs --output "$evidence_dir/sabotage-early-collect" --sabotage early-collect; then
  echo 'ERROR: CPU collection before GPU readiness escaped the oracle' >&2
  exit 1
fi
if node tools/verify-virgl-submit.mjs --output "$evidence_dir/sabotage-early-completion" --sabotage early-completion; then
  echo 'ERROR: premature guest completion escaped the oracle' >&2
  exit 1
fi
node tools/verify-virgl-default-demo.mjs --output "$evidence_dir/default-demo" --task E6-T11b2
python3 tools/virgl-command/submit-receipt.py "$evidence_dir"
