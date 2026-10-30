"""Publish only catalog/status bytes, carrying a completed full deployment's exact assets."""
import argparse,hashlib,io,json,shutil,subprocess,tarfile,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('mode',choices=['capture','publish']);p.add_argument('--snapshot',type=Path,required=True);p.add_argument('--log',type=Path,required=True);p.add_argument('--output',type=Path);a=p.parse_args()
root=Path.cwd();dist=root/'web/dist';snapshot=a.snapshot.resolve();manifests=['artifacts.json','artifacts-alpine.json','artifacts-node-alpine.json','artifacts-omarchy.json','artifacts-omarchy-virgl.json'];allowed={'roadmap.js','tasks.json','sw.js'}
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
def inventory(base):return {str(p.relative_to(base)):{'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(base.rglob('*')) if p.is_file()}
if a.mode=='capture':
 log=a.log.read_text();assert '[deploy] live at https://wasm-vm.pages.dev/' in log and 'Deployment complete!' in log
 assert not snapshot.exists();snapshot.mkdir();subprocess.run(['cp','-cR',str(dist),str(snapshot/'dist')],check=True)
 files=inventory(snapshot/'dist');assert files==inventory(dist)
 head=git('rev-parse','HEAD');tracked={str(Path(x).relative_to('web/dist')) for x in git('ls-tree','-r','--name-only',head,'--','web/dist').splitlines()}
 archive=subprocess.check_output(['git','archive',head,'web/dist']);frozen={}
 with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
  for member in tar:
   if member.isfile():
    data=tar.extractfile(member).read();name=str(Path(member.name).relative_to('web/dist'));frozen[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 assert set(frozen)==tracked
 for name in set(files)-tracked:
  assert name.startswith('releases/') and (root/name).is_file(),name
  assert files[name]=={'bytes':(root/name).stat().st_size,'sha256':sha(root/name)},name
 for name in tracked-set(manifests):assert frozen[name]==files[name],name
 originals={n:subprocess.check_output(['git','show',head+':web/dist/'+n]) for n in manifests}
 for name,data in originals.items():
  before=json.loads(data);after=json.loads((snapshot/'dist'/name).read_text())
  for role,asset in after['artifacts'].items():
   prior=before['artifacts'][role]
   if asset['url']!=prior['url']:
    assert asset['url']=='https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+prior['sha256']+'/'+prior['url'].removeprefix('./'),(name,role)
    asset['url']=prior['url']
  assert before==after,name
 for name,data in originals.items():(snapshot/('original-'+name)).write_bytes(data)
 r={'status':'passed','head':head,'deployment_log':str(a.log.resolve()),'deployment_log_sha256':sha(a.log),'tracked':sorted(tracked),'files':files,'original_manifests':{n:hashlib.sha256(b).hexdigest() for n,b in originals.items()},'scope':'Exact successful full-deploy payload, including release extras and R2 bindings; later catalog publish may change only roadmap/tasks/sw.'}
 (snapshot/'receipt.json').write_text(json.dumps(r,indent=2)+'\n');print('Captured full successful deployment',head,len(files));raise SystemExit
assert a.output is not None;out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
assert not git('status','--porcelain','--untracked-files=all'),'source must be clean'
r=json.loads((snapshot/'receipt.json').read_text());assert r['status']=='passed' and inventory(snapshot/'dist')==r['files'] and sha(Path(r['deployment_log']))==r['deployment_log_sha256']
head=git('rev-parse','HEAD');current=inventory(dist);tracked={str(Path(x).relative_to('web/dist')) for x in git('ls-tree','-r','--name-only',head,'--','web/dist').splitlines()};assert tracked==set(r['tracked']) and set(current)==tracked
for name,data in current.items():
 if name in manifests:assert data['sha256']==r['original_manifests'][name],name
 elif name not in allowed:assert data==r['files'][name],name
changed={name:{'before':r['files'][name],'after':current[name]} for name in allowed if current[name]!=r['files'][name]};assert changed
report={'status':'running','head':head,'scope':'Catalog/status publication only. Full deployment asset verification carried from unchanged exact hashes; no R2 objects written.','baseline_receipt':str(snapshot/'receipt.json'),'baseline_receipt_sha256':sha(snapshot/'receipt.json'),'baseline_head':r['head'],'changed':changed,'started':time.time()}
try:
 for name in sorted(set(r['files'])-tracked | set(manifests)):
  dest=dist/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(snapshot/'dist'/name,dest)
 publish=inventory(dist);assert set(publish)==set(r['files'])
 for name,data in publish.items():assert data['bytes']<=25*1024*1024 and (name in allowed or data==r['files'][name]),name
 command=['npx','--yes','wrangler','pages','deploy','web/dist','--project-name','wasm-vm','--branch','main','--commit-dirty=true'];report['command']=command
 with a.log.open('wb') as log:result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
 assert result.returncode==0,'Pages publication failed; see original log';report['files']=publish;report['status']='passed';report['log_sha256']=sha(a.log)
except BaseException as error:
 report['status']='failed';report['failure']=str(error);raise
finally:
 for name in manifests:shutil.copyfile(snapshot/('original-'+name),dist/name)
 report['finished']=time.time();(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
assert not git('status','--porcelain','--untracked-files=all');print('Published bounded catalog changes:',','.join(changed))
