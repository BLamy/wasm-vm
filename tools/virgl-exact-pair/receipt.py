#!/usr/bin/env python3
"""Bind exact-head paired compiler source, binaries and complete physical captures."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6m3c'
SEEDS = [1779033703, 3144134277, 1013904242]
FAULTS = ['interface', 'metadata']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    out = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    assert not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT), 'freeze tracked sources'
    sources = {}

    def source(name, digest=None):
        raw = (ROOT / name).read_bytes()
        assert digest is None or sha(raw) == digest, name
        generated = name.startswith(('renderer/virgl-shader/build/', 'target/virgl-exact-pair-fault/'))
        if not generated:
            assert raw == subprocess.check_output(['git', 'show', head + ':' + name], cwd=ROOT), name
        sources[name] = dict(path=name, bytes=len(raw), sha256=sha(raw))

    def report(name, task=TASK, status='passed'):
        value = json.loads((out / name).read_bytes())
        assert value['task'] == task and value['status'] == status and value['gitHead'] == head, name
        return value

    native, node = report('native/report.json'), report('node.json')
    fixture = json.loads((ROOT / 'tools/virgl-exact-pair/fixtures.json').read_bytes())
    assert len(native['cases']) == len(node['cases']) == len(fixture) == 118
    assert node['nativeSha256'] == sha((out / 'native/report.json').read_bytes())
    assert native['layout'] == [111752, 32448, 12, 2996]
    assert len(native['rejections']) == 17 and len(native['failures']) >= 1939
    assert len(node['schemaAttacks']) == 175 and len(node['nativeRequests']) == 18
    assert node['getterInvocations'] == 0 and len(node['ownership']) >= 4
    assert not (out / 'native/native.stderr').read_bytes()
    assert sha((out / 'native/cases.bin').read_bytes()) == native['fixtureSha256']
    assert sha((out / 'native/native.log').read_bytes()) == native['stdoutSha256']
    source(native['binary']['path'], native['binary']['sha256'])
    for c, w, f in zip(native['cases'], node['cases'], fixture):
        assert c['name'] == w['name'] == f['name']
        for key in ['vertexText', 'fragmentText', 'vertexComponents', 'fragmentComponents']:
            assert c[key] == f[key]
        assert c['result'] == w['result'] and c['defaultResult'] == w['defaultResult']
        assert c['singles'] == w['singles']
        assert sha(c['vertexText'].encode()) == c['vertexSha256']
        assert sha(c['fragmentText'].encode()) == c['fragmentSha256']
        for stage in ['vertex', 'fragment']:
            if f.get(stage + 'Source'):
                name = f[stage + 'Source']
                source(name)
                assert c[stage + 'Text'].encode() == (ROOT / name).read_bytes()
    assert sum(c['name'].startswith('full-original/') for c in native['cases']) == 2
    assert all(not c['result']['ok'] for c in native['cases'] if c['name'].startswith('full-original/'))
    legacy = report('legacy.json', task='E6-T12g6m2')
    assert len(legacy['cases']) == 10717 and legacy['oldPairs'] == 2683 and len(legacy['extensions']) == 177
    for predecessor in legacy['predecessors']:
        for name in ['manifest.json', 'records.json']:
            source(predecessor['path'] + '/' + name)
        source(predecessor['path'] + '/' + predecessor['manifest']['archive']['path'],
               predecessor['manifest']['archive']['sha256'])
    coverage = report('coverage-audit.json')
    assert coverage['lines'] and all(x['status'] in ['executed', 'waived'] for x in coverage['lines'])
    assert coverage['nativeBranches'] and all(x['status'] in ['executed', 'waived'] for x in coverage['nativeBranches'])
    assert coverage['jsChildren'] and all(x['status'] == 'executed' for x in coverage['jsChildren'])
    stack = []
    (out / 'stack').mkdir(exist_ok=True)
    for name in ['bridge.su', 'raw_bits.su']:
        raw = (ROOT / 'renderer/virgl-shader/build/compiler-bounds-wasm-stack' / name).read_bytes()
        (out / 'stack' / name).write_bytes(raw)
        for row in raw.decode().splitlines():
            function, size, kind = row.split('\t')
            assert kind == 'static'
            stack.append(dict(function=function.split(':')[-1], bytes=int(size), kind=kind))
    entries = [x['bytes'] for x in stack if x['function'] in
               ['bridge_translate', 'bridge_translate_pair', 'bridge_translate_exact', 'bridge_translate_pair_exact']]
    assert len(entries) == 4
    peak = sum(x['bytes'] for x in stack) - sum(entries) + max(entries)
    assert peak < 262144
    pixels = attacks = frames = uploads = 0
    contradictions = []
    names = [(f'gpu-{seed}', 'passed') for seed in SEEDS] + [(f'fault-{fault}', 'failed') for fault in FAULTS]
    for name, status in names:
        browser = report(name + '/report.json', status=status)
        suffix = name.removeprefix('gpu-')
        check = report('capture-' + suffix + '.json')
        assert not browser['trackedChanges'] and not any(browser['browserErrors'].values())
        assert check['reportSha256'] == sha((out / name / 'report.json').read_bytes())
        assert check['nodeReportSha256'] == sha((out / 'node.json').read_bytes())
        assert check['nativeReportSha256'] == sha((out / 'native/report.json').read_bytes())
        assert browser['acceptance']['trustedHostWrapper'] is False
        for entry in browser['sources'] + browser['servedFiles']:
            source(entry['path'], entry['sha256'])
        image = browser['screenshot' if status == 'passed' else 'failureScreenshot']
        assert sha((out / name / image['path']).read_bytes()) == image['sha256']
        if status == 'passed':
            assert not check['contradictions'] and len(browser['acceptance']['rigs']) == 17
            assert check['checkedFrames'] == 281 and check['checkedPixels'] == 17984
            assert check['checkedAttacks'] == 266 and check['checkedUploadWords'] > 0
            pixels += check['checkedPixels']
            frames += check['checkedFrames']
            attacks += check['checkedAttacks']
            uploads += check['checkedUploadWords']
        else:
            assert len(browser['acceptance']['rigs']) == 1
            assert len(check['contradictions']) >= 3
            contradictions.extend(check['contradictions'])
            fault = browser['acceptance']['fault']
            assert fault in FAULTS
            for entry in browser['faultSources']['artifacts']:
                source('target/virgl-exact-pair-fault/' + fault + '/' + entry['path'], entry['sha256'])
            source('target/virgl-exact-pair-fault/' + fault + '/manifest.json')
    paths = subprocess.check_output(['git', 'ls-files', 'renderer/virgl-shader', 'renderer/virgl-command',
        'tools/virgl-exact-pair', 'tools/virgl-known-branches', 'tools/lib/virgl-browser-runner.mjs',
        'tools/setup-virgl-emsdk.sh', 'tools/verify-virgl-exact-pair.sh', 'Makefile', 'web/package-lock.json'],
        cwd=ROOT, text=True).splitlines()
    for name in paths:
        source(name)
    for name in ['native/virgl-shader', 'wasm/virgl-shader.mjs', 'wasm/virgl-shader.wasm']:
        source('renderer/virgl-shader/build/' + name)
    records = [dict(path=str(path.relative_to(out)), bytes=path.stat().st_size, sha256=sha(path.read_bytes()))
               for path in sorted(out.rglob('*')) if path.is_file() and path.name not in ['receipt.json', 'acceptance.log']]
    result = dict(schema='virgl-exact-pair-receipt-v1', task=TASK, status='passed', gitHead=head,
        sources=list(sources.values()), records=records, nativeCases=len(native['cases']),
        allocationFaults=len(native['failures']), schemaAttacks=len(node['schemaAttacks']),
        directAbiAttacks=len(node['nativeRequests']), legacyCases=len(legacy['cases']), seeds=SEEDS,
        checkedFrames=frames, checkedPixels=pixels, checkedAttacks=attacks, checkedUploadWords=uploads,
        physicalContradictions=contradictions, measuredStack=stack, ownedWasmPeakUpperBoundBytes=peak,
        stackScope='all nonrecursive owned helpers plus maximum serialized entry frame; unchanged upstream/libc excluded',
        guestExecution=False, productionNegotiation=False, trustedHostMetadataWrapper=False)
    (out / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f'{TASK} receipt passed: {frames} independent frames, {pixels} pixels, '
          f'{attacks} rejected banks; {peak} owned Wasm stack bytes')


if __name__ == '__main__':
    main()
