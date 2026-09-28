"""Create an offline named companion; executable identity is checked separately."""
from pathlib import Path
import hashlib, json, os, subprocess, time

gates = Path(__file__).resolve().parent
repo = gates.parents[2]
out = repo/'target/omarchy-worker-cost-symbols'
out.mkdir(exist_ok=False)
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
bindgen = '/Users/blamy/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126/wasm-bindgen'
wasmopt = '/Users/blamy/Library/Caches/.wasm-pack/wasm-opt-50385c9e73ccee70/bin/wasm-opt'
raw = repo/'target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm'
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
receipt = {'head': subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,env=env,text=True).strip(),
           'raw': {'path': str(raw), 'sha256': sha(raw)}, 'commands': []}
for label, args in [
    ('bindgen-version', [bindgen, '--version']), ('wasmopt-version', [wasmopt, '--version']),
    ('bindgen', [bindgen, '--target','web','--out-dir',str(out),'--out-name','wasm_vm_wasm',str(raw)]),
    ('named-companion', [wasmopt, '-O','-g',str(out/'wasm_vm_wasm_bg.wasm'),'-o',str(out/'named.wasm')]),
]:
    entry={'label': label, 'args': args, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    with (gates/(label+'.log')).open('w') as log:
        result=subprocess.run(args,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
    entry.update(code=result.returncode,finishedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
    receipt['commands'].append(entry)
    (gates/'symbol-build.json').write_text(json.dumps(receipt,indent=2)+'\n')
    assert result.returncode == 0, label
receipt['named']={'path':str(out/'named.wasm'),'sha256':sha(out/'named.wasm')}
(gates/'symbol-build.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
