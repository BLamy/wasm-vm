"""Record frozen high-risk snapshot checks; preserve failed inherited gates."""
from pathlib import Path
import os,sys,json,hashlib,subprocess,time
repo=Path(__file__).resolve().parents[3];out=Path(__file__).resolve().parent
phase=sys.argv[1];env=dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
node='/Users/blamy/.nvm/versions/node/v24.20.0/bin/node'
commands={
 'affected':[
  ('fmt',['cargo','fmt','--all','--check']),
  ('core-clippy',['cargo','clippy','-p','wasm-vm-core','--lib','--tests','--','-D','warnings']),
  ('wasm-clippy',['cargo','clippy','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--','-D','warnings']),
  ('resume-format',['cargo','test','-p','wasm-vm-core','--lib','resume::','--','--nocapture']),
  ('resume-machines',['cargo','test','-p','wasm-vm-core','--test','cpu_resume','--test','snapshot_coherence','--test','virtio_blk_quiesce','--test','guest_clock','--test','desktop_machine_resume','--test','desktop_machine_resume_verifier','--test','desktop_machine_audio_resume','--test','virtio_console','--','--nocapture']),
  ('wasm-native-lib',['cargo','test','-p','wasm-vm-wasm','--lib']),
  ('harness-syntax',[node,'--check','tools/verify/omarchy-snapshot-allocation.mjs']),
 ],
 'browser':[('browser',[node,'tools/verify/omarchy-snapshot-allocation.mjs','evidence/omarchy-profile/snapshot-allocation-r1'])],
 'ci':[('ci',['make','-k','ci'])],
}[phase]
receipt={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,env=env,text=True).strip(),'phase':phase,
 'wasmSha256':hashlib.sha256((repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()).hexdigest(),'commands':[]}
def now():return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def save():(out/(phase+'-commands.json')).write_text(json.dumps(receipt,indent=2)+'\n')
assert not (out/(phase+'-commands.json')).exists(),'do not overwrite evidence'
for label,args in commands:
 row={'label':label,'args':args,'startedAt':now()};receipt['commands'].append(row);save();print(label+' started',flush=True)
 with (out/(label+'.log')).open('x') as log:p=subprocess.run(args,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
 row.update(code=p.returncode,finishedAt=now());save();print(label+' exit='+str(p.returncode),flush=True)
receipt['allPassed']=all(x['code']==0 for x in receipt['commands']);save()
if not receipt['allPassed']:raise SystemExit(1)
