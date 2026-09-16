#!/usr/bin/env python3
"""Read-only identity audit for prior HELD proof; no browser or test process."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ENV = {**os.environ, 'DEVELOPER_DIR': '/Library/Developer/CommandLineTools'}
SHA = lambda data: hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO, env=ENV)


pins = {
    'counter-recycling-ab-r1/control/report.json': 'de910c4c0dde59e5cc3ac00bd17c2263e748b03cd9b196a11d3fe9aaa75fbaa4',
    'counter-recycling-ab-r1/candidate/report.json': 'c5abcbcd06795e8261ab5ed93c1889239ed5c6ee624e0f6b81b8e2b1d12eba02',
    'counter-recycling-ab-r1/ab.json': 'd7c9ed78e998eb58cc3c84a2201016b719fcada7bcee8c3d32d08c5787f970b9',
    'counter-recycling-ab-r1/audit.json': '323c4a0e59f557e9abe0ca122cab57fe2dface79828785801d5d8ca4bc4183b9',
    'user-path-input-r1/run.json': '4342868fbd2de53ec2ac71e9c49842273d19d4be34c406ef5b660107abe5ef98',
    'user-path-input-r1/desktop/report.json': '00ee2657553d1e9111f3f4e535a2534267b6fdf6d9724a826ce6690d994438d2',
    'user-path-input-r1/desktop/serial.log': 'afa7714b40c5ee696e837bce1aa90518e333665c5ee4cabdeb7b8bc01865fd48',
    'user-path-input-r1/desktop/desktop.png': '97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f',
    'user-path-input-r1/desktop/failure.png': '97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f',
    'fp-division-r1/sha256.txt': 'da8b6685880651034ec46f81a030ba2dcb516d8c1eb5fba551bb7158829e902a',
    'fp-division-r1/physical-input/desktop/report.json': '6c220572738d7bcb6a7a03c184823a2dbf310dc1f0492a7f66a8262eb455425e',
}
for filename, expected in pins.items():
    assert SHA((REPO / 'evidence/omarchy-profile' / filename).read_bytes()) == expected, filename

division = REPO / 'evidence/omarchy-profile/fp-division-r1'
division_rows = []
for line in (division / 'sha256.txt').read_text().splitlines():
    expected, filename = line.split('  ', 1)
    data = (division / filename).read_bytes()
    assert SHA(data) == expected, filename
    division_rows.append(dict(path=filename, size=len(data), sha256=expected))

prior = '53103e762c6c4003a5976bfa90131a03702fd2e7'
scope = ['crates', 'web', 'tools/verify']
assert not git('diff', '--name-only', prior, 'HEAD', '--', *scope).strip()
assert not git('diff', '--name-only', '--', 'crates', 'web',
               'tools/verify/omarchy-desktop-live.mjs',
               'tools/verify/omarchy-input-trial.mjs',
               'tools/verify/omarchy-recycling-ab.mjs').strip()
dispatch = 'crates/core/src/dispatch.rs'
assert git('show', f'd68be8425cae6f8a921b2ecc85d757314a6b09d4:{dispatch}') == (REPO / dispatch).read_bytes()
policy = 'tools/verify/omarchy-input-trial.mjs'
assert git('show', f'81cab94ea874e2f177d1005887e2adf2435e3777:{policy}') == (REPO / policy).read_bytes()
driver = 'tools/verify/omarchy-recycling-ab.mjs'
assert git('show', f'81cab94ea874e2f177d1005887e2adf2435e3777:{driver}') == (REPO / driver).read_bytes()

wasm = REPO / 'web/dist/pkg/wasm_vm_wasm_bg.wasm'
assert SHA(wasm.read_bytes()) == '1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d'
sources = [dispatch, policy, driver, 'tools/verify/omarchy-owned-trial.mjs',
           'tools/verify/omarchy-live-recording.mjs', 'tools/verify/omarchy-desktop-live.mjs',
           'tools/verify/omarchy-browser-session.mjs', 'web/loader.js', 'web/main.js']
result = dict(head='81f01ba31171b8d670f3842948e556b62bcb0d75',
              checkedHead=git('rev-parse', 'HEAD').decode().strip(),
              verifiedDivision=prior, runtimeAndRecorderDiffFromDivision=[],
              policyImplementationUnchangedSince='d68be8425cae6f8a921b2ecc85d757314a6b09d4',
              fixedPolicyAndABDriverUnchangedSince='81cab94ea874e2f177d1005887e2adf2435e3777',
              sourceSha256={p:SHA((REPO / p).read_bytes()) for p in sources},
              wasm=dict(size=wasm.stat().st_size, sha256=SHA(wasm.read_bytes())),
              priorEvidencePins=pins, divisionSealedFiles=division_rows,
              scopeNotes=[
                  'T03m input-trial guards still omit clients and activewindow RPCs.',
                  'Later failure-checkpoint/render-mode branches are disabled by the A/B driver removing every inherited OMARCHY_ variable.',
                  'Later manifest interception forwards and records the same HTTP body; it is already present in verified T03z.',
                  'Owned watchdog default postVerdictCaptureMs=0 preserves the 530-second total; this driver supplies no override.',
                  'LP1 is inherited from the unchanged pinned R3 pair, not re-attested by a new GL probe.',
              ])
(OUT / 'carry-forward.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['divisionSealedFiles', 'priorEvidencePins']}, indent=2))
