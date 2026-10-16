#!/usr/bin/env python3
"""Authenticate the frozen complete compiler/native/historical evidence closure."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
BASE = 'd8d510a689cfb5440cc8b3b65fd94adb9baee109'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def main(directory):
    directory = Path(directory).resolve()
    head = git('rev-parse', 'HEAD')
    assert not git('diff', '--name-only', 'HEAD'), 'freeze source before recording'
    for _ in range(500):
        if b'\nINTEGER_IMAGE_SHADER_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():
            break
        time.sleep(.01)
    else:
        raise ValueError('incomplete final recording log')
    load = lambda name: json.loads((directory/name).read_text())
    physical = load('physical-audit.json')
    assert physical['status'] == 'passed' and len(physical['records']) == 3
    assert physical['records'][0]['frames'] == 542 and not physical['records'][0]['mismatches']
    assert all(row['status'] == 'refuted' and any(m['kind'] == 'native-output' for m in row['mismatches']) for row in physical['records'][1:])
    audit, facade, coverage = load('native/audit.json'), load('native/facade.json'), load('coverage-audit.json')
    assert audit['status'] == 'passed' and audit['exactNativeWasm'] and audit['fixedMemoryBytes'] == 16777216
    assert audit['accepted'] >= 1975 and audit['rejected'] >= 611 and audit['cases'] == audit['accepted'] + audit['rejected']
    assert facade['status'] == 'passed' and facade['getters'] == 0 and facade['ownedSnapshots'] and facade['peerIsolation'] and facade['pressure']['recovered']
    assert facade['historical']['allResponseBytesIdentical'] and facade['historical']['predecessor'] == BASE
    assert (directory/'native/native.jsonl').read_bytes() == (directory/'native/sanitize.jsonl').read_bytes()
    allocations = [json.loads(row) for row in (directory/'native/allocations.jsonl').read_text().splitlines()]
    assert allocations[-1]['faults'] == allocations[-1]['recoveries'] == 165 and allocations[-1]['callerMutation'] and not allocations[-1]['partialResults']
    assert coverage['gitHead'] == head and coverage['positive'] and coverage['nativePositive'] and not coverage['zero'] and not coverage['nativeZero']
    assert load('native/selected-float.json')['status'] == 'passed'
    assert load('retained-texture/physical-audit.json')['status'] == 'passed'
    authentication = load('native/predecessor/authentication.json')
    assert authentication['status'] == 'passed' and authentication['predecessor'] == BASE and authentication['unchangedResourceTransportGuest']
    assert not git('diff', '--name-only', BASE, head, '--', 'renderer/virgl-command', 'crates', 'web', 'tools/guest'), 'storage/production boundary unchanged'
    stack_frames = {}
    for file in (directory/'stack').glob('*.su'):
        for line in file.read_text().splitlines():
            fields = line.split('\t')
            stack_frames[fields[0].rsplit(':',1)[-1]] = int(fields[1])
    stack = {}
    for mode, names in [('stage',['bridge_translate_standard_integer_image','standard_stage']),('pair',['bridge_translate_standard_integer_image_pair','standard_pair'])]:
        names += ['standard_convert','vrend_convert_shader','standard_emit']
        assert all(name in stack_frames for name in names)
        observed = {name:stack_frames[name] for name in names}
        observed['conservativeBytes'] = sum(observed.values())
        assert observed['conservativeBytes'] < 262144
        stack[mode] = observed
    sources, generated = {}, {}
    source_roots = ['renderer/virgl-shader','renderer/virgl-command',
                    'tools/virgl-integer-image-shader','tools/virgl-standard-texture',
                    'tools/virgl-standard-uniform','tools/verify-virgl-integer-image-shader.sh',
                    'tools/lib/virgl-browser-runner.mjs','tools/virgl-original-corpus/toolchain.py',
                    'tools/virgl-original-corpus/shared.py','tools/setup-virgl-emsdk.sh',
                    'web/package.json','web/package-lock.json','Makefile',
                    'tasks/epic-6-transcendence/E6-T11d32-standard-integer-image-shaders.md',
                    'evidence/virgl-production-readiness/standard-texture-operation-gap.json',
                    'evidence/virgl-production-readiness/standard-integer-image-shader-gap.json',
                    'evidence/virgl-production-readiness/standard-integer-image-shader-gap.mjs']
    for name in git('ls-files',*source_roots).splitlines():
        raw = (ROOT/name).read_bytes()
        assert raw == subprocess.check_output(['git','show',head+':'+name],cwd=ROOT)
        sources[name] = sha(raw)
    for name in ['hardware','fault-wrong-level','fault-wrong-words','retained-texture/hardware','retained-texture/fault-lod-selection','retained-texture/fault-gradient-state','retained-texture/fault-query-levels']:
        report = load(name+'/report.json')
        assert report['gitHead'] == head and not report['trackedChanges']
        assert report['browserErrors'] == dict(console=[],page=[],requests=[])
        assert report['status'] == ('failed' if '/fault-' in '/'+name else 'passed')
        for item in report['sources'] + report['servedFiles']:
            raw = (ROOT/item['path']).read_bytes()
            assert sha(raw) == item['sha256'], 'native source drift '+item['path']
            if '/build/' in item['path'] or item['path'].startswith('target/'):
                generated[item['path']] = sha(raw)
            else:
                assert raw == subprocess.check_output(['git','show',head+':'+item['path']],cwd=ROOT)
                sources[item['path']] = sha(raw)
    files = {p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name != 'receipt.json'}
    receipt = dict(schema='original-integer-image-shader-receipt-v1',task='E6-T11d32',status='passed',gitHead=head,predecessor=BASE,physical=physical,compiler=audit,facadeChecks=len(facade['rejections']),historical=facade['historical'],allocations=allocations[-1],coverage=dict(javascript=coverage['positive'],native=coverage['nativePositive'],zero=[],nativeZero=[]),stack=stack,sources=sources,generated=generated,files=files,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print('Frozen original integer shaders, native words and retained ABIs authenticated.')


if __name__ == '__main__':
    main(sys.argv[1])
