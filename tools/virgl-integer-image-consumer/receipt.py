#!/usr/bin/env python3
"""Authenticate the frozen original contract, packet, physical and dependency closure."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
ROOT=Path(__file__).resolve().parents[2]
BASE='c64c3325c15d8978f455d57fc103559eec1b9d20'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()


def main(directory):
    directory=Path(directory).resolve();head=git('rev-parse','HEAD')
    assert not git('diff','--name-only','HEAD'),'freeze all tracked sources before recording'
    for _ in range(500):
        if b'\nINTEGER_IMAGE_CONSUMER_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete final command recording')
    load=lambda name:json.loads((directory/name).read_text())
    physical=load('physical-audit.json')
    assert physical['status']=='passed' and len(physical['records'])==7
    assert physical['records'][0]['frames']==1773 and not physical['records'][0]['mismatches']
    assert all(r['status']=='passed' and not r['mismatches'] for r in physical['records'][:4])
    assert all(r['status']=='refuted' and any(m['kind']=='output' for m in r['mismatches']) for r in physical['records'][4:])
    contract=load('node/report.json')['contract'];browser_contract=load('contracts/report.json')['browserResult']['result']
    assert contract['status']==browser_contract['status']=='passed' and contract['cases']==browser_contract['cases']==2586
    assert contract['getters']==browser_contract['getters']==0
    assert contract['historical']==browser_contract['historical'],'whole historical normalizers agree across actual Node/browser'
    coverage=load('coverage-audit.json')
    assert coverage['gitHead']==head and coverage['positive'] and not coverage['zero'],'every smallest changed-runtime V8 partition must be proven or explicitly waived'
    dependency=load('predecessor/authentication.json')
    assert dependency['status']=='passed' and dependency['predecessor']==BASE
    assert not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','renderer/virgl-command/resources.mjs','crates','web','tools/guest'),'compiler/storage/guest/demo unchanged'
    sources,generated={},{}
    roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-command','tools/virgl-integer-image-consumer',
           'tools/virgl-integer-image-shader','tools/virgl-standard-texture','tools/virgl-standard-uniform',
           'tools/verify-virgl-standard-integer-image-consumer.mjs','tools/verify-virgl-standard-integer-image-consumer.sh',
           'tools/verify-virgl-standard-float-consumer.mjs','tools/lib/virgl-browser-runner.mjs',
           'web/package.json','web/package-lock.json','Makefile','tools/check_task_policy.py','AGENTS.md',
           'tasks/epic-6-transcendence/E6-T11d33-standard-integer-image-consumer.md',
           'evidence/virgl-production-readiness/standard-integer-image-consumer-gap.mjs',
           'evidence/virgl-production-readiness/standard-integer-image-consumer-gap.json']
    for name in git('ls-files',*roots).splitlines():
        raw=(ROOT/name).read_bytes();assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT)
        sources[name]=sha(raw)
    names=['node','contracts','hardware','boundary-1030219','boundary-2882400001','boundary-1629686191',
           'fault-original-level','fault-original-words','fault-completed-output','historical-float']
    for name in names:
        report=load(name+'/report.json');assert report['gitHead']==head
        assert report['status']==('failed' if name.startswith('fault-') else 'passed')
        assert report['browserErrors']==dict(console=[],page=[],requests=[])
        for item in report['sources']:
            raw=(ROOT/item['path']).read_bytes();assert sha(raw)==item['sha256'],'exact source drift '+item['path']
            if item['path'] in sources:assert sources[item['path']]==item['sha256']
            else:
                assert '/build/' in item['path'] or item['path'].startswith('target/'),'unsealed untracked executable source'
                generated[item['path']]=item['sha256']
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    result=dict(schema='original-integer-image-consumer-receipt-v1',task='E6-T11d33',status='passed',gitHead=head,predecessor=BASE,
                physical=physical,contract=dict(cases=contract['cases'],accepted=contract['accepted'],attacks=len(contract['attacks']),getters=contract['getters']),
                dependency=dependency,coverage=dict(javascript=coverage['positive'],waived=len(coverage['waived']),zero=[]),sources=sources,generated=generated,files=files,
                guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Frozen original integer image consumer contracts, packets and native words authenticated.')
if __name__=='__main__':main(sys.argv[1])
