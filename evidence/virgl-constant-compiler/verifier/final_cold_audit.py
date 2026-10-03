#!/usr/bin/env python3
"""Fresh verifier replay of final exact-head cold receipt and every copied byte."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent
DIRECTORY=ROOT/'evidence/virgl-constant-compiler/cold-clone';HEAD='d3565d11c2133aacbaa628ffa82342b5d308ab10'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
report=json.loads((DIRECTORY/'report.json').read_bytes());clone=Path(report['clone']);original=clone/'target/evidence/virgl-constant-compiler-cold'
assert report['status']=='passed' and report['exitCode']==0 and report['gitHead']==report['cloneHead']==report['cloneHeadAfter']==HEAD
assert report['statusBefore']==report['statusAfter']=='' and report['command']==['make','verify-E6-T12e6b']
assert sha((DIRECTORY/'cold.log').read_bytes())==report['logSha256']
assert sha((clone/'tools/virgl-constant-compiler/cold.py').read_bytes())==report['harnessSha256']
assert (DIRECTORY/'acceptance/receipt.json').read_bytes()==(original/'receipt.json').read_bytes()
assert sha((DIRECTORY/'acceptance/receipt.json').read_bytes())==report['receiptSha256']
actual_files=[]
for path in sorted((DIRECTORY/'acceptance').rglob('*')):
 if path.is_file():actual_files.append({'path':str(path.relative_to(DIRECTORY)),'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())})
assert actual_files==report['acceptanceFiles']
for item in actual_files:
 path=Path(item['path']).relative_to('acceptance');assert (original/path).read_bytes()==(DIRECTORY/item['path']).read_bytes()
# The module and binary retain their native clone identity. No command/path rewrite.
program='''import sys,json
from pathlib import Path
sys.path.insert(0,"tools/virgl-constant-compiler")
import receipt
p=Path("target/evidence/virgl-constant-compiler-cold")
result=receipt.verify(p,"d3565d11c2133aacbaa628ffa82342b5d308ab10")
assert result==json.loads((p/"receipt.json").read_bytes())
print(json.dumps({"sources":len(result["sources"]),"records":len(result["records"]),"native":result["native"],"wasm":result["wasm"],"browser":result["browser"]["modes"],"regressionsSchema":result["regressions"]["schema"]}))
'''
p=subprocess.run([sys.executable,'-c',program],cwd=clone,capture_output=True,text=True)
(OUT/'final-cold-receipt-replay.log').write_text(p.stdout+p.stderr);assert p.returncode==0,p.stderr
replay=json.loads(p.stdout)
receipt=json.loads((DIRECTORY/'acceptance/receipt.json').read_bytes())
for item in receipt['sources']:
 path=item['path'];raw=(ROOT/path).read_bytes();assert sha(raw)==item['sha256'] and len(raw)==item['bytes']
 assert subprocess.check_output(['git','show',f'{HEAD}:{path}'],cwd=ROOT)==raw
assert subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)==b''
preliminary='f81c83b7444e3e5d8d7e52d9daa04adf1a209fc2'
changes=subprocess.check_output(['git','diff','--name-only',preliminary,HEAD],cwd=ROOT,text=True).splitlines()
assert changes==['tools/virgl-constant-compiler/legacy_compat.py','tools/virgl-constant-compiler/shader_compat.py']
summary={'status':'passed','sourceHead':HEAD,'heldRuntimeHead':preliminary,'heldRuntimeReason':'Only two receipt adapters changed; compiler, all fixtures, native/Wasm/browser recorders and independent oracles are byte-identical.','exactHeadChangedFiles':changes,'coldReportSha256':sha((DIRECTORY/'report.json').read_bytes()),'coldReceiptSha256':report['receiptSha256'],'copiedArtifacts':len(actual_files),'copiedArtifactBytes':sum(f['bytes'] for f in actual_files),'replayedInPreservedClone':str(clone),'recomputedReceiptEqual':True,'rootSourceInventoryEqualsFrozenHead':True,'cloneStillPristine':True,'replay':replay}
(OUT/'final-cold-audit.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='replay'},indent=2))
