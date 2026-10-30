#!/usr/bin/env python3
"""Record native pending GPU keyframe restore at a clean frozen source head."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--pending-status',choices=['in-progress','verified'],default='verified',
               help='Expected roadmap status: use in-progress while recording a worker submission.')
a=p.parse_args()
out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
env={k:v for k,v in os.environ.items() if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG') and not k.startswith('CARGO_')}
env.update(CARGO_TERM_COLOR='never',CARGO_BUILD_JOBS='4',E9_GPU_RESULT_EVIDENCE=str(out/'native'))
report={'task':'E9-T18b','status':'running','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'started':time.time(),'commands':[],'scope':'Native GPU v2 pending frontier, fresh callback leases, exact guest restore and disk pairing; durable physical browser GPU replay remains T18c.'}
features='virgl-renderer,virgl-control-proof,gpu-trace,trace'
def sha(file):
    h=hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda:source.read(1<<20),b''):h.update(block)
    return h.hexdigest()
def write(): (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
def clean():
    value=subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=ROOT,text=True)
    assert not value,'acceptance needs clean source: '+value
    return value
def run(name,command,timeout=1800):
    report['active']=name;write();print(name,flush=True);start=time.time()
    with (out/(name+'.log')).open('wb') as log:
        result=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
    report['commands'].append({'name':name,'command':command,'seconds':time.time()-start,'exit_code':result.returncode});write()
    assert result.returncode==0,name+' failed; inspect its log'
try:
    clean()
    run('policy',['python3','tools/check_task_policy.py'])
    run('format',['cargo','fmt','--all','--check'])
    run('native-clippy',['cargo','clippy','-p','wasm-vm-core','--tests','--features',features,'--','-D','warnings'])
    run('control-and-codecs',['cargo','test','-p','wasm-vm-core','--features',features,'--lib','--','--nocapture'])
    run('rv64-results',['cargo','test','-p','wasm-vm-core','--features',features,'--test','session_gpu_results','--','--nocapture','--test-threads=1'])
    run('independent-bytes',['python3','-B','tools/verify/e9-gpu-results-files.py','--directory',str(out/'native')])
    run('independent-pending-bytes',['python3','-B','tools/verify/e9-pending-gpu-files.py','--directory',str(out/'native')])
    run('native-gpu-regression',['cargo','test','-p','wasm-vm-core','--features',features,'--test','virtio_gpu_submit3d','--test','production_virgl_critic','--test','production_gpu_checkpoint_critic','--','--nocapture','--test-threads=1'])
    run('source-clock-regression',['cargo','test','-p','wasm-vm-core','--features',features,'--test','e9_event_clock','--test','e9_time_entropy','--','--nocapture'])
    run('core-no-std-wasm',['cargo','build','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown','--features','virgl-renderer,trace'])
    run('wasm-clippy',['cargo','clippy','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--features','virgl-renderer','--','-D','warnings'])
    run('browser-build',['make','web-build'])
    for name in ['pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','roadmap.js']:
        assert (ROOT/'web'/name).read_bytes()==(ROOT/'web/dist'/name).read_bytes(),'stale committed dist: '+name
    run('browser-syntax',['node','--check','tools/verify/e9-gpu-results-browser.mjs'])
    run('built-browser',['node','tools/verify/e9-gpu-results-browser.mjs','--output',str(out/'browser'),'--capability-status','verified','--pending-status',a.pending_status])
    browser=json.loads((out/'browser/report.json').read_text());assert browser['status']=='passed' and browser['head']==report['head']
    assert browser['suite']=={'passed':127,'failed':0} and browser['errors']==[] and browser['httpErrors']==[]
    report['final_checkout_status']=clean();report['status']='passed'
except BaseException as error:
    report['status']='failed';report['failure']=repr(error);raise
finally:
    report.pop('active',None);report['finished']=time.time()
    changed=subprocess.check_output(['git','diff','--name-only','7d142f83d',report['head']],cwd=ROOT,text=True).splitlines()
    report['sources']=[{'path':name,'sha256':sha(ROOT/name)} for name in changed if (ROOT/name).is_file()]
    report['files']=[{'path':str(file.relative_to(out)),'bytes':file.stat().st_size,'sha256':sha(file)} for file in sorted(out.rglob('*')) if file.is_file() and file!=out/'report.json']
    write()
