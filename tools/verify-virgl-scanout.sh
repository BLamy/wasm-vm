#!/usr/bin/env bash
# Isolated retained GPU scanout plus the ordinary built desktop regression.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VIRGL_SCANOUT_DESKTOP_IMAGE:?Pass the immutable E5-T18a desktop image explicitly}"
: "${VIRGL_SCANOUT_DESKTOP_ASSETS:?Pass its content-addressed chunk directory explicitly}"
evidence_dir=${VIRGL_SCANOUT_EVIDENCE_DIR:-target/evidence/virgl-scanout}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
rm -f "$evidence_dir/receipt.json"
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
run_logged() {
  local name=$1
  shift
  "$@" 2>&1 | tee "$evidence_dir/$name.log"
}
set -x
git rev-parse HEAD
node --check renderer/virgl-command/scanout.mjs
node --check web/src/sink/virgl-scanout-presenter.js
node --check renderer/virgl-command/tests/scanout-acceptance.mjs
node --check tools/verify-virgl-scanout.mjs
node --check tools/virgl-command/scanout-desktop.mjs
python3 -m py_compile tools/virgl-command/scanout-receipt.py tools/virgl-command/scanout-cold.py
# This includes affected native/Wasm gates, B2 hardware attacks, the legacy
# control factory and a single ordinary 127-test built demo load.
VIRGL_SUBMIT_EVIDENCE_DIR="$evidence_dir/submit-regression" bash tools/verify-virgl-submit.sh
run_logged clippy-scanout cargo clippy -p wasm-vm-core --lib --test virtio_gpu_scanout3d --features virgl-control-proof,gpu-trace -- -D warnings
run_logged native-scanout cargo test -p wasm-vm-core --features virgl-control-proof,gpu-trace --test virtio_gpu_scanout3d -- --nocapture --test-threads=1
run_logged presentation node --test web/tests/e5-t06d-presentation.test.mjs
run_logged wasm-proof wasm-pack build crates/wasm --dev --target web --out-dir ../../target/virgl-scanout/pkg --features virgl-control-proof
node tools/verify-virgl-scanout.mjs --output "$evidence_dir/hardware"
if node tools/verify-virgl-scanout.mjs --output "$evidence_dir/sabotage-orientation" --sabotage orientation; then
  echo 'ERROR: omitted scanout orientation correction escaped the pixel oracle' >&2
  exit 1
fi
node tools/virgl-command/scanout-desktop.mjs --output "$evidence_dir/desktop" \
  --image "$VIRGL_SCANOUT_DESKTOP_IMAGE" --assets "$VIRGL_SCANOUT_DESKTOP_ASSETS"
python3 tools/virgl-command/scanout-receipt.py "$evidence_dir"
