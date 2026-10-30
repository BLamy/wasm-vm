"""Recorded public-site source, durable-prefix and retained GPU proof; no runtime rebuild."""
from pathlib import Path
import hashlib,json,os,subprocess,time
root=Path.cwd();out=root/'target/evidence/e9-t11-public-corrected-final';out.mkdir(exist_ok=False)
env={k:v for k,v in os.environ.items()if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG')and not k.startswith('CARGO_')};env['GIT_OPTIONAL_LOCKS']='0'
worker=json.loads((root/'target/evidence/e9-t11-worker-corrected-final/report.json').read_text());assert worker['status']=='passed'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();report={'task':'E9-T11','status':'running','head':head,'runtime_head':worker['head'],'started':time.time(),'scope':'Actual production source replay, direct/worker durable prefix capture/reopen and actual retained GPU factory retirement/presentation. Browser assets must match frozen dist; no native gate or runtime change is introduced.','commands':[]}
def sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def clean():assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],env=env)
def run(name,command):
 print(name,flush=True);t=time.time()
 with(out/(name+'.log')).open('wb')as f:r=subprocess.run(command,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=1800)
 report['commands'].append({'name':name,'command':command,'seconds':time.time()-t,'exit_code':r.returncode});assert r.returncode==0,name
try:
 clean();report['source_sha256']={n:sha(root/n)for n in worker['source_sha256']};assert report['source_sha256']==worker['source_sha256'],'runtime or frozen harness changed'
 run('production-browser',['node','tools/verify/e9-time-entropy-browser.mjs','--url','https://wasm-vm.pages.dev/','--output',str(out/'browser')])
 run('source-state-and-object-oracle',['python3','-B','tools/verify/e9-time-entropy-files.py','--directory',str(out/'browser'),'--browser'])
 run('clock-regression-oracle',['python3','-B','tools/verify/e9-event-clock-files.py','--directory',str(out/'browser/event-clock-regression')])
 run('retained-gpu-production',['node','tools/verify/e9-retained-gpu-browser.mjs','--url','https://wasm-vm.pages.dev/','--output',str(out/'retained-gpu-browser')])
 for folder in ['browser','retained-gpu-browser']:
  d=json.loads((out/folder/'report.json').read_text());assert d['status']=='passed'and d['head']==head and d['errors']==[]and not d['development']
 clean();report['status']='passed'
except BaseException as e:report['status']='failed';report['failure']=str(e);raise
finally:
 report['wrapper_sha256']=sha(Path(__file__));report['files']=[{'path':str(p.relative_to(out)),'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(out.rglob('*'))if p.is_file()and p!=out/'report.json'];report['finished']=time.time();(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],out,flush=True)
