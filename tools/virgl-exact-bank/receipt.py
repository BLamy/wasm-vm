#!/usr/bin/env python3
"""Bind exact frozen consumer sources, original binaries/profiles and hardware evidence."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SEEDS = [1779033703, 3144134277, 1013904242]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    assert not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT), 'freeze tracked sources'
    sources = {}

    def source(name, digest=None):
        raw = (ROOT / name).read_bytes()
        assert digest is None or sha(raw) == digest, name
        if not name.startswith(('renderer/virgl-shader/build/', 'target/virgl-exact-bank-fault/')):
            assert raw == subprocess.check_output(['git', 'show', head + ':' + name], cwd=ROOT), name
        sources[name] = {'path': name, 'bytes': len(raw), 'sha256': sha(raw)}

    def report(name, task='E6-T12g6m3a', status='passed'):
        value = json.loads((directory / name).read_bytes())
        assert value['gitHead'] == head and value['task'] == task and value['status'] == status, name
        return value

    native = report('native/report.json')
    node = report('node.json')
    assert node['nativeSha256'] == sha((directory / 'native/report.json').read_bytes())
    assert len(native['cases']) == len(node['cases']) == 18 and len(node['metadataAttacks']) == 322 and len(node['bankAttacks']) == 323
    assert node['getterInvocations'] == 0 and len(node['ownership']) == 18
    assert not (directory / 'native/native.stderr').read_bytes()
    source(native['binary']['path'], native['binary']['sha256'])
    assert sha((directory / 'native/cases.bin').read_bytes()) == native['fixtureSha256']
    assert sha((directory / 'native/native.log').read_bytes()) == native['stdoutSha256']
    for original, current in zip(native['cases'], node['cases']):
        assert original['result'] == current['original'] and original['pairResult'] == current['pair']
        assert sha(original['text'].encode()) == original['textSha256']
    legacy = report('legacy.json', task='E6-T12g6m2')
    assert len(legacy['cases']) == 10717 and legacy['oldPairs'] == 2683 and len(legacy['extensions']) == 177
    for previous in legacy['predecessors']:
        for name in ['manifest.json', 'records.json']:
            source(previous['path'] + '/' + name)
        source(previous['path'] + '/' + previous['manifest']['archive']['path'], previous['manifest']['archive']['sha256'])
    coverage = report('coverage-audit.json')
    assert coverage['lines'] and all(line['status'] in ['executed', 'waived'] for line in coverage['lines'])
    pixels = attacks = uploads = 0
    for seed in SEEDS:
        browser = report(f'gpu-{seed}/report.json')
        check = report(f'capture-{seed}.json')
        assert not browser['trackedChanges']
        assert check['sourceReportSha256'] == sha((directory / f'gpu-{seed}/report.json').read_bytes())
        assert check['nodeReportSha256'] == sha((directory / 'node.json').read_bytes())
        assert not check['physicalContradictions']
        assert browser['acceptance']['seed'] == seed and len(browser['acceptance']['rigs']) == 25
        for entry in browser['sources'] + browser['servedFiles']:
            source(entry['path'], entry['sha256'])
        assert sha((directory / f'gpu-{seed}' / browser['screenshot']['path']).read_bytes()) == browser['screenshot']['sha256']
        assert sha((directory / f'gpu-{seed}' / browser['browserCoverage']['path']).read_bytes()) == browser['browserCoverage']['sha256']
        pixels += check['checkedPixels']
        attacks += check['checkedAttacks']
        uploads += check['checkedUploadWords']
    fault = report('fault/report.json', status='failed')
    control = report('capture-fault.json')
    assert len(control['physicalContradictions']) == 1 and control['sourceReportSha256'] == sha((directory / 'fault/report.json').read_bytes())
    for entry in fault['sources'] + fault['servedFiles']:
        source(entry['path'], entry['sha256'])
    assert sha((directory / 'fault' / fault['failureScreenshot']['path']).read_bytes()) == fault['failureScreenshot']['sha256']
    paths = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-command', 'renderer/virgl-shader', 'tools/virgl-exact-bank', 'tools/virgl-known-branches/legacy.mjs', 'tools/virgl-known-branches/cases.mjs', 'tools/virgl-known-branches/held-cases.mjs', 'tools/virgl-known-branches/original-cases.mjs', 'tools/virgl-known-branches/flow-cases.mjs', 'tools/virgl-known-branches/extensions.json', 'tools/lib/virgl-browser-runner.mjs', 'tools/setup-virgl-emsdk.sh', 'tools/verify-virgl-exact-bank.sh', 'Makefile', 'web/package-lock.json'], cwd=ROOT, text=True).splitlines()
    for name in paths:
        source(name)
    for name in ['native/virgl-shader', 'wasm/virgl-shader.mjs', 'wasm/virgl-shader.wasm']:
        source('renderer/virgl-shader/build/' + name)
    records = []
    for path in sorted(directory.rglob('*')):
        if path.is_file() and path.name not in ['receipt.json', 'acceptance.log']:
            raw = path.read_bytes()
            records.append({'path': str(path.relative_to(directory)), 'bytes': len(raw), 'sha256': sha(raw)})
    value = {'schema': 'virgl-exact-bank-receipt-v1', 'task': 'E6-T12g6m3a', 'status': 'passed', 'gitHead': head, 'sources': list(sources.values()), 'records': records, 'nativeCases': 18, 'legacyCases': 10717, 'metadataAttacks': 322, 'bankCases': 323, 'seeds': SEEDS, 'checkedPixels': pixels, 'checkedAttacks': attacks, 'checkedUploadWords': uploads, 'physicalContradictions': control['physicalContradictions'], 'guestExecution': False, 'productionNegotiation': False, 'trustedHostMetadataWrapper': True}
    (directory / 'receipt.json').write_text(json.dumps(value, indent=2) + '\n')
    print(f'E6-T12g6m3a receipt passed: {pixels} literal pixels, {attacks} rejected inputs')


if __name__ == '__main__':
    main()
