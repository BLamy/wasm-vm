"""Clean exact-head high-risk submission on RAM; immutable Git objects are shared read-only."""
from pathlib import Path
import hashlib,json,os,subprocess,time
root=Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();assert head=='98260ff67d814311b3c2cf175a57476f3d3c64ab'
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'])
mount=Path('/Volumes/e9-final-proof-ram');out=mount/('cold-worker-e9-t12-'+head[:12]);out.mkdir(exist_ok=False)
source=mount/('cold-source-e9-t12-'+head[:12]);target=mount/('cold-target-e9-t12-'+head[:12]);metadata=mount/('cold-git-e9-t12-'+head[:12]);proofdir=mount/('cold-proof-e9-t12-'+head[:12])
assert not any(p.exists()for p in [source,target,metadata,proofdir]);(out/'acceptance').symlink_to(proofdir,target_is_directory=True)
objects=Path(subprocess.check_output(['git','rev-parse','--git-path','objects'],text=True).strip()).resolve()
env={k:v for k,v in os.environ.items()if k not in('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER')and not k.startswith(('CARGO_','GIT_'))}
env['PATH']='/Volumes/e9-t11-cold-scratch/bash-tools/bin:'+str(Path.home()/'.cargo/bin')+':/usr/bin:/bin:/usr/sbin:/sbin:'+env['PATH'];env.update(GIT_OPTIONAL_LOCKS='0',E9_DEVICE_EVIDENCE_DIR=str(proofdir),TMPDIR=str(mount/'catalog-build-tmp')+'/',npm_config_cache=str(mount/'e9-t12-npm-cache'))
env.update(XDG_CACHE_HOME='/Volumes/e9-build-scratch/e9-toolchain-cache',TMPPREFIX='/Volumes/e9-final-proof-ram/catalog-build-tmp/zsh',CHROME='/Users/blamy/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell')
Path(env['TMPDIR']).mkdir(parents=True,exist_ok=True)
report={'task':'E9-T12','status':'running','head':head,'submission':'Repaired final worker submission: full risk-tier recording from a clean exact-head independent source checkout with freshly empty compiler target and fresh locked Node install. No earlier runtime gate substituted.','clone':str(source),'git_metadata':str(metadata),'original_recording':str(proofdir),'git_object_storage':{'mode':'git clone --shared, read-only immutable object database; independent refs/index/worktree on task RAM','parent_objects':str(objects),'reason':'Persistent filesystem rejects new Git metadata with ENOSPC. This is disclosed object-store sharing only, not a shared source checkout or compiler cache. All source/configuration and dependency hashes independently authenticated by the acceptance harness.'},'build_shell_receipt':'/Volumes/e9-t11-cold-scratch/bash-tools/receipt.json','emsdk_copy_receipt':'/Volumes/e9-t11-cold-scratch/e9-t12-emsdk-ram-copy.json','environment':'All CARGO_*/GIT_* flags and Rust compiler wrappers/logging unset; trusted toolchain first; TMPDIR/npm download cache on task RAM. No compiler or node_modules copied.','started':time.time(),'commands':[]}
def sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def run(command,cwd):
 print('run',command,flush=True)
 with(out/'commands.log').open('ab')as log:r=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=7200)
 report['commands'].append({'command':command,'cwd':str(cwd),'exit_code':r.returncode});(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');assert r.returncode==0,command
try:
 run(['git','clone','--shared','--no-checkout','--single-branch','--branch','codex/e9-device-completions','--separate-git-dir',str(metadata),str(root),str(source)],root)
 run(['git','sparse-checkout','init','--cone'],source)
 run(['git','sparse-checkout','set','.cargo','.github','bench','compliance','configs','crates','deploy','design','docs','fuzz','guest','releases','renderer','tasks','tests','third_party','tools','web','evidence/e5-t26p','evidence/e5-t11c','evidence/e9-t05','evidence/e9-t06','evidence/e9-t07','evidence/e9-t08','evidence/e9-t09'],source)
 run(['git','checkout','--detach',head],source)
 assert(metadata/'objects/info/alternates').read_text().strip()==str(objects)
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=source,env=env)
 target.mkdir();assert not list(target.iterdir());(source/'target').symlink_to(target,target_is_directory=True)
 report['compiler_storage']={'target':str(target),'initial_entries':[],'no_inherited_compiler_cache':True,'no_inherited_node_modules':not(source/'web/node_modules').exists()}
 run(['make','verify-E9-T12'],source)
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()==head
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=source,env=env)
 proof=json.loads((proofdir/'report.json').read_text());assert proof['status']=='passed'and proof['head']==head
 report['source_sha256']={n:sha(source/n)for n in proof['source_sha256']};assert report['source_sha256']==proof['source_sha256']
 run(['git','fsck','--connectivity-only','--no-reflogs'],source)
 report['status']='passed'
except BaseException as error:report['status']='failed';report['failure']=str(error);raise
finally:
 report['wrapper_sha256']=sha(Path(__file__));report['finished']=time.time()
 report['files']=[{'path':str(p.relative_to(out)),'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(out.rglob('*'))if p.is_file()and p!=out/'receipt.json']
 report['files'] += [{'path':'acceptance/'+str(p.relative_to(proofdir)),'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(proofdir.rglob('*'))if p.is_file()]
 (out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],out,flush=True)
