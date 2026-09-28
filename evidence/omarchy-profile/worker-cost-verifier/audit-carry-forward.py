#!/usr/bin/env python3
"""Read-only source and prior-evidence continuity audit; launches no browser."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
EVIDENCE = REPO / 'evidence/omarchy-profile'
ENV = {**os.environ, 'DEVELOPER_DIR': '/Library/Developer/CommandLineTools'}
PARENT = '9a79c517d3a10562eae7d765eaca7633513d292d'
DIVISION = '53103e762c6c4003a5976bfa90131a03702fd2e7'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def identity_digest(filename, expected):
    actual = sha((EVIDENCE / filename).read_bytes())
    assert actual == expected, filename
    return {'path': filename, 'sha256': actual}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO, env=ENV)


def inspect_index(index, root, expected_index):
    assert sha(index.read_bytes()) == expected_index, str(index)
    rows = []
    for line in index.read_text().splitlines():
        expected, filename = line.split('  ', 1)
        target = root / filename
        data = target.read_bytes()
        assert sha(data) == expected, str(target)
        rows.append({'path': str(target.relative_to(REPO)), 'size': len(data), 'sha256': expected})
    return rows


for base in [PARENT, DIVISION]:
    assert not git('diff', '--name-only', base, '--', 'crates', 'web', 'Cargo.toml', 'Cargo.lock').strip(), base
assert not git('status', '--porcelain', '--', 'crates', 'web', 'Cargo.toml', 'Cargo.lock').strip()

division_rows = inspect_index(EVIDENCE / 'fp-division-r1/sha256.txt',
                              EVIDENCE / 'fp-division-r1',
                              'da8b6685880651034ec46f81a030ba2dcb516d8c1eb5fba551bb7158829e902a')
admission_rows = inspect_index(EVIDENCE / 'admission-after-fp-gates/sha256.txt', EVIDENCE,
                               '259068acb1383a640be7a3b725813dab649350cf95803d68c4c3b3a281b45a06')
prior_pins = {
    'user-path-input-r1/run.json': '4342868fbd2de53ec2ac71e9c49842273d19d4be34c406ef5b660107abe5ef98',
    'user-path-input-r1/desktop/report.json': '00ee2657553d1e9111f3f4e535a2534267b6fdf6d9724a826ce6690d994438d2',
    'counter-recycling-ab-r1/control/report.json': 'de910c4c0dde59e5cc3ac00bd17c2263e748b03cd9b196a11d3fe9aaa75fbaa4',
    'counter-recycling-ab-r1/candidate/report.json': 'c5abcbcd06795e8261ab5ed93c1889239ed5c6ee624e0f6b81b8e2b1d12eba02',
}
for filename, expected in prior_pins.items():
    assert sha((EVIDENCE / filename).read_bytes()) == expected, filename

unchanged = [
    'crates/core/src/dispatch.rs', 'crates/core/src/jit.rs',
    'crates/wasm/src/lib.rs', 'crates/wasm/src/jit_browser.rs',
    'web/main.js', 'web/loader.js', 'web/dist/main.js', 'web/dist/loader.js',
    'tools/verify/omarchy-owned-trial.mjs', 'tools/verify/omarchy-live-recording.mjs',
    'tools/verify/omarchy-browser-session.mjs',
]
source_rows = []
for filename in unchanged:
    current = (REPO / filename).read_bytes()
    assert current == git('show', f'{PARENT}:{filename}'), filename
    assert current == git('show', f'{DIVISION}:{filename}'), filename
    source_rows.append({'path': filename, 'size': len(current), 'sha256': sha(current)})

live = 'tools/verify/omarchy-desktop-live.mjs'
old_live = git('show', f'{PARENT}:{live}').decode()
new_live = (REPO / live).read_text()
assert new_live.split('async function runLive()', 1)[1].split('\ntry {\n  await runLive();', 1)[0] == old_live.split('async function runLive()', 1)[1].split('\ntry {\n  await runLive();', 1)[0]

wasm = REPO / 'web/dist/pkg/wasm_vm_wasm_bg.wasm'
assert sha(wasm.read_bytes()) == '1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d'
r3 = [
    ('releases/kernel/6.6.63/Image', 24208896, 'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce'),
    ('target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz', 205050833, '2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5'),
    ('target/omarchy-sdr-r3-snapshot/omarchy-overlay-delta.bin.gz', 1209196, '1f56d0bd44c945fab3ec1c201d04f39dd3f590320f54c8d2224446ebffb7e7da'),
    ('target/omarchy-profile-chunks-sdr-r3-256k/manifest.json', 1097812, '5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44'),
]
r3_rows = []
for filename, size, digest in r3:
    data = (REPO / filename).read_bytes()
    assert len(data) == size and sha(data) == digest, filename
    r3_rows.append({'path': filename, 'size': size, 'sha256': digest})

diagnostic = EVIDENCE / 'sdr-r3-cap256-input/diagnostic.json'
diagnostic_data = json.loads(diagnostic.read_text())
result = {
    'checkedAt': datetime.now(timezone.utc).isoformat(),
    'checkedHead': git('rev-parse', 'HEAD').decode().strip(),
    'verifiedParent': PARENT, 'verifiedDivision': DIVISION,
    'runtimeDiffFromEitherVerifiedParent': [],
    'actualRunLiveFunctionUnchanged': True,
    'unchangedSources': source_rows,
    'wasm': {'size': wasm.stat().st_size, 'sha256': sha(wasm.read_bytes())},
    'r3': r3_rows,
    'divisionSealedFiles': division_rows,
    'admissionSealedFiles': admission_rows,
    'additionalPriorPins': prior_pins,
    'earlierNegativeDiagnostic': {'path': str(diagnostic.relative_to(REPO)),
                                  'sha256': sha(diagnostic.read_bytes()),
                                  'firstTime': diagnostic_data[0]['time'],
                                  'selection': diagnostic_data[0]['jitResidency'],
                                  'scope': 'Diagnostic input/image screen, not fixed nonce acceptance.'},
    'priorResidencyNegativeReports': {
        'control': identity_digest('residency-after-fp-r1/control/report.json', '65fb5dc0ac51e50702ea0583ea8bdb15f8bab98455c9068b1165581a2c86bdd5'),
        'candidate': identity_digest('residency-after-fp-r1/candidate/report.json', '33eaa82a64ade55c36efb27aca5ac021a3d028ab77dbdd696b83a4be6d8dc037'),
    },
    'budgetSourceAudit': {
        'selector': 'crates/wasm/src/lib.rs:503-544',
        'onlyPerArmBudgetAssignment': 'budget.max_batches = max_batches',
        'browserDefault': 'crates/wasm/src/jit_browser.rs:1255-1257',
        'unchangedCommonBudgets': {'codeBytes': 33554432, 'tableSlots': 32768, 'metadataBytes': 8388608},
        'scope': 'Unchanged source and exact built artifact; no new runtime instrumentation.'},
}
(OUT / 'carry-forward.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'head': result['checkedHead'], 'divisionFiles': len(division_rows),
                  'admissionFiles': len(admission_rows), 'wasm': result['wasm'],
                  'runtimeDiff': [], 'actualRunLiveUnchanged': True}, indent=2))
