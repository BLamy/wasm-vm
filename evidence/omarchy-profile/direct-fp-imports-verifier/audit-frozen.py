#!/usr/bin/env python3
"""Check frozen source, generated assets and affected recorded gates."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path.cwd()
WORKER = ROOT / 'evidence/omarchy-profile/direct-fp-imports-r1'
OUT = ROOT / 'evidence/omarchy-profile/direct-fp-imports-verifier'
frozen = json.loads((WORKER / 'frozen.json').read_text())
head = frozen['head']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def at_head(path, commit=head):
    return subprocess.check_output(['git', 'show', commit + ':' + path])


for key in ['files', 'artifacts']:
    for entry in frozen[key]:
        actual = (ROOT / entry['path']).read_bytes()
        assert sha(actual) == entry['sha256'], entry['path']
        assert at_head(entry['path']) == actual, entry['path']
for entry in frozen['unchangedRecorder']:
    actual = (ROOT / entry['path']).read_bytes()
    assert sha(actual) == entry['sha256']
    assert actual == at_head(entry['path'], '04ea9fe4')
for name, (size, digest) in frozen['pairPins'].items():
    data = (ROOT / 'target/omarchy-direct-opaque-r2' / name).read_bytes()
    assert len(data) == size and sha(data) == digest
changed_crates = subprocess.check_output([
    'git', 'diff', '--name-only', '04ea9fe4', head, '--', 'crates'
], text=True).splitlines()
assert changed_crates == [
    'crates/wasm/src/jit_browser.rs',
    'crates/wasm/tests/jit_fp_direct_imports_verifier.rs',
], changed_crates
affected = json.loads((WORKER / 'affected-commands.json').read_text())
assert affected['head'] == head and affected['wasmSha256'] == frozen['wasmSha256']
assert affected['allPassed'] and all(row['code'] == 0 for row in affected['commands'])
assert [row['label'] for row in affected['commands']] == [
    'clippy', 'wasm-test-clippy', 'wasm-native-lib', 'recorder-harness', 'no-host-float', 'acceptance'
]
gates = []
for row in affected['commands']:
    path = WORKER / (row['label'] + '.log')
    data = path.read_bytes()
    gates.append({'label': row['label'], 'path': str(path.relative_to(ROOT)),
                  'sha256': sha(data), 'bytes': len(data), 'code': row['code']})
receipt = {
    'head': head, 'wasmSha256': frozen['wasmSha256'],
    'frozenReceiptSha256': sha((WORKER / 'frozen.json').read_bytes()),
    'sourceFiles': len(frozen['files']), 'builtArtifacts': len(frozen['artifacts']),
    'unchangedRecorderFiles': len(frozen['unchangedRecorder']),
    'preparedPairRehashed': frozen['pairPins'], 'changedCrateFiles': changed_crates,
    'affectedGates': gates,
}
(OUT / 'frozen-inspection.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({key: receipt[key] for key in ['head', 'sourceFiles', 'builtArtifacts', 'unchangedRecorderFiles', 'changedCrateFiles']}, indent=2))
