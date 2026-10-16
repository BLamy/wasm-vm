#!/usr/bin/env python3
"""Record coherent production object capacity without changing isolated profiles."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
repo=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args();output=args.output.resolve();output.mkdir(parents=True,exist_ok=False)
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=repo),'freeze source first'
env={k:v for k,v in os.environ.items() if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG') and not k.startswith(('CARGO_','VIRGL_','CRITIC_'))}
report={'task':'E6-T11d74d2','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'status':'running','started':time.time(),'commands':[],
 'scope':'Production admission/retention/roster/checkpoint count policy; final Omarchy workload/publication remains74d',
 'carried':{'scanout':'612b1b7bc179ab18c0777592e364c80fc57eb6d1 verified74d1; unchanged presentation/protocol/checkpoint presentation gate',
 'fourSoftwareImages':'74d1 pristine recording07c10a5a5ea3c4edeb56ffcac862c1199460e34a81e5699cc1de525131f3b3bd; native changes explicitly production-only, historical profiles rechecked here; full all-image publication repeats in74d'}}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(name,cmd,timeout=1800):
 print(name,flush=True);started=time.time()
 with (output/(name+'.stdout')).open('wb') as a,(output/(name+'.stderr')).open('wb') as b:r=subprocess.run(cmd,cwd=repo,env=env,stdout=a,stderr=b,timeout=timeout)
 report['commands'].append({'name':name,'command':cmd,'exitCode':r.returncode,'seconds':time.time()-started});(output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 assert r.returncode==0,name+' failed; inspect recorded output'
try:
 run('policy',['python3','tools/check_task_policy.py'])
 run('format',['cargo','fmt','--all','--check'])
 run('core-clippy',['cargo','clippy','-p','wasm-vm-core','--tests','--features','virgl-renderer,virgl-control-proof,gpu-trace,trace','--','-D','warnings'])
 run('wasm-clippy',['cargo','clippy','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--features','virgl-renderer','--','-D','warnings'])
 run('core-unit',['cargo','test','-p','wasm-vm-core','--lib','--features','virgl-renderer,trace'])
 run('wasm-native',['cargo','test','-p','wasm-vm-wasm','--lib','--features','virgl-renderer'])
 run('native-gpu',['cargo','test','-p','wasm-vm-core','--features','virgl-renderer,trace','--test','production_virgl_critic','--test','production_gpu_checkpoint_critic','--','--nocapture','--test-threads=1'])
 run('independent-native-capacity',['python3','tools/virgl-production/critic-desktop-capacity-native.py','--output',str(output/'independent-native')])
 run('no-std-wasm',['cargo','build','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown','--features','virgl-renderer,trace'])
 run('presentation-protocol',['node','--test','web/tests/e5-t06d-presentation.test.mjs','web/tests/e5-t09c-present-scheduler.test.mjs','web/tests/e4-t32-worker-protocol.test.mjs'])
 guest=repo/'guest/prebuilt/production-gpu-capacity.bin';pin=digest(guest)
 run('original-guest-build',['node','tools/virgl-production/paired-guest/build-capacity.mjs']);assert digest(guest)==pin
 report['originalSupervisorSha256']=pin
 run('web-build',['make','web-build'])
 for name in ['pkg/wasm_vm_wasm_bg.wasm','main.js','linux-worker-protocol.js','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/control-bridge.mjs']:
  assert digest(repo/'web'/name)==digest(repo/'web/dist'/name),'committed dist drift '+name
 run('actual-worker-roundtrip',['node','tools/virgl-production/capacity-worker-browser.mjs',str(output/'actual-worker'),'roundtrip'])
 run('independent-physical-capacity',['node','tools/virgl-production/critic-desktop-capacity-browser.mjs','--output',str(output/'independent-physical')])
 run('frame-continuity-regression',['node','tools/virgl-production/scanout-worker-browser.mjs',str(output/'frame-continuity')])
 run('default-browser',['node','tools/verify-virgl-default-demo.mjs','--output',str(output/'default-browser'),'--task','E6-T11d74d2'])
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=repo),'acceptance changed tracked source'
 report['status']='passed'
except BaseException as e:report['status']='failed';report['failure']=str(e);raise
finally:
 report['finished']=time.time();report['files']=[{'path':str(p.relative_to(output)),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(output.rglob('*')) if p.is_file() and p!=output/'report.json'];(output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
