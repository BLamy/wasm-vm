#!/usr/bin/env python3
"""Inspect final task evidence and source identity without rerunning any guest."""
from pathlib import Path
import hashlib,json,os,subprocess
from datetime import datetime,timezone

OUT=Path(__file__).resolve().parent
REPO=OUT.parents[2]
BASE=REPO/'evidence/omarchy-profile'
GATES=BASE/'worker-cost-gates-r2'
EXPECTED='dc0366bc3a2e2b4d7279ad82f299bfc0b6deeee56e987726f286b6065d20c2ae'
sha=lambda data:hashlib.sha256(data).hexdigest()
read=lambda p:json.loads(p.read_text())
index=GATES/'sha256.txt';index_bytes=index.read_bytes()
assert sha(index_bytes)==EXPECTED
rows=[]
for line in index_bytes.decode().splitlines():
    digest,filename=line.split('  ',1)
    data=(BASE/filename).read_bytes()
    assert sha(data)==digest,filename
    rows.append({'path':filename,'sha256':digest,'bytes':len(data)})
assert len(rows)==25
preserved=read(GATES/'r1-preserved.json')
for row in preserved['files']:
    assert sha((BASE/row['path']).read_bytes())==row['sha256'],row['path']
assert len(preserved['files'])==30
frozen=read(GATES/'frozen.json');commands=read(GATES/'commands.json');submission=read(GATES/'submission.json')
run=read(BASE/'worker-cost-r2/run.json');report=read(BASE/'worker-cost-r2/desktop/report.json')
assert frozen['head']==commands['head']==submission['recordingHead']==run['head']==report['trial']['head']=='8ad5886126ddf062403455e266471d83e0e7feee'
assert commands['allPassed'] and all(c['code']==0 for c in commands['commands'])
for row in frozen['files']:
    assert sha((REPO/row['path']).read_bytes())==row['sha256'],row['path']
assert submission['desktopResponsive'] is False and submission['noPostVerdictIngress'] is True
assert submission['r1Protocol']=='refuted'
assert submission['reportSha256']=='41102dded7b6d44f18318381351e2d7280ca47983d1af1debd9bd621532c2555'
assert submission['profileSha256']=='a6e8f0c8189b783efc4e293f6001df4d9e559e3ca814bd5097ae394b781146b2'
env={**os.environ,'DEVELOPER_DIR':'/Library/Developer/CommandLineTools'}
for scope in [['crates','web','Cargo.toml','Cargo.lock'],['tools/verify/omarchy-desktop-live.mjs','tools/verify/omarchy-worker-cost.mjs','tools/verify/omarchy-worker-cost-capture.mjs','tools/verify/e5-t22c-cpu-profile.mjs','tools/verify/e5-t22c-symbolize-cpu.mjs']]:
    diff=subprocess.check_output(['git','diff','--name-only',frozen['head'],'--',*scope],cwd=REPO,env=env).decode()
    assert not diff.strip(),diff
result={'checkedAt':datetime.now(timezone.utc).isoformat(),'recordingHead':frozen['head'],'checkedHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,env=env).decode().strip(),'indexSha256':EXPECTED,'sealedFiles':rows,'preservedR1Files':30,'sourcePins':len(frozen['files']),'actualRunAndSubmissionIdentitiesMatch':True,'desktopResponsive':False,'verifiableScope':'Corrected post-verdict CPU diagnostic only.'}
(OUT/'seal-inspection.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'sealedFiles':len(rows),'preservedR1Files':30,'indexSha256':EXPECTED,'recordingHead':frozen['head'],'desktopResponsive':False},indent=2))
