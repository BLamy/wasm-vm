#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_dir=${VIRGL_INVENTORY_VARIANTS_EVIDENCE_DIR:-target/evidence/virgl-inventory-variants}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
git rev-parse HEAD
python3 -m py_compile tools/virgl-capture/tests/inventory_variants.py
python3 tools/virgl-capture/tests/inventory_variants.py --output "$evidence_dir/normal"
if python3 tools/virgl-capture/tests/inventory_variants.py --output "$evidence_dir/index-offset-fault" --sabotage index-offset > "$evidence_dir/index-offset-fault.log" 2>&1; then
    echo 'index-offset source fault was not detected' >&2
    exit 1
fi
python3 - "$evidence_dir" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
checks = json.loads((p/'index-offset-fault/objects-index-uniform/assertions.json').read_text())
failed = [c for c in checks if not c['held']]
assert len(failed)==1 and failed[0]['prediction']=='literal index binding', failed
assert failed[0]['expected']['offset']==19 and failed[0]['observed']['offset']==23, failed
assert 'literal index binding: expected' in (p/'index-offset-fault.log').read_text()
print('index-offset source fault rejected at literal index binding (19 -> 23)')
PY
