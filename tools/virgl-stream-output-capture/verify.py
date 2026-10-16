"""Final affected high-risk submission at an immutable committed head."""
import hashlib,json,os,subprocess,time,re
from pathlib import Path
import argparse
repo=Path(__file__).resolve().parents[2];p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--carry-from');args=p.parse_args();root=Path(args.output).resolve();assert not root.exists();root.mkdir(parents=True)
git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True).strip();head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
sha=lambda b:hashlib.sha256(b).hexdigest();env={k:v for k,v in os.environ.items() if not k.startswith(('CARGO_','RUST','LLVM_PROFILE','VIRGL_','NODE_','npm_','NPM_','CHROME')) and k not in {'CC','CXX','CFLAGS','CPPFLAGS','LDFLAGS','EMCC','EM_CONFIG','EMSDK','PYTHONPATH','PYTHONHOME'}};steps=[]
def run(name,command,expected=0,overrides=None,timeout=1800):
    print(name+': running',flush=True);start=time.monotonic();r=subprocess.run(command,cwd=repo,env={**env,**(overrides or {})},capture_output=True,timeout=timeout)
    for suffix,body in [('stdout',r.stdout),('stderr',r.stderr)]:(root/(name+'.'+suffix)).write_bytes(body)
    steps.append(dict(name=name,command=command,expected=expected,exitCode=r.returncode,seconds=time.monotonic()-start,stdoutSha256=sha(r.stdout),stderrSha256=sha(r.stderr)));(root/'commands.json').write_text(json.dumps(steps,indent=2)+'\n');assert r.returncode==expected,(name,r.stderr[-4000:].decode(errors='replace'));print(name+': passed',flush=True);return r
carried=None
if args.carry_from:
    from incremental import authenticate
    carried=authenticate(repo,root,Path(args.carry_from).resolve(),head)
run('policy',['python3','tools/check_task_policy.py']);run('diff',['git','diff','--check','967826b1539c3099b2da5952a553c282b0428d35','HEAD']);run('predecessor',['python3','tools/virgl-stream-output-capture/predecessor.py',str(root/'predecessor')])
if not carried:
    run('format',['cargo','fmt','--check','-p','wasm-vm-core','-p','wasm-vm-wasm']);run('clippy-default',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--','-D','warnings']);run('clippy-selected',['cargo','clippy','--offline','-p','wasm-vm-wasm','--lib','--target','wasm32-unknown-unknown','--features','virgl-control-proof','--','-D','warnings'])
    run('native-metadata',['cargo','test','--offline','-p','wasm-vm-core','--features','virgl-control-proof,gpu-trace,trace','--lib','dev::virtio::gpu::control3d','--','--nocapture','--test-threads=1'])
    for test in ['virtio_gpu_control3d','virtio_gpu_submit3d']:run('native-'+test,['cargo','test','--offline','-p','wasm-vm-core','--features','virgl-control-proof,gpu-trace,trace','--test',test,'--','--nocapture','--test-threads=1'])
    for name,features in [('default',[]),('selected',['--features','virgl-control-proof'])]:run('wasm-core-'+name,['cargo','build','--offline','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown',*features])
run('wasm-proof',['wasm-pack','build','crates/wasm','--dev','--target','web','--out-dir','../../target/virgl-desktop-submit/pkg','--features','virgl-control-proof'])
emcc=run('pinned-emcc',['bash','tools/setup-virgl-emsdk.sh']).stdout.decode().strip();assert emcc
run('compiler-fresh',['bash','renderer/virgl-shader/build.sh','wasm'],overrides={'EMCC':emcc})
if not (repo/'web/node_modules/playwright').is_dir():run('npm',['npm','--prefix','web','ci','--no-audit','--no-fund'])
for file in [*(repo/'tools/virgl-stream-output-capture').glob('*.mjs'),*(repo/'renderer/virgl-command').glob('*.mjs'),*(repo/'renderer/virgl-command/tests').glob('native-stream-output-*.mjs')]:run('syntax-'+file.stem,['node','--check',str(file)])
run('cases',['node','tools/virgl-stream-output-capture/cases.mjs'],overrides={'NODE_V8_COVERAGE':str(root/'node-coverage')})
if carried:
    import shutil
    for mode in ['layouts','primitives','scatter-fault','selected-regression']: shutil.copytree(Path(args.carry_from)/'recording'/mode,root/mode)
    run('retirement',['node','tools/virgl-stream-output-capture/retirement-browser.mjs','--output',str(root/'retirement'),'--seeds','0,1,2'])
else:
    for mode,script,extra,expected in [('layouts','browser.mjs',[],0),('primitives','primitives-browser.mjs',[],0),('retirement','retirement-browser.mjs',[],0),('scatter-fault','primitives-browser.mjs',['--fault','true'],1),('selected-regression','regression-browser.mjs',[],0)]:
        run(mode,['node','tools/virgl-stream-output-capture/'+script,'--output',str(root/mode),'--seeds','0,1,2' if mode=='retirement' else '171281' if mode in ['scatter-fault','selected-regression'] else '54831,90107,171281',*extra],expected=expected)
run('audit',['python3','tools/virgl-stream-output-capture/audit.py',str(root)])
run('default-dist',['make','web-dist']);run('default-demo',['node','tools/verify-virgl-default-demo.mjs','--output',str(root/'default-demo'),'--task','E6-T11d66'])
assert not git('status','--porcelain','--untracked-files=no')
sources={}
for n in git('ls-files','renderer/virgl-command','renderer/virgl-shader','tools/virgl-stream-output-capture','tools/verify-virgl-default-demo.mjs','crates/core','crates/wasm','Cargo.toml','Cargo.lock','Makefile','AGENTS.md','web/roadmap.js','web/dist','tasks/epic-6-transcendence/E6-T11d66-stream-output-capture.md').splitlines():
    f=repo/n
    if not f.is_file():continue
    b=f.read_bytes();assert b==subprocess.check_output(['git','show',head+':'+n],cwd=repo);sources[n]=dict(bytes=len(b),sha256=sha(b));dest=root/'sources'/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
receipt=dict(schema='stream-output-capture-worker-v1',task='E6-T11d66',head=head,base='967826b1539c3099b2da5952a553c282b0428d35',commands=steps,sources=sources,predecessors=json.loads((root/'predecessor/authentication.json').read_text()),audit=json.loads((root/'audit.json').read_text()),carried=carried,actualLinuxGuest=False,productionAuthority=False)
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'status':'passed','head':head,'commands':len(steps)}))
