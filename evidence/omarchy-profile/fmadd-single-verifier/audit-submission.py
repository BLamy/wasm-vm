#!/usr/bin/env python3
"""Rehash the final worker submission and its committed exact source closure."""
from pathlib import Path
import hashlib
import json
import subprocess

repo=Path(__file__).resolve().parents[3];out=Path(__file__).resolve().parent
worker=repo/'evidence/omarchy-profile/fmadd-single-r1'
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=repo)
head=git('rev-parse','1479a263').decode().strip()
index=worker/'sha256.txt'
assert sha(index.read_bytes())=='656107deda13733b1d493aa30b9c5d955145d7e1aa257e3fc8702f897c0db0a6'
assert index.read_bytes()==git('show',head+':'+str(index.relative_to(repo)))
rows=[]
for line in index.read_text().splitlines():
    digest,path=line.split('  ',1)
    p=worker/path
    assert p.resolve().is_relative_to(worker.resolve()),path
    data=p.read_bytes()
    assert sha(data)==digest,path
    assert data==git('show',head+':'+str(p.relative_to(repo))),path
    rows.append({'path':str(p.relative_to(repo)),'sha256':digest,'bytes':len(data)})
assert len(rows)==83 and len({r['path'] for r in rows})==83
frozen=json.loads((worker/'frozen.json').read_text())
for row in frozen['files']+frozen['artifacts']:
    assert sha((repo/row['path']).read_bytes())==row['sha256'],row['path']
    assert sha(git('show',head+':'+row['path']))==row['sha256'],row['path']
submission=json.loads((worker/'submission.json').read_text())
assert submission['runtimeSourceHead']==frozen['head']
assert submission['runtimeWasmSha256']==frozen['wasmSha256']
assert all(submission[k] for k in ['focusedAcceptancePassed','coldClonePassed','publicBytesMatched'])
assert submission['desktopResponsive'] is False and submission['broadCiPassed'] is False
assert submission['completedTests']['acceptance']==dict(targets=6,passed=18,failed=0,ignored=0)
changed=git('diff','--name-only','c531ceffb9b7adc8de9f5ebc927d00076a26f1dd',head).decode().splitlines()
assert all(p.startswith('evidence/omarchy-profile/fmadd-single-r1/') or
           p in ['tasks/QUEUE.md','tasks/epic-5.5-omarchy/E5.5-T03an-jit-fmadd-single.md']
           for p in changed),changed
task=git('show',head+':tasks/epic-5.5-omarchy/E5.5-T03an-jit-fmadd-single.md').decode()
assert '\nstatus: implemented\n' in task
assert 'browser-close' in task and 'successful bounded owned-process cleanup' in task
assert 'negative' in task and 'exit 2' in task
receipt={'passed':True,'submissionCommit':head,'indexSha256':sha(index.read_bytes()),
         'files':rows,'frozenSourceClosureUnchanged':True,'sourceHead':frozen['head'],
         'artifactAndColdHead':submission['coldHead'],'runtimeWasmSha256':frozen['wasmSha256'],
         'postColdChangesOnlyEvidenceAndTaskAdministration':changed,
         'completedAcceptanceTests':submission['completedTests']['acceptance'],
         'desktopResponsive':False,'broadCiPassed':False}
(out/'submission-inspection.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:v for k,v in receipt.items() if k not in ['files','postColdChangesOnlyEvidenceAndTaskAdministration']},indent=2))
