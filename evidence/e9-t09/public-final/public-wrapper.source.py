"""Record the published event-clock runtime and unchanged retained GPU factory on production."""
from pathlib import Path
import hashlib,json,os,subprocess,time
root=Path.cwd();out=root/'target/evidence/e9-t09-public-final';out.mkdir(parents=True,exist_ok=False)
env={k:v for k,v in os.environ.items() if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG') and not k.startswith('CARGO_')}
def sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1<<20),b''):digest.update(chunk)
    return digest.hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
report={'task':'E9-T09','status':'running','head':head,'started':time.time(),'production':'https://wasm-vm.pages.dev/','commands':[],'scope':'Exact shipped event-clock code/Wasm, real CPU/JIT boundary probe and retained accelerated guest retirement/fresh physical draw; no Linux continuous recording claim.'}
def run(name,command):
    print(name,flush=True);started=time.time()
    with (out/(name+'.log')).open('wb') as log:r=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=1200)
    report['commands'].append({'name':name,'command':command,'exit_code':r.returncode,'seconds':time.time()-started})
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');assert r.returncode==0,name
try:
    assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'])
    run('browser',['node','tools/verify/e9-event-clock-browser.mjs','--output',str(out/'browser'),'--url','https://wasm-vm.pages.dev/'])
    run('retained-gpu-browser',['node','tools/verify/e9-retained-gpu-browser.mjs','--output',str(out/'retained-gpu-browser'),'--url','https://wasm-vm.pages.dev/'])
    for name in ['browser','retained-gpu-browser']:
        r=json.loads((out/name/'report.json').read_text());assert r['status']=='passed' and r['head']==head and r['errors']==[] and not r['development']
    assert json.loads((out/'browser/report.json').read_text())['checks']['suite']=={'passed':127,'failed':0}
    assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'])
    report['status']='passed'
except BaseException as error:
    report['status']='failed';report['failure']=str(error);raise
finally:
    names=json.loads((root/'target/evidence/e9-t09-worker-final/report.json').read_text())['source_sha256']
    report['source_sha256']={name:sha(root/name) for name in names}
    report['source_sha256']['crates/jit-runtime/tests/e9_event_clock_critic.rs']=sha(root/'crates/jit-runtime/tests/e9_event_clock_critic.rs')
    report['files']=[{'path':str(file.relative_to(out)),'bytes':file.stat().st_size,'sha256':sha(file)} for file in sorted(out.rglob('*')) if file.is_file() and file!=out/'report.json']
    report['finished']=time.time();(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],flush=True)
