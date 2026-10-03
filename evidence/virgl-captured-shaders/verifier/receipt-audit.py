#!/usr/bin/env python3
"""Independent T10d read-only artifact/provenance and corpus audit."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'evidence/virgl-captured-shaders'
HEAD = '8759a30622e6604b8cd3d5c35d110260c6fd1943'
OLD_HEAD = '6993efb1540cf7f5a01f6c82b8dac32cee734b39'
sha = lambda data: hashlib.sha256(data).hexdigest()
read = lambda path: json.loads(path.read_text())
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)
summary = {'head': HEAD, 'status': 'running', 'tiers': {}}

for tier in ('worker', 'cold-clone/acceptance'):
    output = EVIDENCE / tier
    receipt = read(output / 'receipt.json')
    assert receipt['head'] == HEAD and receipt['status'] == 'passed'
    for name, digest in receipt['sourceSha256'].items():
        assert sha((ROOT / name).read_bytes()) == digest, (tier, name, 'worktree')
        assert sha(git('show', HEAD + ':' + name)) == digest, (tier, name, 'git')
    for name, digest in receipt['reports'].items():
        assert sha((output / name).read_bytes()) == digest, (tier, name, 'report')
    for name, digest in receipt['compilerSha256'].items():
        assert sha(Path(name).read_bytes()) == digest, (tier, name, 'compiler')
    browsers = {}
    for name in ('literal', 'captured', 'sabotage', 'contract/browser'):
        path = output / name / 'report.json'
        report = read(path)
        assert report['gitHead'] == HEAD and report['trackedChanges'] == []
        assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
        for record in report['sources'] + report['servedFiles']:
            data = (ROOT / record['path']).read_bytes()
            assert len(data) == record['size'] and sha(data) == record['sha256'], record['path']
        photo = report.get('screenshot') or report['failureScreenshot']
        assert sha((output / name / photo['path']).read_bytes()) == photo['sha256']
        browsers[name] = {'sources': len(report['sources']), 'served': len(report['servedFiles']),
                          'reportSha256': sha(path.read_bytes()),
                          'status': report['status'],
                          'checkedPixels': report['acceptance'].get('checkedPixels'),
                          'wasm': [r for r in report['servedFiles'] if r['path'].endswith('.wasm')]}
    native = read(output / 'native/native-report.json')
    assert sha((output / 'native/native.log').read_bytes()) == native['logSha256']
    assert sha(Path(native['command'][0]).read_bytes()) == native['binarySha256']
    summary['tiers'][tier] = {'sources': len(receipt['sourceSha256']),
                              'compilers': len(receipt['compilerSha256']),
                              'reports': len(receipt['reports']), 'browsers': browsers}

assert read(EVIDENCE / 'worker/receipt.json')['sourceSha256'] == read(
    EVIDENCE / 'cold-clone/acceptance/receipt.json')['sourceSha256']
cold = read(EVIDENCE / 'cold-clone/report.json')
assert cold['head'] == HEAD and cold['status'] == 'passed'
assert cold['statusBefore'] == cold['statusAfter'] == ''
assert sha((EVIDENCE / 'cold-clone/acceptance/receipt.json').read_bytes()) == cold['acceptanceReceiptSha256']
assert sha((EVIDENCE / 'cold-clone/cold.log').read_bytes()) == cold['logSha256']
summary['coldCloneBindings'] = 'HELD; 102 identical source digests; clean before/after'

old_root = ROOT / 'evidence/virgl-shader/verifier'
old_digests = read(old_root / 'digests.json')
for name, digest in old_digests.items():
    assert sha((old_root / name).read_bytes()) == digest, name
assert not git('diff', '--name-only', 'd0a5b1fc..' + HEAD, '--', 'evidence/virgl-shader')
unchanged = ['renderer/virgl-shader/' + p for p in (
    'vendor', 'generated', 'UPSTREAM.json', 'index.mjs', 'bridge.h', 'cli.c',
    'verify_sources.py', 'regenerate.py', 'tests/corpus.mjs')]
unchanged += ['tools/setup-virgl-emsdk.sh']
assert not git('diff', '--name-only', OLD_HEAD + '..' + HEAD, '--', *unchanged)
assert not git('diff', '--name-only', 'd0a5b1fc..' + HEAD, '--',
               'Cargo.toml', 'Cargo.lock', 'crates', 'src', 'web')
summary['heldT10a'] = {'evidenceDigests': len(old_digests), 'unchangedBoundaries': unchanged,
                     'productionDiffFromParent': 'empty'}
old_literal = read(ROOT / 'evidence/virgl-shader/worker/browser/report.json')['acceptance']
new_literal = read(EVIDENCE / 'worker/literal/report.json')['acceptance']
assert len(old_literal['translations']) == len(new_literal['translations']) == 6
for old, new in zip(old_literal['translations'], new_literal['translations']):
    for field in ('name', 'sourceSha256', 'glslSha256', 'glsl'):
        assert old[field] == new[field], (old['name'], field)
assert len(old_literal['draws']) == len(new_literal['draws']) == 9
for old, new in zip(old_literal['draws'], new_literal['draws']):
    for field in ('name', 'rgbaSha256', 'checkedPixels'):
        assert old[field] == new[field], (old['name'], field)
summary['heldT10a']['literalRegression'] = 'Six identical source/GLSL hashes; nine identical RGBA hashes/pixel counts'

contract = read(ROOT / 'docs/gpu-3d-contract.json')
worker = read(EVIDENCE / 'worker/contract/receipt.json')
outcomes = {}
for digest, expected in contract['capturedShaders'].items():
    paths = list((ROOT / 'evidence/virgl-corpus/captures').glob('*/shaders/' + digest + '.tgsi'))
    assert paths, digest
    inputs = {path.read_bytes() for path in paths}
    assert len(inputs) == 1
    raw = inputs.pop()
    assert sha(raw) == digest
    result = subprocess.run([str(ROOT / 'renderer/virgl-shader/build/native/virgl-shader'),
                             {'VERT': 'vertex', 'FRAG': 'fragment'}[expected['stage']]],
                            input=raw, capture_output=True, check=True, timeout=5)
    actual = json.loads(result.stdout)
    assert actual == worker['capturedShaderResults'][digest], digest
    outcome = 'translated' if actual['ok'] else actual['error']['code']
    assert outcome == (expected['currentBridge'] if actual['ok'] else expected['rejectionCode'])
    outcomes[digest] = outcome
assert len(outcomes) == 19
summary['independentNativeOutcomes'] = outcomes
summary['independentNativeOutcomeCounts'] = dict(Counter(outcomes.values()))
summary['status'] = 'passed'
print(json.dumps(summary, indent=2, sort_keys=True))
