from pathlib import Path
import os, subprocess, tempfile, json, hashlib, time
repo=Path(__file__).resolve().parents[4]
out=repo/'evidence/omarchy-profile/fp-comparisons-r1/cold'
out.mkdir(exist_ok=True)
env=dict(os.environ)
scrubbed=[]
for key in list(env):
 if key.startswith('CARGO_') or key in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG'):
  scrubbed.append(key); del env[key]
env['DEVELOPER_DIR']='/Library/Developer/CommandLineTools'
env['PATH']=str(Path.home()/'.cargo/bin')+':/usr/bin:/bin:/usr/sbin:/sbin:'+env['PATH']
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,env=env,text=True).strip()
root=Path(tempfile.mkdtemp(prefix='wasm-vm-fp-comparisons-cold-',dir='/private/tmp'))
clone=root/'repo'
receipt={'head':head,'clone':str(clone),'scrubbedNames':scrubbed,'policy':'RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG and all CARGO_* unset; trusted PATH; no shell profiles','commands':[]}
def save(): (out/'report.json').write_text(json.dumps(receipt,indent=2)+'\n')
def run(args,cwd,label):
 row={'args':args,'cwd':str(cwd),'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}; receipt['commands'].append(row); save()
 print(label,flush=True)
 with (out/(label+'.log')).open('w') as log:
  result=subprocess.run(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 row.update(code=result.returncode,finishedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()));save()
 if result.returncode: raise RuntimeError(label+' failed: '+str(result.returncode))
try:
 run(['git','clone','--quiet',str(repo),str(clone)],root,'clone')
 run(['git','checkout','--quiet',head],clone,'checkout')
 clean=subprocess.check_output(['git','status','--porcelain'],cwd=clone,env=env,text=True)
 assert clean=='',clean
 receipt['pristineBeforeBuild']=True
 expected=hashlib.sha256((clone/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()).hexdigest()
 receipt['committedWasmSha256']=expected;save()
 run(['make','web-dist'],clone,'build')
 actual=hashlib.sha256((clone/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()).hexdigest()
 receipt['rebuiltWasmSha256']=actual
 assert actual==expected, (actual,expected)
 run(['make','verify-E5_5-T03v','FP_COMPARISONS_OUT='+str(out/'browser')],clone,'acceptance')
 receipt['passed']=True
finally:
 save()
print(json.dumps(receipt),flush=True)
