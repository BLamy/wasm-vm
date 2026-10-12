#!/usr/bin/env python3
"""Frozen affected native/Wasm/hardware gate for original layered depth DMA."""
import argparse,hashlib,json,os,shutil,subprocess,time
from pathlib import Path
repo=Path(__file__).resolve().parents[2];base='fa4692ab33c0bd91e4d2cedddc8003df29354108'
p=argparse.ArgumentParser();p.add_argument('--output',required=True);root=Path(p.parse_args().output).resolve();assert not root.exists();root.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest();git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
env={k:v for k,v in os.environ.items() if not k.startswith(('RUST','CARGO_','NODE_','VIRGL_','LLVM_PROFILE','npm_','NPM_')) and k not in {'CC','CXX','CFLAGS','CPPFLAGS','LDFLAGS','EMCC','EMSDK','EM_CONFIG','CHROME','PYTHONPATH','PYTHONHOME'}}
steps=[]
def run(name,command,overrides=None,expected=0,timeout=1200):
    print(name+': running',flush=True);start=time.monotonic();r=subprocess.run(command,cwd=repo,env={**env,**(overrides or {})},capture_output=True,timeout=timeout)
    for stream in ['stdout','stderr']:(root/(name+'.'+stream)).write_bytes(getattr(r,stream))
    steps.append(dict(name=name,command=command,overrides=overrides or {},exitCode=r.returncode,expected=expected,seconds=time.monotonic()-start,stdoutSha256=sha(r.stdout),stderrSha256=sha(r.stderr)))
    assert r.returncode==expected,(name,r.stderr[-3000:].decode(errors='replace'));print(name+': expected exit '+str(expected),flush=True);return r
