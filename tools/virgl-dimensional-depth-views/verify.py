#!/usr/bin/env python3
"""One frozen affected gate for original dimensional depth consumers."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
repo=Path(__file__).resolve().parents[2];base='bc2fb1e49575b8b1a399ca7729fcec4853a48287'
p=argparse.ArgumentParser();p.add_argument('--output',required=True);root=Path(p.parse_args().output).resolve();assert not root.exists();root.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest();git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
env={k:v for k,v in os.environ.items() if not k.startswith(('RUST','CARGO_','NODE_','VIRGL_','LLVM_PROFILE','npm_','NPM_')) and k not in {'CC','CXX','CFLAGS','CPPFLAGS','LDFLAGS','EMCC','EMSDK','EM_CONFIG','CHROME','PYTHONPATH','PYTHONHOME'}}
steps=[]
def run(name,command,expected=0,timeout=1200):
    print(name+': running',flush=True);start=time.monotonic();r=subprocess.run(command,cwd=repo,env=env,capture_output=True,timeout=timeout)
    for stream in ['stdout','stderr']:(root/(name+'.'+stream)).write_bytes(getattr(r,stream))
    steps.append(dict(name=name,command=command,exitCode=r.returncode,expected=expected,seconds=time.monotonic()-start,stdoutSha256=sha(r.stdout),stderrSha256=sha(r.stderr)))
    assert r.returncode==expected,(name,r.stderr[-3000:].decode(errors='replace'));print(name+': expected exit '+str(expected),flush=True)
run('policy',['python3','tools/check_task_policy.py']);run('diff-format',['git','diff','--check',base,'HEAD']);run('format',['cargo','fmt','--check','-p','wasm-vm-core','-p','wasm-vm-wasm'])
run('predecessor',['python3','tools/virgl-dimensional-depth-views/predecessor.py',str(root/'predecessor')])
assert not git('diff','--name-only',base,'--','crates','renderer/virgl-shader','Cargo.toml','Cargo.lock'),'native machine/compiler dependency is unchanged and authenticated'
run('clippy-default',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--','-D','warnings'])
run('clippy-wasm',['cargo','clippy','--offline','-p','wasm-vm-wasm','--lib','--target','wasm32-unknown-unknown','--features','virgl-control-proof','--','-D','warnings'])
for test in ['virtio_gpu_submit3d','virtio_gpu_control3d']:run('native-'+test,['cargo','test','--offline','-p','wasm-vm-core','--features','virgl-control-proof,gpu-trace,trace','--test',test,'--','--nocapture','--test-threads=1'])
for suffix,extra in [('default',[]),('selected',['--features','virgl-control-proof'])]:run('wasm-core-'+suffix,['cargo','build','--offline','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown',*extra])
run('wasm-proof',['wasm-pack','build','crates/wasm','--dev','--target','web','--out-dir','../../target/virgl-desktop-submit/pkg','--features','virgl-control-proof'])
paths=['renderer/virgl-command/'+n+'.mjs' for n in ['resources','decoder','state','control-bridge','floating-depth-gpu']]
for file in [*(repo/'tools/virgl-dimensional-depth-views').glob('*.mjs'),repo/'renderer/virgl-command/tests/native-dimensional-depth-views.mjs',*map(Path,paths)]:run('syntax-'+file.stem,['node','--check',str(file)])
run('python-syntax',['python3','-m','py_compile',*map(str,(repo/'tools/virgl-dimensional-depth-views').glob('*.py'))])
if not (repo/'web/node_modules/playwright').is_dir():run('npm-dependencies',['npm','--prefix','web','ci','--no-audit','--no-fund'])
for seed in [27449,84131,176129]:
    run('hardware-'+str(seed),['node','tools/virgl-dimensional-depth-views/browser.mjs','--output',str(root/('hardware-'+str(seed))),'--seeds',str(seed)])
    run('private-'+str(seed),['node','tools/virgl-dimensional-depth-views/private-browser.mjs','--output',str(root/('private-'+str(seed))),'--seed',str(seed)])
for mode in ['attacks','boundaries']:run(mode,['node','tools/virgl-dimensional-depth-views/browser.mjs','--output',str(root/mode),'--'+mode,'true'])
run('fault-wrong-layer',['node','tools/virgl-dimensional-depth-views/browser.mjs','--output',str(root/'fault-wrong-layer'),'--fault','true','--seeds','176129'],expected=1)
run('historical-dimensional-views',['node','tools/virgl-dimensional-views/browser.mjs','--output',str(root/'historical-dimensional-views'),'--seeds','27449','--smoke','true'])
run('historical-dimensional-depth',['node','tools/virgl-dimensional-depth/browser.mjs','--output',str(root/'historical-dimensional-depth'),'--seeds','27449','--smoke','true'])
run('historical-bindings',['node','tools/verify-virgl-shadow-samplers.mjs','--output',str(root/'historical-bindings'),'--mode','bindings','--smoke','true'])
run('physical-audit',['python3','tools/virgl-dimensional-depth-views/audit.py',str(root)])
run('coverage-audit',['python3','tools/virgl-dimensional-depth-views/coverage.py',str(root)])
run('default-build',['make','web-dist']);run('default-demo',['node','tools/verify-virgl-default-demo.mjs','--output',str(root/'default-demo'),'--task','E6-T11d60'])
assert not git('status','--porcelain','--untracked-files=no')
pins={}
for relative in git('ls-files','renderer/virgl-command','renderer/virgl-shader','crates/core','crates/wasm','tools/virgl-dimensional-depth-views','tools/verify-virgl-default-demo.mjs','tools/build-web-dist.sh','web/roadmap.js','web/dist','Makefile','Cargo.toml','Cargo.lock','AGENTS.md','tasks/epic-6-transcendence/E6-T11d60-dimensional-depth-sampler-views.md').splitlines():
    file=repo/relative
    if not file.is_file():continue
    raw=file.read_bytes();assert raw==subprocess.check_output(['git','show',head+':'+relative],cwd=repo);pins[relative]=dict(bytes=len(raw),sha256=sha(raw));dest=root/'sources'/relative;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
authentication=json.loads((root/'predecessor/authentication.json').read_bytes());coverage=json.loads((root/'coverage-audit.json').read_bytes());physical=json.loads((root/'physical-audit.json').read_bytes())
assert not coverage['needsEvidence'] and physical['completedPhysicalRefutations']==1
receipt=dict(schema='dimensional-depth-view-worker-receipt-v1',task='E6-T11d60',head=head,base=base,commands=steps,sources=pins,generated=authentication['generated'],dependencySeals=authentication['dependencies'],coverage=dict(executed=len(coverage['executed']),held=len(coverage['held']),staticWaivers=len(coverage['waived']),newExecutableGaps=0),physical=physical,actualLinuxGuest=False,productionAuthority=False)
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(status='passed',head=head,commands=len(steps),coverage=receipt['coverage'])))
