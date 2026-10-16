#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
proof_dir="$PWD/evidence/virgl-control/verifier"
mkdir -p "$proof_dir/coverage/raw"
python3 - "$proof_dir/coverage/raw" <<'PYRAW'
from pathlib import Path
import sys
for file in Path(sys.argv[1]).glob("*.profraw"):
    file.unlink()
PYRAW
export CARGO_TARGET_DIR="$proof_dir/native/target-coverage"
export RUSTFLAGS='-C instrument-coverage'
export LLVM_PROFILE_FILE="$proof_dir/coverage/raw/%p-%m.profraw"
cargo test --offline --manifest-path "$proof_dir/native/Cargo.toml" -- --nocapture --test-threads=1 > "$proof_dir/native-coverage.log" 2>&1
cargo test --offline -p wasm-vm-core --features virgl-control-proof,gpu-trace --test virtio_gpu_control3d --test virtio_gpu_machine -- --nocapture --test-threads=1 > "$proof_dir/native-worker-replay-coverage.log" 2>&1
cargo test --offline -p wasm-vm-core --features virgl-control-proof,gpu-trace --lib dev::virtio::gpu:: -- --quiet > "$proof_dir/native-gpu-coverage.log" 2>&1
python3 "$proof_dir/export-native-coverage.py"

# Normalize only trailing blank lines in recorded text logs for Git hygiene.
python3 - "$proof_dir" <<'PYLOG'
from pathlib import Path
import sys
for name in ['native-coverage.log', 'native-worker-replay-coverage.log', 'native-gpu-coverage.log']:
    file=Path(sys.argv[1])/name
    file.write_text(file.read_text().rstrip()+'\n')
PYLOG