features='virgl-control-proof,gpu-trace,trace'
run('policy',['python3','tools/check_task_policy.py']);run('diff-format',['git','diff','--check',base,'HEAD'])
run('format',['cargo','fmt','--check','-p','wasm-vm-core','-p','wasm-vm-wasm'])
run('predecessor',['python3','tools/virgl-dimensional-depth/predecessor.py',str(root/'predecessor')])
run('clippy-default',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--','-D','warnings'])
run('clippy-selected',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--features',features,'--test','virtio_gpu_submit3d','--test','virtio_gpu_control3d','--test','virtio_gpu_machine','--','-D','warnings'])
run('clippy-unit',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--tests','--features',features,'--','-D','warnings','-A','clippy::items_after_test_module'])
run('clippy-wasm',['cargo','clippy','--offline','-p','wasm-vm-wasm','--lib','--target','wasm32-unknown-unknown','--features','virgl-control-proof','--','-D','warnings'])
coverage=root/'coverage';coverage.mkdir();instrument={'RUSTFLAGS':'-C instrument-coverage','CARGO_TARGET_DIR':str(repo/'target/virgl-dimensional-depth-coverage'),'LLVM_PROFILE_FILE':str(coverage/'%m-%p.profraw')};objects=[]
for name,selector,filter_ in [('submit',['--test','virtio_gpu_submit3d'],[]),('gpu',['--lib'],['dev::virtio::gpu::'])]:
    command=['cargo','test','--offline','-p','wasm-vm-core','--features',features,*selector]
    artifact=run(name+'-artifact',command+['--no-run','--message-format=json'],instrument)
    rows=[json.loads(l) for l in artifact.stdout.splitlines() if l.startswith(b'{')];binaries=[v['executable'] for v in rows if v.get('executable')];assert len(binaries)==1
    binary=Path(binaries[0]);shutil.copyfile(binary,root/(name+'-test-binary'));objects.append(binary)
    run('native-'+name,command+filter_+['--','--nocapture','--test-threads=1'],instrument)
for name,test in [('control','virtio_gpu_control3d'),('machine','virtio_gpu_machine')]:run('native-'+name,['cargo','test','--offline','-p','wasm-vm-core','--features',features,'--test',test,'--','--nocapture','--test-threads=1'])
for suffix,extra in [('default',[]),('selected',['--features','virgl-control-proof'])]:run('wasm-core-'+suffix,['cargo','build','--offline','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown',*extra])
run('wasm-proof',['wasm-pack','build','crates/wasm','--dev','--target','web','--out-dir','../../target/virgl-desktop-submit/pkg','--features','virgl-control-proof'])
paths=['renderer/virgl-command/'+n+'.mjs' for n in ['resources','control-bridge','floating-depth-gpu','dimensional-depth-images']]
for file in [*(repo/'tools/virgl-dimensional-depth').glob('*.mjs'),*(repo/'renderer/virgl-command/tests').glob('*dimensional-depth*.mjs'),*map(Path,paths)]:run('syntax-'+file.stem,['node','--check',str(file)])
run('python-syntax',['python3','-m','py_compile',*map(str,(repo/'tools/virgl-dimensional-depth').glob('*.py'))])
if not (repo/'web/node_modules/playwright').is_dir():run('npm-dependencies',['npm','--prefix','web','ci','--no-audit','--no-fund'])
run('historical-decoder',['node','tools/verify-virgl-command-decoder.mjs','--output',str(root/'historical-decoder'),'--node-only','true'])
run('historical-resources',['node','tools/verify-virgl-resource-transfers.mjs','--output',str(root/'historical-resources')])
run('hardware',['node','tools/virgl-dimensional-depth/browser.mjs','--output',str(root/'hardware')])
run('fault-wrong-layer',['node','tools/virgl-dimensional-depth/browser.mjs','--output',str(root/'fault-wrong-layer'),'--fault','true','--seeds','27449','--smoke','true'],expected=1)
run('historical-dimensional-views',['node','tools/virgl-dimensional-views/browser.mjs','--output',str(root/'historical-dimensional-views'),'--seeds','27449','--smoke','true'])
run('historical-native-image',['node','tools/virgl-desktop-submit/browser.mjs','--suite','native-image','--output',str(root/'historical-native-image')])
sysroot=Path(subprocess.check_output(['rustc','--print','sysroot'],cwd=repo,text=True).strip());host=subprocess.check_output(['rustc','-vV'],cwd=repo,text=True).split('host: ')[1].splitlines()[0];llvm=sysroot/'lib/rustlib'/host/'bin'
run('coverage-merge',[str(llvm/'llvm-profdata'),'merge','-sparse',*map(str,coverage.glob('*.profraw')),'-o',str(root/'native.profdata')])
export=run('coverage-export',[str(llvm/'llvm-cov'),'export',str(objects[0]),'-object',str(objects[1]),'--instr-profile='+str(root/'native.profdata')]);(root/'native-coverage.json').write_bytes(export.stdout)
run('native-coverage',['python3','tools/virgl-dimensional-depth/native-coverage.py',str(root)])
run('browser-coverage',['python3','tools/virgl-dimensional-depth/coverage.py',str(root)])
run('physical-audit',['python3','tools/virgl-dimensional-depth/audit.py',str(root)])
run('default-build',['make','web-dist']);run('default-demo',['node','tools/verify-virgl-default-demo.mjs','--output',str(root/'default-demo'),'--task','E6-T11d59'])
assert not git('status','--porcelain','--untracked-files=no');pins={}
for relative in git('ls-files','crates/core','crates/wasm','renderer/virgl-command','tools/virgl-dimensional-depth','tools/virgl-dimensional-views','tools/verify-virgl-default-demo.mjs','tools/build-web-dist.sh','web/roadmap.js','web/dist','Makefile','Cargo.toml','Cargo.lock','AGENTS.md','tasks/epic-6-transcendence/E6-T11d59-dimensional-depth-transfers.md').splitlines():
    file=repo/relative
    if not file.is_file():continue
    raw=file.read_bytes();assert raw==subprocess.check_output(['git','show',head+':'+relative],cwd=repo);pins[relative]=dict(bytes=len(raw),sha256=sha(raw));dest=root/'sources'/relative;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
authentication=json.loads((root/'predecessor/authentication.json').read_bytes());coverage=json.loads((root/'coverage-audit.json').read_bytes());physical=json.loads((root/'physical-audit.json').read_bytes())
assert not coverage['needsEvidence'] and physical['completedPhysicalRefutations']==1
receipt=dict(schema='dimensional-depth-worker-receipt-v1',task='E6-T11d59',head=head,base=base,commands=steps,sources=pins,generated=authentication['generated'],dependencySeals=authentication['dependencies'],coverage=dict(executed=len(coverage['executed']),held=len(coverage['held']),staticWaivers=len(coverage['waived']),newExecutableGaps=0),physical=physical,actualLinuxGuest=False,productionAuthority=False)
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(status='passed',head=head,commands=len(steps),coverage=receipt['coverage'])))
