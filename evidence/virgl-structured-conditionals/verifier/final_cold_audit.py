#!/usr/bin/env python3
"""Independent final exact-source clone, file-digest and complete receipt audit."""
import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent
HEAD='e0bdfe31f959547a1794de5027187ef29abe3d42';RUNTIME='242ad5705dbdfd07b269c3e5850857c893af41e7';COLD=ROOT/'evidence/virgl-structured-conditionals/cold-clone'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def exact(a,b):return json.dumps(a,sort_keys=True,separators=(',',':'),allow_nan=False)==json.dumps(b,sort_keys=True,separators=(',',':'),allow_nan=False)
def git(*args,cwd=ROOT):return subprocess.check_output(['git',*args],cwd=cwd,text=True).strip()
report=json.loads((COLD/'report.json').read_bytes());assert report['status']=='passed' and report['gitHead']==HEAD and report['cloneHead']==HEAD and report['cloneHeadAfter']==HEAD and report['exitCode']==0
assert report['statusBefore']==report['statusAfter']=='' and report['command']==['make','verify-E6-T12e7']
clone=Path(report['clone']).resolve();assert git('rev-parse','HEAD',cwd=clone)==HEAD;assert git('status','--porcelain','--untracked-files=all',cwd=clone)==''
assert report['logSha256']==sha(COLD/'cold.log');assert report['receiptSha256']==sha(COLD/'acceptance/receipt.json')
paths=[]
for item in report['acceptanceFiles']:
 p=COLD/item['path'];assert p.resolve().is_relative_to(COLD.resolve());assert p.stat().st_size==item['bytes'] and sha(p)==item['sha256'];paths.append(item['path'])
assert len(set(paths))==len(paths)
assert paths==[str(p.relative_to(COLD)) for p in sorted((COLD/'acceptance').rglob('*')) if p.is_file()]
recorded=json.loads((COLD/'acceptance/receipt.json').read_bytes());assert recorded['gitHead']==HEAD and recorded['status']=='passed' and recorded['task']=='E6-T12e7' and recorded['guestExecution']is False
clone_evidence=clone/'target/evidence/virgl-structured-conditionals-cold';assert sha(clone_evidence/'receipt.json')==sha(COLD/'acceptance/receipt.json')
for item in report['acceptanceFiles']:
 other=clone_evidence/Path(item['path']).relative_to('acceptance');assert other.stat().st_size==item['bytes'] and sha(other)==item['sha256']
allowed={f'tools/virgl-structured-conditionals/{name}.py' for name in ('browser_receipt','consumer_compat','faults','native_receipt','profiles_receipt','wasm_receipt')}
assert set(git('diff','--name-only',RUNTIME,HEAD).splitlines())==allowed
independent=json.loads((OUT/'independent-summary.json').read_bytes())
for item in independent['sources']:assert sha(ROOT/item['path'])==item['sha256'] and (clone/item['path']).read_bytes()==(ROOT/item['path']).read_bytes()
helper_audit=json.loads((OUT/'repaired-receipt-results.json').read_bytes())
for name,value in helper_audit['receiptHelpersSha256'].items():assert sha(clone/'tools/virgl-structured-conditionals'/name)==value
# Import verifier modules in their preserved clone, with its actual native/Wasm
# binaries, tool paths and fault-artifact command transcripts. Never substitute
# root bindings for an independently produced clone record.
code="""import json,sys\nfrom pathlib import Path\nsys.path.insert(0,str(Path('tools/virgl-structured-conditionals').resolve()))\nimport receipt\nhead=sys.argv[1];directory=Path('target/evidence/virgl-structured-conditionals-cold').resolve()\nactual=receipt.verify(directory,head);saved=json.loads((directory/'receipt.json').read_bytes())\ncanonical=lambda x:json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)\nassert canonical(actual)==canonical(saved),'complete recomputed receipt changed'\nprint(json.dumps({'status':'passed','sourceRoot':str(receipt.ROOT),'head':head,'sources':len(actual['sources']),'records':len(actual['records']),'nativeCalls':actual['native']['stats']['calls'],'wasmCalls':actual['wasm']['counts']['calls'],'browserModes':actual['browser']['modes']}))\n"""
command=['python3','-c',code,HEAD];run=subprocess.run(command,cwd=clone,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True);recomputed=json.loads(run.stdout);assert run.stderr=='' and recomputed['sourceRoot']==str(clone)
assert git('status','--porcelain','--untracked-files=all',cwd=clone)==''
result={'status':'passed','sourceHead':HEAD,'runtimeHead':RUNTIME,'boundary':'Original runtime and independent semantic attacks carried forward unchanged; all six repaired receipt helpers match frozen source. Final clone records are primary. Warm records remain historical and are not relabeled.','coldReportSha256':sha(COLD/'report.json'),'coldReceiptSha256':sha(COLD/'acceptance/receipt.json'),'coldLogSha256':sha(COLD/'cold.log'),'coldClone':str(clone),'coldCheckoutClean':True,'acceptanceFileCount':len(paths),'acceptanceBytes':sum(x['bytes'] for x in report['acceptanceFiles']),'allFileBindingsChecked':True,'cloneCopiesMatch':True,'sourceContinuity':sorted(allowed),'recomputedReceipt':recomputed,'recomputeCommand':command,'receiptSourceHead':helper_audit['receiptSourceHead'],'typedControls':helper_audit['passed']+len(json.loads((OUT/'final-coverage-type-results.json').read_bytes())['results']),'independentRuntimeCases':independent['cases'],'production':recorded['production']}
(OUT/'final-cold-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ('sourceContinuity','recomputeCommand','recomputedReceipt','production')}))
