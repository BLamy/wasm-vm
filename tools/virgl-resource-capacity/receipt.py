#!/usr/bin/env python3
"""Bind exact-head recordings and unchanged qualified dependency digests."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
BASE='e1066c663b64df546f9644f1a25508b4e71db636'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()


def main(directory):
    directory=Path(directory).resolve();head=git('rev-parse','HEAD')
    assert not git('diff','--name-only','HEAD'),'freeze tracked source before recording'
    for _ in range(500):
        if b'RESOURCE_CAPACITY_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('final recording incomplete')
    values=json.loads((directory/'values-audit.json').read_text());coverage=json.loads((directory/'coverage-audit.json').read_text())
    assert values['status']=='passed' and values['gitHead']==coverage['gitHead']==head and not coverage['zero']
    assert not git('diff','--name-only',BASE,head,'--','crates','web','renderer/virgl-shader','tools/guest')
    runtime=git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines()
    assert {p for p in runtime if '/tests/' not in p}=={'renderer/virgl-command/resources.mjs'}
    sources={};carried={}
    for report_path in directory.glob('*/report.json'):
        report=json.loads(report_path.read_text())
        for entry in report.get('sources',[]):
            raw=(ROOT/entry['path']).read_bytes();assert sha(raw)==entry['sha256'];sources[entry['path']]=sha(raw)
    roots=['tools/virgl-resource-capacity','tools/verify-virgl-resource-capacity.mjs','tools/verify-virgl-resource-capacity.sh','renderer/virgl-command/tests/standard-resource-capacity.mjs','Makefile','AGENTS.md','web/package.json','web/package-lock.json','tools/check_task_policy.py','tasks/epic-6-transcendence/E6-T11d50-resource-capacity.md','evidence/virgl-production-readiness/standard-resource-capacity-gap.mjs','evidence/virgl-production-readiness/standard-resource-capacity-gap.json']
    for name in git('ls-files',*roots).splitlines():
        raw=(ROOT/name).read_bytes();assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT);sources[name]=sha(raw)
    for name in git('ls-files','renderer/virgl-shader','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs').splitlines():
        raw=(ROOT/name).read_bytes();assert raw==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT);carried[name]=sha(raw)
    dependencies={}
    for role in ['worker','verifier']:
        for leaf in ['manifest.json','records.json']:
            name='evidence/virgl-shadow-samplers/'+role+'/'+leaf;raw=(ROOT/name).read_bytes()
            assert raw==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT)
            dependencies[name]=sha(raw);sources[name]=sha(raw)
    generated={
        'renderer/virgl-shader/build/wasm/virgl-shader.mjs':'4da9f1ed30cff697193e0688a26ee93e48a3e1216485d5184301fec6c31d4879',
        'renderer/virgl-shader/build/wasm/virgl-shader.wasm':'aba0c891ad406ef876da6f1a86883b3fcdd98de12c1137a4f2feff566f5459f2',
    }
    index=json.loads((ROOT/'evidence/virgl-shadow-samplers/worker/records.json').read_text())
    previous={r['path']:r for r in index['records']}
    for name,digest in generated.items():
        assert previous['hot-generated/'+name]['sha256']==digest and previous['cold-generated/'+name]['sha256']==digest
        if (ROOT/name).exists():assert sha((ROOT/name).read_bytes())==digest
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    # Nested inherited receipts are evidence bodies, not this receipt's output.
    inherited=directory/'inherited-resources/receipt.json';files[inherited.relative_to(directory).as_posix()]=sha(inherited.read_bytes())
    receipt=dict(schema='resource-capacity-receipt-v1',task='E6-T11d50',status='passed',gitHead=head,predecessor=BASE,sources=sources,carriedSources=carried,carriedGenerated=generated,dependencyIndexes=dependencies,files=files,counts=values['counts'],guestExecution=False,productionAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print('Frozen original resource counts, native bytes and complete source/evidence closure authenticated.')


if __name__=='__main__':main(sys.argv[1])
