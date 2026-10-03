"""Check pristine-clone identity, every copied record, and worker claim provenance."""
import hashlib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent;base=root/'evidence/virgl-bounded-loops/cold-clone';report=json.loads((base/'report.json').read_text());head='bfcd3a4076a163648c67bf7674e94d616c42c1e1';claim='9e647be3c69fe4bfd3706ba198cd1630cd454400';clone=pathlib.Path(report['clone']);original=clone/'target/evidence/virgl-bounded-loops-cold'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert report['status']=='passed' and report['gitHead']==report['cloneHead']==report['cloneHeadAfter']==head
assert report['statusBefore']==report['statusAfter']=='' and type(report['exitCode']) is int and report['exitCode']==0
assert report['command']==['make','verify-E6-T12e9']
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==head
assert subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone,text=True)==''
assert sha((root/'tools/virgl-bounded-loops/cold.py').read_bytes())==report['harnessSha256']
assert sha((base/'cold.log').read_bytes())==report['logSha256']
paths=[]
for item in report['acceptanceFiles']:
 p=base/item['path'];raw=p.read_bytes();assert type(item['bytes']) is int and len(raw)==item['bytes'] and sha(raw)==item['sha256']
 relative=p.relative_to(base/'acceptance');assert raw==(original/relative).read_bytes();paths.append(item['path'])
assert len(paths)==178 and paths==[str(p.relative_to(base)) for p in sorted((base/'acceptance').rglob('*')) if p.is_file()]
receipt=(base/'acceptance/receipt.json').read_bytes();assert sha(receipt)==report['receiptSha256']
claim_path='tasks/epic-6-transcendence/E6-T12e9-bounded-loops.md';task=subprocess.check_output(['git','show',claim+':'+claim_path],cwd=root);assert b'status: implemented' in task and head.encode() in task and report['receiptSha256'].encode() in task
result={'task':'E6-T12e9','sourceHead':head,'workerClaimCommit':claim,'workerClaimSha256':sha(task),'coldReportSha256':sha((base/'report.json').read_bytes()),'coldReceiptSha256':sha(receipt),'copiedArtifactsVerified':len(paths),'copiedArtifactsEqualPreservedClone':True,'cleanBeforeAndAfterAndNow':True,'removedEnvironmentNames':report['removedEnvironmentNames'],'harnessSha256':report['harnessSha256'],'logSha256':report['logSha256']}
(out/'cold-bindings.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
