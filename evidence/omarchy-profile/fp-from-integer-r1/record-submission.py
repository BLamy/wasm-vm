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
  ('clippy',['cargo','clippy','-p','wasm-vm-core','-p','wasm-vm-jit-translate','-p','wasm-vm-jit-runtime','-p','wasm-vm-wasm','--lib','--','-D','warnings']),
  ('core-handoff',['cargo','test','-p','wasm-vm-core','--features','trace','--lib','jit::tests','--','--nocapture']),
  ('fp-regression',['cargo','test','-p','wasm-vm-jit-runtime','--test','fp_moves','--test','fp_memory','--test','fp_comparisons','--test','fp_arithmetic','--test','fp_arithmetic_verifier','--test','precise_traps','--','--nocapture']),
  ('native-fp-isa',['cargo','test','-p','wasm-vm-jit-runtime','--test','jit_execution','fp_suites_verdict_identical_under_jit','--','--nocapture']),
  ('wasm-native-lib',['cargo','test','-p','wasm-vm-wasm','--lib']),
  ('no-host-float',['bash','tools/ci/no-host-float.sh']),
  ('acceptance',['make','verify-E5_5-T03x','FP_FROM_INTEGER_OUT='+str(out/'browser')]),
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
