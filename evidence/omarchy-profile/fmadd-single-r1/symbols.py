"""Recover debug names from the existing FMADD build; never rebuild or alter the release."""
from pathlib import Path
import hashlib, json, os, subprocess, time
out=Path(__file__).resolve().parent
repo=out.parents[2]
env=dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
raw=repo/'target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm'
named=repo/'target/omarchy-fmadd-symbols'
named.mkdir(exist_ok=False)
bindgen='/Users/blamy/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126/wasm-bindgen'
opt='/Users/blamy/Library/Caches/.wasm-pack/wasm-opt-50385c9e73ccee70/bin/wasm-opt'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
receipt={'raw':{'path':str(raw.relative_to(repo)),'sha256':sha(raw)},'commands':[]}
commands=[('bindgen-version',[bindgen,'--version']),('wasmopt-version',[opt,'--version']),
 ('bindgen',[bindgen,'--target','web','--out-dir',str(named),'--out-name','wasm_vm_wasm',str(raw)]),
 ('named-companion',[opt,'-O','-g',str(named/'wasm_vm_wasm_bg.wasm'),'-o',str(named/'named.wasm')]),
 ('binding',['/Users/blamy/.nvm/versions/node/v24.20.0/bin/node',str(out/'bind-names.mjs')])]
for label,args in commands:
 row={'label':label,'args':args,'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
 receipt['commands'].append(row)
 with (out/(label+'.log')).open('w') as log:
  result=subprocess.run(args,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
 row.update(code=result.returncode,finishedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
 (out/'symbol-build.json').write_text(json.dumps(receipt,indent=2)+'\n')
 assert result.returncode==0,label
receipt['named']={'path':str((named/'named.wasm').relative_to(repo)),'sha256':sha(named/'named.wasm')}
(out/'symbol-build.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('Existing FMADD executable sections bound to current names',flush=True)
