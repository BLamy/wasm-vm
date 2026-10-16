#!/usr/bin/env python3
"""Authenticate the frozen original four-color packet/native/dependency closure."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];BASE='1206a5beb3026de10457cd395d249daf8aff9966'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()

def main(directory):
    directory=Path(directory).resolve();head=git('rev-parse','HEAD')
    assert not git('diff','--name-only','HEAD'),'freeze all tracked sources before recording'
    for _ in range(500):
        if b'\nMULTIPLE_COLOR_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete final command recording')
    load=lambda name:json.loads((directory/name).read_text())
    physical=load('hardware/pixel-audit.json');hardware=load('hardware/report.json')['browserResult']['result']
    assert physical['status']=='passed' and not physical['differences'] and len(hardware['runs'])==326
    assert physical['counts']['frames']==1304 and physical['counts']['nativeDrawStates']==652
    assert hardware['host']['drawBuffers']>=4 and hardware['host']['colorAttachments']>=4 and hardware['host']['indexed']
    assert 'Metal' in hardware['gpu'] and not any(name in hardware['gpu'].lower() for name in ['swiftshader','llvmpipe','softpipe','lavapipe'])
    boundaries=[]
    for seed in [1030219,2882400001,1629686191]:
        result=load(f'boundary-{seed}/boundary-audit.json');assert result['status']=='passed' and result['seed']==seed
        assert result['counts']['frames']==19 and result['counts']['retiredTargets']==8
        boundaries.append(result)
    controls=[]
    for fault in ['nonzero-attachment','completed-output']:
        result=load(f'fault-{fault}/pixel-audit.json');assert result['status']=='refuted' and result['expectedPhysicalControl']
        assert any(d['kind']=='native' and d['slot']==3 for d in result['differences']);controls.append(result)
    contract=load('node/report.json')['contract'];browser_contract=load('contracts/report.json')['browserResult']['result']
    assert contract['status']==browser_contract['status']=='passed' and contract['cases']==browser_contract['cases']==2586
    assert contract['getters']==browser_contract['getters']==0 and len(contract['attacks'])==len(browser_contract['attacks'])==161
    assert contract['historical']==browser_contract['historical'],'whole historical responses agree across actual Node/browser'
    assert contract['records']==browser_contract['records'] and contract['attacks']==browser_contract['attacks']
    historical=load('historical-integer/report.json');assert historical['contract']['status']=='passed' and historical['wire']['status']=='passed'
    coverage=load('coverage-audit.json');assert coverage['gitHead']==head and coverage['positive'] and not coverage['zero']
    dependency=load('predecessor/authentication.json');assert dependency['status']=='passed' and dependency['predecessor']==BASE
    assert sum(seal['members'] for seal in dependency['seals'])==161233
    assert not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','renderer/virgl-command/resources.mjs','crates','web','tools/guest')
    sources,generated={},{}
    roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-command','tools/virgl-multiple-color',
           'tools/virgl-integer-image-consumer','tools/virgl-integer-image-shader','tools/virgl-standard-texture',
           'tools/verify-virgl-standard-multiple-color.mjs','tools/verify-virgl-standard-multiple-color.sh',
           'tools/verify-virgl-standard-integer-image-consumer.mjs','tools/verify-virgl-standard-float-consumer.mjs',
           'web/package.json','web/package-lock.json','Makefile','tools/check_task_policy.py','AGENTS.md',
           'tasks/epic-6-transcendence/E6-T11d34-standard-multiple-color.md',
           'evidence/virgl-production-readiness/standard-multiple-color-gap.mjs',
           'evidence/virgl-production-readiness/standard-multiple-color-gap.json']
    for name in git('ls-files',*roots).splitlines():
        raw=(ROOT/name).read_bytes();assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT);sources[name]=sha(raw)
    names=['node','historical-integer','historical-integer-native','contracts','hardware','critic','boundary-1030219','boundary-2882400001','boundary-1629686191',
           'fault-nonzero-attachment','fault-completed-output','historical-float','historical-blend']
    for name in names:
        report=load(name+'/report.json');assert report['gitHead']==head
        assert report['status']==('failed' if name.startswith('fault-') else 'passed')
        assert report['browserErrors']==dict(console=[],page=[],requests=[])
        for item in report['sources']:
            raw=(ROOT/item['path']).read_bytes();assert sha(raw)==item['sha256'],'exact source drift '+item['path']
            if '/build/' in item['path'] or item['path'].startswith('target/'):
                generated[item['path']]=item['sha256']
            else:
                assert raw==subprocess.check_output(['git','show',head+':'+item['path']],cwd=ROOT)
                if item['path'] in sources:assert sources[item['path']]==item['sha256']
                sources[item['path']]=item['sha256']
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    result=dict(schema='original-multiple-color-receipt-v1',task='E6-T11d34',status='passed',gitHead=head,predecessor=BASE,
                physical=physical,boundaries=boundaries,controls=controls,contract=dict(cases=contract['cases'],accepted=contract['accepted'],attacks=len(contract['attacks']),getters=0),
                dependency=dependency,coverage=dict(javascript=coverage['positive'],waived=len(coverage['waived']),zero=[]),sources=sources,generated=generated,files=files,
                guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Frozen original multiple color attachment contracts, packets and native words authenticated.')
if __name__=='__main__':main(sys.argv[1])
