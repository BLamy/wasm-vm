"""Run the one final E9-T04 proof in a fresh source checkout, after critic test promotion."""
import hashlib,json,os,subprocess,sys,tempfile,time
from pathlib import Path
root=Path(sys.argv[1]).resolve();head=sys.argv[2]
assert len(head)==40 and all(c in '0123456789abcdef' for c in head)
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()==head
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=root)
out=root/'target/evidence/e9-t04-cold-final';out.mkdir(exist_ok=False)
clone=Path(tempfile.mkdtemp(prefix='e9-t04-cold-',dir=root/'target'))/'repo'
env={k:v for k,v in os.environ.items() if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG') and not k.startswith(('CARGO_','GIT_'))}
env['PATH']=str(Path.home()/'.cargo/bin')+':/usr/bin:/bin:/usr/sbin:/sbin:'+env['PATH']
env['E9_DISK_EVIDENCE_DIR']=str(out/'acceptance')
receipt={'head':head,'started':time.time(),'clone':str(clone),'output':str(out),'status':'running','commands':[],
 'environment':'RUSTFLAGS, RUSTDOCFLAGS, RUST_LOG, all CARGO_* and GIT_* unset; trusted toolchain directories prepended',
 'checkout':'Pristine cone checkout of every source/configuration directory and release, plus required historical compile-time fixtures and this task evidence. Only unrelated historical evidence binaries are excluded; Docstream reads its pinned historical prose directly from immutable Git blobs.',
 'objects':'Normal local clone with hardlinked immutable objects; no alternates or inherited target/npm caches'}
def run(command,cwd=root):
 entry={'cwd':str(cwd),'command':command};receipt['commands'].append(entry)
 with (out/'commands.log').open('ab') as log:
  result=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 entry['exit_code']=result.returncode
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 assert result.returncode==0,command
try:
 run(['git','clone','--local','--no-checkout','--single-branch','--branch','codex/e9-disk-roots',str(root),str(clone)])
 run(['git','sparse-checkout','init','--cone'],clone)
 directories=[name for name in subprocess.check_output(['git','ls-tree','-d','--name-only',head],cwd=clone,text=True).splitlines() if name!='evidence']
 run(['git','sparse-checkout','set',*directories,'evidence/e5-t26p','evidence/e5-t11c','evidence/e9-t04'],clone)
 run(['git','checkout','--detach',head],clone)
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==head
 assert not (clone/'.git/objects/info/alternates').exists()
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)
 assert not (clone/'target').exists() and not (clone/'tools/verify/session-wasm/target').exists() and not (clone/'web/node_modules').exists()
 metadata=[]
 for manifest,target in [('Cargo.toml',clone/'target'),('tools/verify/session-wasm/Cargo.toml',clone/'tools/verify/session-wasm/target')]:
  command=['cargo','metadata','--no-deps','--locked','--offline','--format-version','1','--manifest-path',manifest]
  value=json.loads(subprocess.check_output(command,cwd=clone,env=env,text=True))
  assert Path(value['target_directory'])==target, ('inherited target directory',value['target_directory'])
  metadata.append({'manifest':manifest,'target_directory':value['target_directory']})
 (out/'target-directories.json').write_text(json.dumps(metadata,indent=2)+'\n')
 run(['make','verify-E9-T04'],clone)
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)
 receipt['status']='passed'
except BaseException as error:
 receipt['status']='failed';receipt['failure']=str(error);raise
finally:
 receipt['finished']=time.time();receipt['wrapper_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps({'status':receipt['status'],'clone':str(clone),'receipt':str(out/'receipt.json')}),flush=True)
