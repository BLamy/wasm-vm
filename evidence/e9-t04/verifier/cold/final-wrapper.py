import hashlib,json,os,subprocess,sys,time
from pathlib import Path
root=Path('/Users/blamy/.codex/worktrees/e9-session-contract/wasm-vm')
prior=root/'target/evidence/e9-t04-cold-final'
previous=json.loads((prior/'receipt.json').read_text());clone=Path(previous['clone']);head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
out=root/'target/evidence/e9-t04-cold-browser-final';out.mkdir(exist_ok=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def clean():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==head
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)
env={k:v for k,v in os.environ.items() if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG') and not k.startswith(('CARGO_','GIT_'))}
env['PATH']=str(Path.home()/'.cargo/bin')+':/usr/bin:/bin:/usr/sbin:/sbin:'+env['PATH']
command=['node','tools/verify/e9-disk-roots-browser.mjs','--output',str(out/'browser')]
receipt={'head':head,'clone':str(clone),'cwd':str(clone),'command':command,'started':time.time(),'status':'running',
 'prior_receipt_sha256':sha(prior/'receipt.json'),'prior_acceptance_sha256':sha(prior/'acceptance/report.json'),
 'carry_forward':'All 15 cold gates and root/critic assertions retain identical runtime/dependency bytes at25e65f56. The final candidate changes only the proof driver to release completed export interception before retained GPU compatibility, plus evidence/log. Controlled route toggle establishes the harness cause, not a transient failure. Final full browser acceptance uses this exact clean candidate and a new profile.',
 'prior_head':previous['head'],'causal_toggle_sha256':sha(root/'evidence/e9-t04/harness/route-toggle.json'),
 'environment':previous['environment']}
try:
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)
 subprocess.run(['git','fetch','origin','codex/e9-disk-roots'],cwd=clone,env=env,check=True)
 subprocess.run(['git','checkout','--detach',head],cwd=clone,env=env,check=True)
 clean()
 with (out/'commands.log').open('wb') as f: result=subprocess.run(command,cwd=clone,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=3600)
 receipt['exit_code']=result.returncode;clean();assert result.returncode==0
 browser=json.loads((out/'browser/report.json').read_text());assert browser['status']=='passed' and browser['head']==head and browser['errors']==[]
 receipt['status']='passed'
except BaseException as e:
 receipt['status']='failed';receipt['failure']=str(e);raise
finally:
 receipt['source_sha256']={p:sha(clone/p) for p in json.loads((prior/'acceptance/report.json').read_text())['source_sha256']}
 receipt['files']=[{'path':str(p.relative_to(out)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.rglob('*')) if p.is_file() and p!=out/'receipt.json']
 receipt['finished']=time.time();receipt['wrapper_sha256']=sha(Path(__file__))
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(receipt['status'],out,flush=True)
