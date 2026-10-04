#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_WORKLOAD_INVENTORY_EVIDENCE_DIR:-target/evidence/virgl-workload-inventory}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
set -x
git rev-parse HEAD
python3 -m py_compile tools/virgl-capture/*.py tools/virgl-capture/workloads/*.py
sh -n tools/virgl-capture/recorder.build.sh tools/virgl-capture/reference.sh
python3 -m unittest discover -s tools/virgl-capture/tests -v
python3 tools/virgl-capture/validate.py evidence/virgl-corpus/captures
python3 tools/virgl-capture/validate.py evidence/virgl-workload-inventory/captures/es2gears
python3 tools/virgl-capture/inventory.py evidence/virgl-corpus/captures/kmscube --output evidence/virgl-workload-inventory/kmscube-inventory.json
python3 tools/virgl-capture/inventory.py evidence/virgl-workload-inventory/captures/es2gears --output evidence/virgl-workload-inventory/es2gears-inventory.json
python3 tools/virgl-capture/inventory_acceptance.py --output "$evidence_dir/attacks.json"
python3 tools/virgl-capture/tests/recorder_harness.py --container "${VIRGL_REFERENCE_CONTAINER:-wasm-vm-virgl-reference-research}" --output "$evidence_dir/recorder"
