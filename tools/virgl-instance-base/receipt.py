#!/usr/bin/env python3
"""Authenticate the complete exact-head compiler and physical byte closure."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
BASE='2a55ba679abda640781b854d83726d35fca1d98d'
TASK='E6-T11d46'
CONFIRMATION=b'Frozen original instance IDs, response bytes and native planes authenticated.\n'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()


def main(directory):
    directory=Path(directory).resolve()
    head=git('rev-parse','HEAD')
    assert not git('diff','--name-only','HEAD'),'freeze tracked source before recording'
    for _ in range(500):
        if b'\nINSTANCE_BASE_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete final recording log')
    load=lambda name:json.loads((directory/name).read_text())
    physical=load('physical-audit.json')
    assert physical['status']=='passed' and len(physical['records'])==2
    assert len(physical['records'][0]['frames'])==60 and not physical['records'][0]['mismatches']
    assert physical['records'][1]['status']=='refuted' and len(physical['records'][1]['mismatches'])==12
    audit,facade,coverage=load('native/audit.json'),load('native/facade.json'),load('coverage-audit.json')
    assert audit['status']=='passed' and audit['exactNativeWasm'] and audit['fixedMemoryBytes']==16777216
    assert audit['cases']==4313 and audit['accepted']==3385 and audit['rejected']==928 and audit['historicalResponses']==2586
    assert facade['status']=='passed' and facade['getters']==0 and facade['ownedSnapshots'] and facade['peerIsolation'] and facade['pressure']['recovered']
    assert facade['historical']['allResponseBytesIdentical'] and facade['historical']['predecessor']==BASE
    assert load('native/historical-factories.json')['status']=='passed'
    assert (directory/'native/native.jsonl').read_bytes()==(directory/'native/sanitize.jsonl').read_bytes()
    allocations=[json.loads(row) for row in (directory/'native/allocations.jsonl').read_text().splitlines()]
    assert allocations[-1]['faults']==allocations[-1]['recoveries']==165 and allocations[-1]['callerMutation'] and not allocations[-1]['partialResults']
    assert sum(r['kind'] in ['upstream-fault','calloc-fault'] for r in allocations)==165
    assert sum(r['kind']=='caller-custody' for r in allocations)==5
    assert coverage['gitHead']==head and coverage['positive'] and coverage['nativePositive'] and not coverage['zero'] and not coverage['nativeZero']
    auth=load('native/predecessor/authentication.json')
    assert auth['status']=='passed' and auth['predecessor']==BASE and auth['reopenedMembers']==91389
    assert not git('diff','--name-only',BASE,head,'--','renderer/virgl-command','crates','web','tools/guest')
    frames={}
    for file in (directory/'stack').glob('*.su'):
        for line in file.read_text().splitlines():
            fields=line.split('\t');frames[fields[0].rsplit(':',1)[-1]]=int(fields[1])
    stack={}
    for mode in ['stage','pair']:
        names=['bridge_translate_standard_instance_base'+('_pair' if mode=='pair' else ''),'standard_'+mode,'standard_convert','vrend_convert_shader','standard_emit']
        assert all(name in frames for name in names)
        observed={name:frames[name] for name in names}
        observed['selectedFrameSumBytes']=sum(observed.values())
        assert observed['selectedFrameSumBytes']<262144
        stack[mode]=observed
    sources,generated={},{}
    roots=['renderer/virgl-shader','tools/virgl-instance-base','tools/verify-virgl-instance-base.sh',
           'tools/virgl-integer-image-shader','tools/virgl-standard-texture','tools/virgl-standard-uniform',
           'tools/lib/virgl-browser-runner.mjs','tools/virgl-original-corpus/toolchain.py',
           'tools/virgl-original-corpus/shared.py','tools/setup-virgl-emsdk.sh',
           'tools/virgl-floating-depth/primary/es-3.0.6.pdf','web/package.json','web/package-lock.json','Makefile',
           'tasks/epic-6-transcendence/E6-T11d46-instance-base-compiler.md',
           'evidence/virgl-production-readiness/standard-texture-operation-gap.json',
           'evidence/virgl-production-readiness/standard-integer-image-shader-gap.json',
           'evidence/virgl-production-readiness/standard-instance-base-gap.json']
    for name in git('ls-files',*roots).splitlines():
        raw=(ROOT/name).read_bytes()
        assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT)
        sources[name]=sha(raw)
    for name in ['hardware','fault-wrong-offset']:
        report=load(name+'/report.json')
        assert report['gitHead']==head and report['task']==TASK and not report['trackedChanges']
        assert report['browserErrors']==dict(console=[],page=[],requests=[])
        assert report['status']==('failed' if name.startswith('fault-') else 'passed')
        assert not report['browser']['launch']['headless']
        assert report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']]=='enabled'
        for item in report['sources']+report['servedFiles']:
            raw=(ROOT/item['path']).read_bytes()
            assert len(raw)==item['size'] and sha(raw)==item['sha256'],'browser source drift '+item['path']
            if '/build/' in item['path'] or item['path'].startswith('target/'):
                generated[item['path']]=sha(raw)
            else:
                assert raw==subprocess.check_output(['git','show',head+':'+item['path']],cwd=ROOT)
                sources[item['path']]=sha(raw)
        shot=report.get('screenshot',report.get('failureScreenshot'))
        assert shot and sha((directory/name/shot['path']).read_bytes())==shot['sha256']
    for mode,binary in [('native','standard-instance-base-test'),('sanitize','standard-instance-base-test'),('allocation-sanitize','standard-instance-base-allocation-test')]:
        name='renderer/virgl-shader/build/standard-instance-base-'+mode+'/'+binary
        generated[name]=sha((ROOT/name).read_bytes())
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    receipt=dict(schema='original-instance-base-receipt-v1',task=TASK,status='passed',gitHead=head,predecessor=BASE,
                 physical=physical,compiler=audit,facadeChecks=len(facade['rejections']),historical=facade['historical'],
                 allocations=allocations[-1],coverage=dict(javascript=coverage['positive'],native=coverage['nativePositive'],zero=[],nativeZero=[]),
                 stack=stack,sources=sources,generated=generated,files=files,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(CONFIRMATION.decode(),end='')


if __name__=='__main__':main(sys.argv[1])
