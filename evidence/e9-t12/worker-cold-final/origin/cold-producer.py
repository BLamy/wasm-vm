"""Pristine exact-head source and compiler proof; source/empty target on task-owned RAM scratch."""
from pathlib import Path
import hashlib,json,os,subprocess,tempfile,time
root=Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'])
out=root/'target/evidence/e9-t12-worker-cold-final';out.mkdir(exist_ok=False)
mount=Path('/Volumes/e9-t11-cold-scratch');assert mount.is_mount()
source=mount/('cold-source-e9-t12-'+head[:12]);target=mount/('cold-target-e9-t12-'+head[:12]);assert not source.exists()and not target.exists()
metadata=root/'target'/('e9-t12-cold-'+head[:12]+'.git')
env={k:v for k,v in os.environ.items()if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG')and not k.startswith(('CARGO_','GIT_'))}
env.pop('RUSTC_WRAPPER',None);env.pop('RUSTC_WORKSPACE_WRAPPER',None)
env['PATH']=str(Path.home()/'.cargo/bin')+':/usr/bin:/bin:/usr/sbin:/sbin:'+env['PATH'];env.update(GIT_OPTIONAL_LOCKS='0',E9_DEVICE_EVIDENCE_DIR=str(out/'acceptance'))
proofdir=mount/('cold-proof-e9-t12-'+head[:12]);assert not proofdir.exists();(out/'acceptance').symlink_to(proofdir,target_is_directory=True)
report={'task':'E9-T12','head':head,'status':'running','submission':'Final worker recording in a pristine exact-head checkout, with a freshly empty compiler target and freshly installed locked Node dependencies. This is the prescribed final cold-clone proof.','original_recording':str(proofdir),'clone':str(source),'git_metadata':str(metadata),'started':time.time(),'commands':[],
 'environment':'Unset RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG and every CARGO_*/GIT_* variable. Prepend installed trusted Rust/system toolchain paths. No compiler/node_modules copied. Locked package download caches remain available.',
 'checkout':'Independent local clone, hardlinked immutable Git objects without alternates. Full source/configuration/release cone plus existing compile-time proof fixtures; unrelated historical evidence binaries excluded. Source and freshly empty compiler output live on task-owned RAM scratch; original recordings remain on task RAM with authenticated compressed copies retained for the verifier; Git metadata persists outside it.'}
def sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def run(command,cwd):
 with(out/'commands.log').open('ab')as log:r=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=7200)
 report['commands'].append({'command':command,'cwd':str(cwd),'exit_code':r.returncode});(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');assert r.returncode==0,command
try:
 run(['git','clone','--local','--no-checkout','--single-branch','--branch','codex/e9-device-completions','--separate-git-dir',str(metadata),str(root),str(source)],root)
 run(['git','sparse-checkout','init','--cone'],source)
 run(['git','sparse-checkout','set','.cargo','.github','bench','compliance','configs','crates','deploy','design','docs','fuzz','guest','releases','renderer','tasks','tests','third_party','tools','web','evidence/e5-t26p','evidence/e5-t11c','evidence/e9-t05','evidence/e9-t06','evidence/e9-t07','evidence/e9-t08','evidence/e9-t09'],source)
 run(['git','checkout','--detach',head],source)
 assert not(metadata/'objects/info/alternates').exists()
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=source,env=env)
 target.mkdir();assert not list(target.iterdir());(source/'target').symlink_to(target,target_is_directory=True)
 report['compiler_storage']={'target':str(target),'initial_entries':[],'source':str(source),'mount':str(mount),'no_inherited_compiler_cache':True}
 run(['make','verify-E9-T12'],source)
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()==head
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=source,env=env)
 proof=json.loads((out/'acceptance/report.json').read_text());assert proof['status']=='passed'and proof['head']==head
 report['source_sha256']={n:sha(source/n)for n in proof['source_sha256']};assert report['source_sha256']==proof['source_sha256'];report['status']='passed'
except BaseException as e:report['status']='failed';report['failure']=str(e);raise
finally:
 report['wrapper_sha256']=sha(Path(__file__));report['finished']=time.time();report['files']=[{'path':str(f.relative_to(out)),'bytes':f.stat().st_size,'sha256':sha(f)}for f in sorted(out.rglob('*'))if f.is_file()and f!=out/'receipt.json'];report['files'] += [{'path':'acceptance/'+str(f.relative_to(proofdir)),'bytes':f.stat().st_size,'sha256':sha(f)}for f in sorted(proofdir.rglob('*'))if f.is_file()];(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],out,flush=True)
