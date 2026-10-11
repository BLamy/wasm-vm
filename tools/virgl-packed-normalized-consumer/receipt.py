#!/usr/bin/env python3
"""Authenticate complete frozen original packed command/native evidence."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
from predecessor import BASE
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()

def main(directory):
    directory=Path(directory).resolve();head=git('rev-parse','HEAD');assert not git('diff','--name-only','HEAD')
    for _ in range(500):
        if b'\nPACKED_NORMALIZED_CONSUMER_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete exact-head command recording')
    load=lambda name:json.loads((directory/name).read_text());names=['wire','hardware-targets','hardware-samples','historical'];audits={}
    targets=load('hardware-targets/pixel-audit.json');samples=load('hardware-samples/sample-audit.json')
    assert targets['status']==samples['status']=='passed' and not targets['differences'] and not samples['differences']
    assert targets['counts']['frames']==724 and targets['counts']['targets']==2740 and samples['counts']['runs']==104
    assert len(load('wire/report.json')['wire']['records'])==51
    audits.update(targets=targets,samples=samples)
    for seed in [362514859,2882400001,1629686191]:
        for kind,audit in [('target','boundary'),('sample','sample')]:
            name=f'{kind}-boundary-{seed}';result=load(name+'/'+audit+'-audit.json');assert result['status']=='passed';names.append(name);audits[name]=result
            report=load(name+'/report.json')['browserResult']['result'];assert report['seed']==seed
            assert result['counts']['frames']==(19 if kind=='target' else 98)
    for fault in ['nonzero-attachment','completed-output','sample-plane']:
        name='fault-'+fault;result=load(name+('/sample-audit.json' if fault=='sample-plane' else '/pixel-audit.json'))
        assert result['status']=='refuted' and result['differences'] and result['expectedPhysicalControl'];names.append(name);audits[name]=result
    assert load('historical/pixel-audit.json')['status']=='passed'
    coverage=load('coverage-audit.json');assert coverage['gitHead']==head and coverage['positive'] and not coverage['zero']
    predecessor=load('predecessor/authentication.json');assert predecessor['status']=='passed' and predecessor['predecessor']==BASE and sum(r['members'] for r in predecessor['seals'])==42989
    assert not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','renderer/virgl-command/resources.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/packed-normalized-images.mjs','crates','web','tools/guest')
    roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-command','tools/virgl-packed-normalized-consumer','tools/virgl-multiple-color',
        'tools/verify-virgl-standard-packed-normalized-consumer.mjs','tools/verify-virgl-standard-packed-normalized-consumer.sh',
        'web/package.json','web/package-lock.json','Makefile','tools/check_task_policy.py','AGENTS.md',
        'tasks/epic-6-transcendence/E6-T11d36-standard-packed-normalized-consumer.md',
        'evidence/virgl-production-readiness/standard-packed-normalized-consumer-gap.mjs',
        'evidence/virgl-production-readiness/standard-packed-normalized-consumer-gap.json']
    sources={};generated={}
    for name in git('ls-files',*roots).splitlines():
        raw=(ROOT/name).read_bytes();assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT);sources[name]=sha(raw)
    for name in names:
        report=load(name+'/report.json');assert report['gitHead']==head and report['status']==('failed' if name.startswith('fault-') else 'passed')
        assert report['browserErrors']==dict(console=[],page=[],requests=[])
        if name!='wire':assert report['browser']['headless'] is False and 'Metal' in (report.get('partial') or report['browserResult']['result'])['gpu']
        for item in report['sources']:
            raw=(ROOT/item['path']).read_bytes();assert sha(raw)==item['sha256'],'exact source drift '+item['path']
            if '/build/' in item['path']:generated[item['path']]=item['sha256']
            else:
                assert raw==subprocess.check_output(['git','show',head+':'+item['path']],cwd=ROOT);sources[item['path']]=item['sha256']
    assert generated==predecessor['generated'],'held generated C/Wasm binaries must be exact'
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    result=dict(schema='original-packed-normalized-consumer-receipt-v1',task='E6-T11d36',status='passed',gitHead=head,predecessor=BASE,
        audits=audits,dependency=predecessor,coverage=dict(javascript=coverage['positive'],waived=len(coverage['waived']),zero=[]),sources=sources,generated=generated,files=files,
        guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print('Frozen original packed normalized consumer packets and native words authenticated.')

if __name__=='__main__':main(sys.argv[1])
