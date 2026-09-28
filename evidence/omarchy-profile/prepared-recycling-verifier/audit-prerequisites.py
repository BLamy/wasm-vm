#!/usr/bin/env python3
"""Carry sealed AK/AJ/AL/AA/AC proofs and exact pair bytes, without a guest run."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
BASE = ROOT/'evidence/omarchy-profile'
ACTIVATION = '9d33f60f'
ENV = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT, env=ENV)
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024*1024): h.update(chunk)
    return h.hexdigest()

index_specs = [
    ('prepared-direct-input-verifier', '2e7b6941e36c164915d517f8c8bd4c3311bed2ba81fd14ef3978272686abc0ff', 35, 'self'),
    ('prepared-direct-input-gates', '0713fe766d9d9b9aa6baeaa859c4e574b27b1b861e79f4c32cf3f7f234154c37', 16, 'root'),
    ('prepared-direct-opaque-verifier-r2', '756b8d41ade51334946fbd6da5d382f679921a53c6664e2ec73242da4b4749f2', 19, 'root'),
    ('prepared-direct-opaque-gates-r2', '3a0f9c5dda2451270754cf3df8a23461d1710c8d95eb17376aa642d08476b1c6', 12, 'root'),
    ('snapshot-allocation-verifier', 'beb56a096ced5f60cbac0c5b1c3d0304046addf599011be2f3812935944a496f', 25, 'root'),
    ('snapshot-allocation-gates', '01786a6b6a15415c7977b4dc23fde07a2e1d82cb1b775340aefe8c888cb42632', 33, 'root'),
    ('admission-after-fp-verifier', '1998d455327548b8bc1d8042999a126fde30b9fb0c2d866edd7985cccff21b5d', 14, 'self'),
    ('admission-after-fp-gates', '259068acb1383a640be7a3b725813dab649350cf95803d68c4c3b3a281b45a06', 29, 'profile'),
    ('worker-cost-verifier', '56f7b27b7fe1cb8c1ba9aba47c65b670460a280bb268bf65be1227fb0a533799', 29, 'self'),
    ('worker-cost-gates-r2', 'dc0366bc3a2e2b4d7279ad82f299bfc0b6deeee56e987726f286b6065d20c2ae', 25, 'profile'),
]
seals = []
for folder, expected, count, relative in index_specs:
    index = BASE/folder/'sha256.txt'
    data = index.read_bytes()
    assert data == git('show', ACTIVATION+':'+str(index.relative_to(ROOT)))
    assert digest(index) == expected
    rows = []
    for line in data.decode().splitlines():
        expected_file, name = line.split('  ', 1)
        target = {'root':ROOT, 'self':index.parent, 'profile':BASE}[relative]/name
        assert digest(target) == expected_file, str(target)
        rows.append(dict(path=str(target.relative_to(ROOT)), sha256=expected_file))
    assert len(rows) == count
    seals.append(dict(index=str(index.relative_to(ROOT)), sha256=expected, files=rows, count=count))

pins = [
    ('target/omarchy-direct-opaque-r2/omarchy-ready.snap.gz',207172408,'989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75'),
    ('target/omarchy-direct-opaque-r2/omarchy-overlay-delta.bin.gz',1232847,'4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972'),
    ('releases/kernel/6.6.63/Image',24208896,'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce'),
    ('target/omarchy-profile-chunks-sdr-r3-256k/manifest.json',1097812,'5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44'),
    ('web/dist/pkg/wasm_vm_wasm_bg.wasm',1597586,'8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4'),
]
files = []
for name, size, expected in pins:
    p = ROOT/name
    assert p.stat().st_size == size and digest(p) == expected and not p.is_symlink(), name
    files.append(dict(path=name,size=size,sha256=expected))
assert not git('diff','--name-only','27eab37c','--','crates','web','Cargo.toml','Cargo.lock').strip()
carried_source = []
for parent, names in [
    ('81f01ba3',['crates/core/src/dispatch.rs','crates/core/src/jit.rs','crates/wasm/src/jit_browser.rs','crates/wasm/src/lib.rs']),
    ('8ad58861',['tools/verify/omarchy-worker-cost-capture.mjs','tools/verify/e5-t22c-cpu-profile.mjs','tools/verify/e5-t22c-symbolize-cpu.mjs']),
]:
    for name in names:
        assert (ROOT/name).read_bytes() == git('show',parent+':'+name), name
        carried_source.append(dict(path=name,unchangedFrom=parent,sha256=digest(ROOT/name)))

control_path = BASE/'prepared-direct-input-r1/desktop/report.json'
assert digest(control_path) == '0d4f8f50d2d9e940ce098f744202bcff49ae3c1048b39d692231d1d2c7fa38ea'
control=json.loads(control_path.read_text())
assert control['trial']['recycling'] is False and control['trial']['jitResidencyCap'] == 256
assert control['result'] == 'failed'
result = dict(auditedAt=datetime.now(timezone.utc).isoformat(),activationHead=ACTIVATION,
    filesRehashed=sum(x['count'] for x in seals),seals=seals,pairBaseAndRuntime=files,
    carriedSource=carried_source,controlReportSha256=digest(control_path),
    controlOutcome=control['trial']['outcome'],controlTrial=control['trial'],
    scope='Only unchanged prerequisite evidence is carried. AJ complete pair parsing and AL runtime proof are not repeated. AK remains the single recorded recycling-OFF control; AA confirms existing recycling semantics, AC confirms unchanged post-verdict sampler/fence/binder. AM option integration and actual outcome still require independent verification.')
(HERE/'prerequisites.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(carriedEvidenceFiles=result['filesRehashed'],sourceBoundaries=len(carried_source),
    pairAndRuntimePins=len(files),controlReportSha256=result['controlReportSha256']),indent=2))
