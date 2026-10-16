#!/usr/bin/env python3
"""Frozen selected native layered transport; authenticate unchanged dependencies."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
repo=Path(__file__).resolve().parents[2]
base='98187fdf222f393af27b2307667e10427027ad46'
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
root=Path(args.output).resolve();assert not root.exists();root.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
env={k:v for k,v in os.environ.items() if not k.startswith(('CARGO_','RUST','LLVM_PROFILE','NODE_','npm_','NPM_'))}
steps=[]
def run(name,command,overrides=None,expected=0,timeout=1200):
    print(name+': running',flush=True);start=time.monotonic()
    result=subprocess.run(command,cwd=repo,env={**env,**(overrides or {})},capture_output=True,timeout=timeout)
    (root/(name+'.stdout')).write_bytes(result.stdout);(root/(name+'.stderr')).write_bytes(result.stderr)
    steps.append(dict(name=name,command=command,overrides=overrides or {},exitCode=result.returncode,expected=expected,seconds=time.monotonic()-start,stdoutSha256=sha(result.stdout),stderrSha256=sha(result.stderr)))
    assert result.returncode==expected,(name,result.stderr[-4000:].decode(errors='replace'))
    print(name+': expected exit '+str(expected),flush=True);return result
changed={'crates/core/src/dev/virtio/gpu/control3d.rs','crates/core/src/dev/virtio/gpu/submit3d.rs','crates/core/src/dev/virtio/gpu/mod.rs','crates/core/src/lib.rs','crates/wasm/src/virgl_control_proof.rs','renderer/virgl-command/state.mjs','renderer/virgl-command/control-bridge.mjs'}
dependencies=[];restored={};held={}
for family in ['virgl-native-image','virgl-dimensional-storage']:
    for role in ['worker','verifier']:
        directory=repo/'evidence'/family/role;manifest_raw=(directory/'manifest.json').read_bytes();manifest=json.loads(manifest_raw)
        index_raw=(directory/'records.json').read_bytes();index=json.loads(index_raw);assert manifest_raw==subprocess.check_output(['git','show',f'{base}:evidence/{family}/{role}/manifest.json'],cwd=repo)
        archive=directory/'recording.tar.gz';assert sha(index_raw)==manifest['recordIndexSha256'] and sha(archive.read_bytes())==manifest['archiveSha256']
        rows=index['records'] if isinstance(index,dict) else index;expected={v['path']:v for v in rows};bodies={};links={}
        with tarfile.open(archive,'r|gz') as packed:
            for member in packed:
                assert member.name in expected and member.name not in bodies and member.name not in links
                if member.isfile():bodies[member.name]=packed.extractfile(member).read()
                else:assert member.islnk();links[member.name]=member.linkname
        assert set(bodies)|set(links)==set(expected)
        def body(name,seen=None):
            if name in bodies:return bodies[name]
            seen=set() if seen is None else seen;assert name in links and name not in seen
            raw=body(links[name],seen|{name});bodies[name]=raw;return raw
        for name,pin in expected.items():
            raw=body(name);assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
            if family=='virgl-dimensional-storage' and role=='worker':
                if name.startswith('cold/recording/hardware/source/renderer/virgl-shader/build/wasm/'):
                    restored[name.removeprefix('cold/recording/hardware/source/')]=raw
                if name=='cold/recording/receipt.json':
                    receipt=json.loads(raw);held={p:v for p,v in receipt['sources'].items() if p.startswith(('crates/','renderer/')) and '/tests/' not in p and p not in changed}
                    (root/'held-dimensional-receipt.json').write_bytes(raw)
        dependencies.append(dict(family=family,role=role,manifestSha256=sha(manifest_raw),indexSha256=sha(index_raw),archiveSha256=manifest['archiveSha256'],reopenedBodies=len(rows)))
        print(f'held {family}/{role}: authenticated {len(rows)} complete bodies',flush=True);del bodies,links
assert set(restored)=={'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
for relative,raw in restored.items():
    file=repo/relative
    if file.exists():assert file.read_bytes()==raw
    else:file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
for relative,pin in held.items():assert sha((repo/relative).read_bytes())==pin['sha256'],relative
features='virgl-control-proof,gpu-trace,trace'
run('policy',['python3','tools/check_task_policy.py'])
run('format',['cargo','fmt','--check','-p','wasm-vm-core','-p','wasm-vm-wasm'])
run('clippy-default',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--','-D','warnings'])
run('clippy-selected',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--features',features,'--test','virtio_gpu_submit3d','--test','virtio_gpu_control3d','--test','virtio_gpu_machine','--','-D','warnings'])
# Historical GPU module already places service items after its test module.
# Keep that pre-existing structural lint out of the new allocator-oracle gate.
run('clippy-unit-harness',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--tests','--features',features,'--','-D','warnings','-A','clippy::items_after_test_module'])
run('clippy-wasm',['cargo','clippy','--offline','-p','wasm-vm-wasm','--lib','--target','wasm32-unknown-unknown','--features','virgl-control-proof','--','-D','warnings'])
coverage=root/'coverage';coverage.mkdir()
instrument={'RUSTFLAGS':'-C instrument-coverage','CARGO_TARGET_DIR':str(repo/'target/virgl-native-dimensional-coverage'),'LLVM_PROFILE_FILE':str(coverage/'%m-%p.profraw')}
objects=[]
for name,selector,filter_ in [('submit',['--test','virtio_gpu_submit3d'],[]),('gpu',['--lib'],['dev::virtio::gpu::'])]:
    command=['cargo','test','--offline','-p','wasm-vm-core','--features',features,*selector]
    artifact=run(name+'-artifact',command+['--no-run','--message-format=json'],instrument)
    rows=[json.loads(l) for l in artifact.stdout.splitlines() if l.startswith(b'{')]
    binaries=[v['executable'] for v in rows if v.get('executable')];assert len(binaries)==1
    binary=Path(binaries[0]);shutil.copyfile(binary,root/(name+'-test-binary'));objects.append(binary)
    run('native-'+name,command+filter_+['--','--nocapture','--test-threads=1'],instrument)
for name,test in [('control','virtio_gpu_control3d'),('machine','virtio_gpu_machine')]:
    run('native-'+name,['cargo','test','--offline','-p','wasm-vm-core','--features',features,'--test',test,'--','--nocapture','--test-threads=1'])
for suffix,extra in [('default',[]),('selected',['--features','virgl-control-proof'])]:
    run('wasm-core-'+suffix,['cargo','build','--offline','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown',*extra])
run('wasm-proof',['wasm-pack','build','crates/wasm','--dev','--target','web','--out-dir','../../target/virgl-desktop-submit/pkg','--features','virgl-control-proof'])
for name in ['renderer/virgl-command/control-bridge.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/tests/submit-acceptance.mjs','renderer/virgl-command/tests/native-dimensional-acceptance.mjs','tools/virgl-native-dimensional/browser.mjs']:
    run('syntax-'+Path(name).stem,['node','--check',name])
if not (repo/'web/node_modules/playwright').is_dir():run('npm-dependencies',['npm','--prefix','web','ci','--no-audit','--no-fund'])
run('historical-decoder',['node','tools/verify-virgl-command-decoder.mjs','--output',str(root/'historical-decoder'),'--node-only','true'])
run('historical-resources',['node','tools/verify-virgl-resource-transfers.mjs','--output',str(root/'historical-resources')])
run('historical-images',['node','tools/virgl-desktop-submit/browser.mjs','--suite','native-image','--output',str(root/'historical-images')])
run('hardware',['node','tools/virgl-native-dimensional/browser.mjs','--output',str(root/'hardware')])
run('fault-cube-layer',['node','tools/virgl-native-dimensional/browser.mjs','--output',str(root/'fault-cube-layer'),'--sabotage','cube-async-layer'],expected=1)
run('default-dist-build',['make','web-dist'])
run('default-demo',['node','tools/verify-virgl-default-demo.mjs','--output',str(root/'default-demo'),'--task','E6-T11d56'])
sysroot=Path(subprocess.check_output(['rustc','--print','sysroot'],cwd=repo,text=True).strip());host=subprocess.check_output(['rustc','-vV'],cwd=repo,text=True).split('host: ')[1].splitlines()[0];llvm=sysroot/'lib/rustlib'/host/'bin'
run('coverage-merge',[str(llvm/'llvm-profdata'),'merge','-sparse',*map(str,coverage.glob('*.profraw')),'-o',str(root/'native.profdata')])
export=run('coverage-export',[str(llvm/'llvm-cov'),'export',str(objects[0]),'-object',str(objects[1]),'--instr-profile='+str(root/'native.profdata')]);(root/'native-coverage.json').write_bytes(export.stdout)
run('native-coverage-audit',['python3','tools/virgl-native-dimensional/native-coverage.py',str(root)])
run('browser-coverage-audit',['python3','tools/virgl-native-dimensional/browser-coverage.py',str(root)])
run('integration-audit',['python3','tools/virgl-native-dimensional/audit.py',str(root)])
paths=git('ls-files','crates/core','crates/wasm','renderer/virgl-command','tools/virgl-native-dimensional','tools/virgl-dimensional-storage/fixtures.mjs','tools/virgl-command','tools/virgl-desktop-submit','web/roadmap.js','web/dist','tools/verify-virgl-default-demo.mjs','Makefile','Cargo.toml','Cargo.lock','AGENTS.md').splitlines();pins={}
for relative in paths:
    file=repo/relative
    if not file.is_file():continue
    raw=file.read_bytes();pins[relative]=dict(bytes=len(raw),sha256=sha(raw));destination=root/'sources'/relative;destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(raw)
assert not git('status','--porcelain','--untracked-files=no')
receipt=dict(schema='native-dimensional-worker-receipt-v1',task='E6-T11d56',head=head,base=base,commands=steps,sources=pins,dependencySeals=dependencies,carriedSources=held,actualLinuxGuest=False,productionAuthority=False,hardwareReportSha256=sha((root/'hardware/report.json').read_bytes()),auditSha256=sha((root/'integration-audit.json').read_bytes()))
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(status='passed',head=head,commands=len(steps))))
