from pathlib import Path
import hashlib,json,os,subprocess,time,sys
root=Path('/private/tmp/e5-5-t07-pristine-pinned-0144c662b');out=Path('/private/tmp/e5-5-t07-pristine-proof-v3');out.mkdir(exist_ok=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
prior_path=Path('/private/tmp/e5-5-t07-pristine-proof-v2/receipt.json');prior=json.loads(prior_path.read_text())
env={k:v for k,v in os.environ.items() if not k.startswith('CARGO_') and k not in ['RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER','RUSTC_BOOTSTRAP','NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONOPTIMIZE']};env.update(CARGO_BUILD_JOBS='4',CARGO_INCREMENTAL='0',CARGO_TERM_COLOR='never')
def git(*args):return subprocess.check_output(['git',*args],cwd=root,env=env,text=True).strip()
report={'status':'running','started':time.time(),'clone':str(root),'originalFailedReceiptSha256':sha(prior_path),'originalOutcome':prior['status'],'originalCompiler':prior['compiler'],'originalEmptyTarget':prior['initialTargetAbsent'],'originalHead':prior['head'],'scope':'Continuation of same independently compiled pinned clone; only missing R2 bootstrap and three browser proofs; no second empty-target claim','commands':[],'built':prior['built']}
def run(name,cmd,timeout=600):
 p=out/(name+'.log');start=time.time()
 with p.open('wb') as f: result=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 report['commands'].append({'name':name,'command':cmd,'exitCode':result.returncode,'seconds':time.time()-start,'sha256':sha(p)})
 print(json.dumps(report['commands'][-1]),flush=True);assert result.returncode==0,name
try:
 assert not git('status','--porcelain') and not(root/'.git/objects/info/alternates').exists()
 for name,data in prior['built'].items():
  assert data['identical'] and sha(root/'crates/wasm-web/pkg'/name)==data['sha256']==sha(root/'web/dist/pkg'/name)
 run('fetch',['git','fetch','--depth','1','origin','codex/omarchy-streamed-software-restore'])
 run('checkout',['git','checkout','--detach','FETCH_HEAD'])
 report['head']=git('rev-parse','HEAD'); report['changes']=git('diff','--name-only',prior['head'],report['head']).splitlines()
 assert set(report['changes'])<= {'Makefile','tools/verify/software-snapshot-gate.py','tools/verify/e5-t18e-demo-smoke.mjs'}
 assert not git('status','--porcelain')
 env['E5_STREAM_OUT']=str(out/'gate');env['E5_STREAM_RESUME']='/private/tmp/e5-5-t07-pristine-proof-v2/gate'
 (out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
 run('missing-browser-acceptance',['make','verify-E5.5-T07'])
 report['finalStatus']=git('status','--porcelain');assert not report['finalStatus'];report['status']='passed'
except BaseException as e:report['status']='failed';report['failure']=repr(e)
finally:
 report['finished']=time.time();(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'failure':report.get('failure')}),flush=True)
sys.exit(0 if report['status']=='passed' else 1)
