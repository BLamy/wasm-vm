#!/usr/bin/env python3
"""One frozen affected gate for original dimensional depth consumers."""
import argparse,hashlib,json,os,shutil,subprocess,time
from pathlib import Path
repo=Path(__file__).resolve().parents[2];base='bc2fb1e49575b8b1a399ca7729fcec4853a48287'
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--carry',default=os.environ.get('VIRGL_DIMENSIONAL_DEPTH_VIEW_CARRY_DIR'));args=p.parse_args();root=Path(args.output).resolve();assert not root.exists();root.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest();git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
env={k:v for k,v in os.environ.items() if not k.startswith(('RUST','CARGO_','NODE_','VIRGL_','LLVM_PROFILE','npm_','NPM_')) and k not in {'CC','CXX','CFLAGS','CPPFLAGS','LDFLAGS','EMCC','EMSDK','EM_CONFIG','CHROME','PYTHONPATH','PYTHONHOME'}}
steps=[];carried=[];carry=None
first_carry_names={'format','clippy-default','clippy-wasm','native-virtio_gpu_submit3d','native-virtio_gpu_control3d','wasm-core-default','wasm-core-selected','wasm-proof','hardware-27449'}
carry_names=first_carry_names|{'hardware-84131','hardware-176129','private-27449','private-84131','private-176129','attacks','boundaries','fault-wrong-layer','historical-dimensional-views','historical-dimensional-depth','historical-bindings'}
origins={}
def retain_file(source,destination):
    try:os.link(source,destination)
    except OSError:shutil.copy2(source,destination)
    return destination
if args.carry:
    previous=Path(args.carry).resolve();prior=json.loads((previous/'report.json').read_bytes());assert prior['exitCode']==2 and not prior['cleanBefore'] and not prior['cleanAfter'];assert Path(prior['clone']).resolve()==repo.resolve()
    changed=git('diff','--name-only',prior['head'],head).splitlines();allowed={'tools/virgl-dimensional-depth-views/private-browser.mjs','tools/virgl-dimensional-depth-views/audit.py','tools/virgl-dimensional-depth-views/verify.py','tools/virgl-dimensional-depth-views/cold.py','tools/virgl-dimensional-depth-views/seal.py'};assert set(changed)<=allowed,changed
    assert not git('diff','--name-only',prior['head'],head,'--','crates','renderer','Cargo.toml','Cargo.lock','web')
    carry=root/'carried';shutil.copytree(previous,carry,copy_function=retain_file);prior_stdout=(carry/'cold.stdout').read_text();old_recording=carry/'recording'
    for name in carry_names:assert name+': expected exit '+str(1 if name=='fault-wrong-layer' else 0) in prior_stdout,name
    earlier=json.loads((old_recording/'carried-source-boundary.json').read_bytes()) if (old_recording/'carried-source-boundary.json').exists() else None
    old_origins=json.loads((old_recording/'carried-command-provenance.json').read_bytes()) if (old_recording/'carried-command-provenance.json').exists() else {}
    for name in carry_names:
        if name in old_origins:origins[name]=old_origins[name]
        else:
            boundary=earlier if earlier and name in first_carry_names else prior
            origins[name]=dict(head=boundary['head'],evidenceOutput=boundary.get('originalEvidenceOutput',boundary.get('evidenceOutput')),stdoutSha256=sha((old_recording/(name+'.stdout')).read_bytes()),stderrSha256=sha((old_recording/(name+'.stderr')).read_bytes()))
        assert origins[name]['stdoutSha256']==sha((old_recording/(name+'.stdout')).read_bytes()) and origins[name]['stderrSha256']==sha((old_recording/(name+'.stderr')).read_bytes())
        directory=old_recording/name
        if directory.is_dir():
            shutil.copytree(directory,root/name,copy_function=retain_file)
            if (directory/'report.json').exists():
                body=(directory/'report.json').read_bytes();record=json.loads(body)
                if 'head' in record:assert record['head']==origins[name]['head'],(name,record['head'],origins[name])
                origins[name]['reportSha256']=sha(body)
    source=dict(head=prior['head'],newHead=head,changedHarnessFiles=changed,originalClone=prior['clone'],originalEvidenceOutput=prior['evidenceOutput'],reportSha256=sha((carry/'report.json').read_bytes()),unchangedRuntime=True)
    (root/'carried-source-boundary.json').write_text(json.dumps(source,indent=2)+'\n')
    (root/'carried-command-provenance.json').write_text(json.dumps(origins,indent=2)+'\n')
def run(name,command,expected=0,timeout=1200):
    print(name+': running',flush=True);start=time.monotonic()
    if carry and name in carry_names:
        r=subprocess.CompletedProcess(command,expected,(old_recording/(name+'.stdout')).read_bytes(),(old_recording/(name+'.stderr')).read_bytes());carried.append(name)
    else:r=subprocess.run(command,cwd=repo,env=env,capture_output=True,timeout=timeout)
    for stream in ['stdout','stderr']:(root/(name+'.'+stream)).write_bytes(getattr(r,stream))
    steps.append(dict(name=name,command=command,exitCode=r.returncode,expected=expected,seconds=time.monotonic()-start,stdoutSha256=sha(r.stdout),stderrSha256=sha(r.stderr)))
    if name in carried:steps[-1].update(carriedFromHead=origins[name]['head'],carriedFromReportSha256=source['reportSha256'],actualCommand=[v.replace(str(root),origins[name]['evidenceOutput']) for v in command],originalSeconds=None)
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
receipt['carriedCommands']=carried
if carry:receipt['carriedSourceBoundary']=source
if carry:receipt['carriedCommandOrigins']=origins
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(status='passed',head=head,commands=len(steps),coverage=receipt['coverage'])))
