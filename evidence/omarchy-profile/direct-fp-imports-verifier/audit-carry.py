#!/usr/bin/env python3
"""Carry AN proof only where code and evidence are byte-identical."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path.cwd()
OUT = ROOT / 'evidence/omarchy-profile/direct-fp-imports-verifier'
BASE = '04ea9fe4'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def committed(path):
    return subprocess.check_output(['git', 'show', f'{BASE}:{path}'])


def index(path, relative):
    data = path.read_bytes()
    assert data == committed(path.relative_to(ROOT).as_posix())
    files = []
    for line in data.decode().splitlines():
        want, name = line.split('  ', 1)
        actual = (relative / name).read_bytes()
        assert digest(actual) == want, name
        files.append({'path': name, 'sha256': want, 'bytes': len(actual)})
    return {'path': str(path.relative_to(ROOT)), 'sha256': digest(data), 'files': files}


changed = subprocess.check_output([
    'git', 'diff', '--name-only', BASE, '--', 'crates/core',
    'crates/jit-translate', 'crates/jit-runtime', 'tests/support',
], text=True).splitlines()
assert not changed, changed
paths = [
    'crates/core/src/jit.rs', 'crates/core/src/softfloat.rs',
    'crates/jit-translate/src/lib.rs', 'crates/jit-runtime/src/lib.rs',
]
for stem in ['arithmetic', 'from_integer', 'to_word', 'division', 'fmadd']:
    paths.extend([
        f'tests/support/jit_fp_{stem}_verifier.rs',
        f'crates/jit-runtime/tests/fp_{stem}_verifier.rs',
        f'crates/wasm/tests/jit_fp_{stem}_verifier.rs',
    ])
unchanged = []
for name in paths:
    data = (ROOT / name).read_bytes()
    assert data == committed(name), name
    unchanged.append({'path': name, 'sha256': digest(data), 'bytes': len(data)})
worker = ROOT / 'evidence/omarchy-profile/fmadd-single-r1'
critic = ROOT / 'evidence/omarchy-profile/fmadd-single-verifier'
receipt = {
    'basis': BASE, 'unmodifiedNumericalAndTranslatorPaths': unchanged,
    'wholeBoundaryDiffEmpty': ['crates/core', 'crates/jit-translate', 'crates/jit-runtime', 'tests/support'],
    'workerSeal': index(worker / 'sha256.txt', worker),
    'criticSeal': index(critic / 'sha256.txt', ROOT),
    'carriedClaim': 'AN native/numerical/translator correctness only; new browser import boundary is tested separately',
}
out = OUT / 'carry-inspection.json'
out.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({
    'unchangedPaths': len(unchanged),
    'workerFiles': len(receipt['workerSeal']['files']),
    'criticFiles': len(receipt['criticSeal']['files']),
    'receiptSha256': digest(out.read_bytes()),
}, indent=2))
