import hashlib,json,os,subprocess,sys,tempfile,time
from pathlib import Path
root=Path(__file__).resolve().parents[2]
head=sys.argv[1]
assert len(head)==40 and all(c in '0123456789abcdef' for c in head)
out=root/'target/evidence/e9-t03-cold-final';out.mkdir(exist_ok=False)
clone=Path(tempfile.mkdtemp(prefix='e9-t03-cold-',dir=root/'target'))/'repo'
env={k:v for k,v in os.environ.items() if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG') and not k.startswith('CARGO_')}
env['PATH']=str(Path.home()/'.cargo/bin')+':/usr/bin:/bin:/usr/sbin:/sbin:'+env['PATH']
env['E9_STORE_EVIDENCE_DIR']=str(out/'acceptance')
receipt={'head':head,'started':time.time(),'clone':str(clone),'output':str(out),'status':'running','commands':[],
 'environment':'RUSTFLAGS, RUSTDOCFLAGS, RUST_LOG and all CARGO_* unset; trusted toolchain dirs prepended',
 'checkout':'Pristine sparse checkout of every source, workspace member, test, task and web artifact used by acceptance; large unrelated release binaries excluded. The real GPU loader obtains absent factory release bytes from their authenticated public content-addressed URLs.',
 'objects':'Normal local clone with hardlinked immutable Git objects; no alternates and no inherited target/npm caches'}
def run(cmd,cwd=root):
 receipt['commands'].append({'cwd':str(cwd),'command':cmd})
 with (out/'commands.log').open('ab') as log:
  p=subprocess.run(cmd,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 receipt['commands'][-1]['exit_code']=p.returncode
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 assert p.returncode==0,cmd
try:
 run(['git','clone','--local','--no-checkout','--single-branch','--branch','codex/e9-session-store',str(root),str(clone)])
 run(['git','sparse-checkout','init','--cone'],clone)
 run(['git','sparse-checkout','set','crates','docs','guest','tasks','tests','tools','web'],clone)
 run(['git','checkout','--detach',head],clone)
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==head
 assert not (clone/'.git/objects/info/alternates').exists()
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)
 assert not (clone/'target').exists() and not (clone/'web/node_modules').exists()
 run(['make','verify-E9-T03'],clone)
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)
 receipt['status']='passed'
except BaseException as e:
 receipt['status']='failed';receipt['failure']=str(e);raise
finally:
 receipt['finished']=time.time();receipt['wrapper_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps({'status':receipt['status'],'clone':str(clone),'receipt':str(out/'receipt.json')}),flush=True)
