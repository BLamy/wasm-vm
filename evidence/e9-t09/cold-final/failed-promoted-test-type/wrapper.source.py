"""One final pristine source proof after promoted verifier tests; evidence outside the checkout."""
from pathlib import Path
import hashlib,json,os,subprocess,tempfile,time
root=Path('/Users/blamy/.codex/worktrees/e9-session-contract/wasm-vm')
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=root)
out=root/'target/evidence/e9-t09-cold-final-2';out.mkdir(exist_ok=False)
clone=Path(tempfile.mkdtemp(prefix='e9-t09-cold-',dir=root/'target'))/'repo'
env={key:value for key,value in os.environ.items() if key not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG') and not key.startswith(('CARGO_','GIT_'))}
env['PATH']=str(Path.home()/'.cargo/bin')+':/usr/bin:/bin:/usr/sbin:/sbin:'+env['PATH']
env['E9_CLOCK_EVIDENCE_DIR']=str(out/'acceptance')
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
receipt={'head':head,'clone':str(clone),'output':str(out),'started':time.time(),'status':'running','commands':[],
 'environment':'RUSTFLAGS, RUSTDOCFLAGS, RUST_LOG, all CARGO_* and GIT_* unset; trusted Rust/system toolchain paths prepended.',
 'checkout':'Clean cone checkout of every source/configuration directory and release plus required historical compile-time fixtures and this task evidence. Unrelated historical evidence binaries excluded; Docstream reads pinned historical prose from immutable Git blobs.',
 'objects':'Local immutable hardlinked Git objects, no alternates, no inherited target or node_modules state. Ordinary locked package-download caches and installed toolchains remain available.'}
def run(command,cwd):
 with (out/'commands.log').open('ab') as log: result=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=7200)
 receipt['commands'].append({'cwd':str(cwd),'command':command,'exit_code':result.returncode})
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 assert result.returncode==0,command
try:
 run(['git','clone','--local','--no-checkout','--single-branch','--branch','codex/e9-event-clock',str(root),str(clone)],root)
 run(['git','sparse-checkout','init','--cone'],clone)
 run(['git','sparse-checkout','set','.cargo','.github','bench','compliance','configs','crates','deploy','design','docs','fuzz','guest','releases','renderer','tasks','tests','third_party','tools','web','evidence/e5-t26p','evidence/e5-t11c','evidence/e9-t05','evidence/e9-t06','evidence/e9-t07','evidence/e9-t08','evidence/e9-t09'],clone)
 run(['git','checkout','--detach',head],clone)
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)
 build_mount=Path('/Volumes/e9-t09-cold-build')
 assert build_mount.is_mount(), 'task-owned fresh RAM volume is not mounted'
 build_target=build_mount/('target-'+head[:12]);assert not build_target.exists();build_target.mkdir()
 assert not (clone/'target').exists();(clone/'target').symlink_to(build_target,target_is_directory=True)
 receipt['compiler_storage']={'mount':str(build_mount),'target':str(build_target),'initial_entries':list(build_target.iterdir()),'purpose':'Fresh, empty compiler outputs on a task-owned RAM disk; no inherited target cache or CARGO_TARGET_DIR. All proof recordings remain on persistent storage outside this checkout.'}
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)
 run(['make','verify-E9-T09'],clone)
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==head
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)
 report=json.loads((out/'acceptance/report.json').read_text());assert report['status']=='passed' and report['head']==head
 receipt['status']='passed'
except BaseException as error:
 receipt['status']='failed';receipt['failure']=str(error);raise
finally:
 report_path=out/'acceptance/report.json'
 if report_path.exists():
  report=json.loads(report_path.read_text());receipt['source_sha256']={name:sha(clone/name) for name in report.get('source_sha256',{})}
 receipt['files']=[{'path':str(path.relative_to(out)),'bytes':path.stat().st_size,'sha256':sha(path)} for path in sorted(out.rglob('*')) if path.is_file() and path!=out/'receipt.json']
 receipt['finished']=time.time();receipt['wrapper_sha256']=sha(Path(__file__))
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(receipt['status'],out,flush=True)
