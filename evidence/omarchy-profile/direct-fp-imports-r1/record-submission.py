"""Record local risk-tier commands and exact outcomes; failed gates stay failed."""
from pathlib import Path
import os, sys, subprocess, json, hashlib, time
repo=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent
env=dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
phase=sys.argv[1]
commands={
 'ci': [('ci',['make','-k','ci'])],
 'affected': [
  ('clippy',['cargo','clippy','-p','wasm-vm-wasm','--lib','--','-D','warnings']),
  ('wasm-test-clippy',['cargo','clippy','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--lib','--test','jit_fp_direct_imports_verifier','--','-D','warnings']),
  ('wasm-native-lib',['cargo','test','-p','wasm-vm-wasm','--lib']),
  ('recorder-harness',['/Users/blamy/.nvm/versions/node/v24.20.0/bin/node','--test','tools/verify/omarchy-input-trial.test.mjs','tools/verify/omarchy-user-input.test.mjs','tools/verify/omarchy-worker-cost.test.mjs','tools/verify/omarchy-prepared-direct.test.mjs','tools/verify/omarchy-owned-trial.test.mjs','tools/verify/omarchy-desktop-live.test.mjs']),
  ('no-host-float',['bash','tools/ci/no-host-float.sh']),
  ('acceptance',['make','verify-E5_5-T03ao','DIRECT_FP_BROWSER_OUT='+str(out/'browser'),'DIRECT_FP_BENCH_OUT='+str(out/'benchmark')]),
 ],
}[phase]
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,env=env,text=True).strip()
receipt={'head':head,'wasmSha256':hashlib.sha256((repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()).hexdigest(),'phase':phase,'commands':[]}
def now():return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def save():(out/(phase+'-commands.json')).write_text(json.dumps(receipt,indent=2)+'\n')
for label,args in commands:
 row={'label':label,'args':args,'cwd':str(repo),'startedAt':now()};receipt['commands'].append(row);save()
 print(label+' started',flush=True)
 with (out/(label+'.log')).open('w') as log:
  p=subprocess.run(args,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
 row.update(code=p.returncode,finishedAt=now());save()
 print(label+' exit='+str(p.returncode),flush=True)
receipt['allPassed']=all(r['code']==0 for r in receipt['commands']);save()
print(json.dumps(receipt),flush=True)
