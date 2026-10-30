from pathlib import Path
import hashlib,io,json,shutil,subprocess,tarfile,time
root=Path.cwd();head='04f628dd02a0bf57331682e05607829e25a0ca46';mount=Path('/Volumes/e9-final-proof-ram')
source=mount/'e9-t13-reset-publication-source';metadata=mount/'e9-t13-reset-publication-git';out=mount/'e9-t13-reset-publication-prepared'
baseline=mount/'e9-t12-repaired-full-deploy-v2';prior=json.loads((baseline/'receipt.json').read_text())
proof=mount/'cold-proof-e9-t13-04f628dd02a0/report.json';assert json.loads(proof.read_text())['status']=='passed'
for p in(source,metadata,out):assert not p.exists(),str(p)
out.mkdir()
def run(args,cwd=root):subprocess.run(args,cwd=cwd,check=True,stdout=subprocess.DEVNULL)
def sha(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for block in iter(lambda:f.read(1<<20),b''):h.update(block)
 return h.hexdigest()
def inventory(base):return{str(p.relative_to(base)):{'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(base.rglob('*'))if p.is_file()}
assert prior['status']=='passed'and inventory(baseline/'dist')==prior['files']
run(['git','clone','--shared','--no-checkout','--separate-git-dir',str(metadata),str(root),str(source)])
run(['git','sparse-checkout','init','--cone'],source);run(['git','sparse-checkout','set','web/dist'],source);run(['git','checkout','--detach',head],source)
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=source)
dist=source/'web/dist';original=inventory(dist)
raw=subprocess.check_output(['git','archive',head,'web/dist'],cwd=source);frozen={}
with tarfile.open(fileobj=io.BytesIO(raw))as tar:
 for member in tar:
  if member.isfile():
   data=tar.extractfile(member).read();frozen[str(Path(member.name).relative_to('web/dist'))]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
assert original==frozen
manifests=['artifacts.json','artifacts-alpine.json','artifacts-node-alpine.json','artifacts-omarchy.json','artifacts-omarchy-virgl.json']
for name in manifests:
 assert original[name]['sha256']==prior['original_manifests'][name],name
 shutil.copyfile(baseline/'dist'/name,dist/name)
extras=set(prior['files'])-set(prior['tracked'])
for name in extras:
 assert name.startswith('releases/'),name
 dest=dist/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(baseline/'dist'/name,dest)
staged=inventory(dist)
assert set(staged)==set(original)|extras
for name,entry in staged.items():
 assert entry['bytes']<=25*1024*1024,name
 assert entry==(prior['files'][name]if name in extras or name in manifests else original[name]),name
(out/'receipt.json').write_text(json.dumps({'status':'prepared-not-published','head':head,'worker_report':str(proof),'worker_report_sha256':sha(proof),'baseline_receipt':str(baseline/'receipt.json'),'baseline_receipt_sha256':sha(baseline/'receipt.json'),'source':str(source),'metadata':str(metadata),'original_files':original,'staged_files':staged,'carried_release_extras':sorted(extras),'scope':'Exact frozen and locally proven T13 runtime payload. Unchanged boot manifests/R2 bindings and five Pages release extras carried by exact hash from the completed T12 full deployment. All frozen source files authenticated against Git archive; every staged file within Pages limit. No auth, upload or deployment command was executed. Ready for the standard Wrangler Pages publication once official login completes.','time':time.time()},indent=2)+'\n')
print(json.dumps({'source':str(source),'files':len(staged),'bytes':sum(x['bytes']for x in staged.values()),'receipt_sha256':sha(out/'receipt.json')}))
