#!/usr/bin/env python3
"""Authenticate exact-head original draws, native planes and the complete source closure."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from predecessor import BASE

ROOT = Path(__file__).resolve().parents[2]
CONFIRMATION = b'Frozen original instanced draws, bindings and native planes authenticated.\n'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()
MODES = dict(matrix=66, bindings=4, typed=24, segments=60, failures=24, reflection=8, limits=8)
SEEDS = ['0x47d195a3', '0x1f305b97', '0xac92e647']


def main(directory):
    directory = Path(directory).resolve()
    head = git('rev-parse', 'HEAD')
    assert not git('diff', '--name-only', 'HEAD'), 'freeze tracked source before recording'
    for _ in range(500):
        if b'\nINSTANCED_STENCIL_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes(): break
        time.sleep(.01)
    else: raise ValueError('incomplete final recording')
    load = lambda name: json.loads((directory/name).read_text())
    predecessor = load('predecessor/authentication.json')
    assert predecessor['status'] == 'passed' and predecessor['predecessor'] == BASE and predecessor['reopenedMembers'] == 97179
    metadata = load('metadata/metadata.json')
    assert metadata['status'] == 'passed' and metadata['gitHead'] == head and len(metadata['rows']) >= 76
    coverage = load('coverage-audit.json')
    assert coverage['gitHead'] == head and coverage['predecessor'] == BASE and coverage['positive'] and not coverage['zero']
    sources, generated, reports = {}, {}, {}
    names = ['hardware-' + m for m in MODES] + ['hardware-boundaries-' + s for s in SEEDS] + ['fault-' + f for f in ['order', 'base', 'phase']] + ['retained-ordered']
    counts = dict(runs=0, frames=0, pixels=0, nativePasses=0, normalizedBytes=0, consumedSyncs=0, disposalOnlySyncs=0)
    for name in names:
        report = load(name+'/report.json')
        fault = name.startswith('fault-')
        assert report['task'] == 'E6-T11d47' and report['gitHead'] == head and report['status'] == ('failed' if fault else 'passed')
        assert report['browserErrors'] == dict(console=[], page=[], requests=[])
        assert not report['browser']['headless'] and sha(Path(report['browser']['executable']).read_bytes()) == report['browser']['sha256']
        assert not any(any(s in arg.lower() for s in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe']) or arg.startswith('--disable-gpu') for arg in report['browser']['commandLine'])
        e = report.get('partial') or report['browserResult']['result']
        assert 'Metal' in e['gpu'] and 'M4' in e['gpu']
        assert not e['guestExecution'] and not e['productionNegotiation']
        for row in report['sources']:
            raw = (ROOT/row['path']).read_bytes()
            assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
            assert raw == (directory/name/'source'/row['path']).read_bytes()
            if '/build/wasm/' in row['path']: generated[row['path']] = row['sha256']
            else:
                assert raw == subprocess.check_output(['git', 'show', head + ':' + row['path']], cwd=ROOT)
                sources[row['path']] = row['sha256']
        for ref in e['runs']:
            if 'path' in ref:
                raw = (directory/name/ref['path']).read_bytes(); assert len(raw) == ref['bytes'] and sha(raw) == ref['sha256']; run = json.loads(raw)
            else: run = ref
            if not fault: assert all(r['held'] for r in run.get('predictions', []))
            assert all(len(h['hex']) % 8 == 0 for h in run['history'])
        for ref in e['blobs']:
            zipped = (directory/name/ref['path']).read_bytes(); raw = gzip.decompress(zipped)
            assert sha(zipped) == ref['gzipSha256'] and len(raw) == ref['bytes'] and sha(raw) == ref['sha256']
        expected = 1 if fault else MODES.get(name[len('hardware-'):], 2 if name == 'retained-ordered' else 24)
        assert len(e['runs']) == expected, name
        values = load(name + ('/control-audit.json' if fault else '/values-audit.json'))
        assert values['status'] == ('refuted' if fault else 'passed') and values['reportSha256'] == sha((directory/name/'report.json').read_bytes())
        if fault:
            assert values['differences'] and values['citations']
            if name == 'fault-order':
                mutation = report['mutation']; raw = (directory/name/'served'/mutation['path']).read_bytes()
                assert sha(raw) == mutation['delivered']['sha256'] and len(raw) == mutation['delivered']['bytes']
        else:
            physical = load(name+'/physical-audit.json')
            assert physical['status'] == 'passed' and physical['reportSha256'] == values['reportSha256']
            assert physical['allCompleteBodiesReopened'] and physical['oracleImportsProductCode'] is False
            for k, value in values['counts'].items():
                if k in counts: counts[k] += value
            for k in ['consumedSyncs', 'disposalOnlySyncs']: counts[k] += physical['counts'][k]
            if name.startswith('hardware-boundaries-'): assert physical['counts']['disposalOnlySyncs'] == 8
        served = {r['path']: r['sha256'] for r in report['servedFiles']}
        browser_coverage = load(name+'/'+report['browserCoverage']['path'])
        for script in browser_coverage['scripts']: assert sha(script['sourceBody'].encode()) == script['sha256'] == served['/'+script['source']]
        for k in ['browserCoverage', 'screenshot']: assert sha((directory/name/report[k]['path']).read_bytes()) == report[k]['sha256']
        reports[name] = dict(reportSha256=values['reportSha256'], valueAudit=values['status'], runs=expected)
    assert generated == predecessor['generated']
    changed = {n for n in git('diff', '--name-only', BASE, head, '--', 'renderer/virgl-command').splitlines() if '/tests/' not in n and not n.endswith('.md')}
    assert changed == {'renderer/virgl-command/state.mjs', 'renderer/virgl-command/constant-domain.mjs'}
    assert not git('diff', '--name-only', BASE, head, '--', 'renderer/virgl-shader', 'crates', 'web', 'tools/guest')
    roots = ['renderer/virgl-command', 'renderer/virgl-shader', 'tools/virgl-command', 'tools/virgl-instanced-stencil',
             'tools/virgl-ordered-stencil', 'tools/verify-virgl-instanced-stencil.mjs', 'tools/verify-virgl-instanced-stencil.sh',
             'Makefile', 'AGENTS.md', 'tools/check_task_policy.py', 'web/package.json', 'web/package-lock.json',
             'tasks/epic-6-transcendence/E6-T11d47-instanced-stencil-consumer.md']
    for name in git('ls-files', *roots).splitlines():
        raw = (ROOT/name).read_bytes(); assert raw == subprocess.check_output(['git', 'show', head+':'+name], cwd=ROOT); sources[name] = sha(raw)
    files = {p.relative_to(directory).as_posix(): sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name != 'receipt.json'}
    result = dict(schema='original-instanced-stencil-receipt-v1', task='E6-T11d47', status='passed', gitHead=head, predecessor=BASE,
                  sources=sources, generated=generated, files=files, carried=predecessor, reports=reports, counts=counts,
                  countsScope='primary original draw captures; lifetime suffixes are independently audited within their full records',
                  guestExecution=False, productionNegotiation=False, productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(result, indent=2)+'\n')
    print(CONFIRMATION.decode(), end='')


if __name__ == '__main__': main(sys.argv[1])
