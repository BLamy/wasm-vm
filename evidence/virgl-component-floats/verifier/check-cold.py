"""Verify the final pristine-clone copy and surviving checkout without rerunning it."""
import hashlib,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3]
V=pathlib.Path(__file__).resolve().parent
C=ROOT/'evidence/virgl-component-floats/cold-clone'
H='6a8d3841e18379d665af4c7d8f9449322529636f'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
r=json.loads((C/'report.json').read_text())
assert r['status']=='passed' and r['exitCode']==0
assert r['gitHead']==r['cloneHead']==r['cloneHeadAfter']==H
assert r['statusBefore']==r['statusAfter']==''
assert r['command']==['make','verify-E6-T12e5']
assert sha(C/'cold.log')==r['logSha256']
assert sha(C/'acceptance/receipt.json')==r['receiptSha256']
assert sha(ROOT/'tools/virgl-component-floats/cold.py')==r['harnessSha256']
assert hashlib.sha256(subprocess.check_output(['git','show',H+':tools/virgl-component-floats/cold.py'],cwd=ROOT)).hexdigest()==r['harnessSha256']
clone=pathlib.Path(r['clone'])
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone).decode().strip()==H
assert subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone).decode()==''
for e in r['acceptanceFiles']:
 p=C/e['path']; assert p.stat().st_size==e['bytes'] and sha(p)==e['sha256']
 original=clone/'target/evidence/virgl-component-floats-cold'/pathlib.Path(e['path']).relative_to('acceptance')
 assert p.read_bytes()==original.read_bytes()
assert len(r['acceptanceFiles'])==179
postfreeze=subprocess.check_output(['git','diff','--name-only',H,'HEAD'],cwd=ROOT).decode().splitlines()
assert all(p.startswith('evidence/virgl-component-floats/') or p in ['tasks/QUEUE.md','tasks/epic-6-transcendence/E6-T12e5-component-float.md'] for p in postfreeze)
result={'status':'passed','head':H,'workerSubmissionHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT).decode().strip(),'coldReportSha256':sha(C/'report.json'),'coldLogSha256':sha(C/'cold.log'),'receiptSha256':r['receiptSha256'],'harnessSha256':r['harnessSha256'],'copiedRecordsVerified':179,'copyMatchesClone':True,'cloneStillPristine':True,'postFreezeOnlyEvidenceAndLifecycle':True,'removedEnvironmentNames':r['removedEnvironmentNames'],'scrubAudit':'cold.py removes compiler, Cargo/Rust, Node/Python, Emscripten, graphics/harness, Git and shell-injection overrides before clone and acceptance; the two listed names were present, other named overrides absent.'}
(V/'cold-binding.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
