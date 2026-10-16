#!/usr/bin/env python3
"""Record the affected host boundary, carrying authenticated native dependencies."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time

repo=Path(__file__).resolve().parents[2]
base='37a6794437424049d38acb733191a16c1cdca998'
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
root=Path(args.output).resolve();assert not root.exists(),'use a fresh evidence directory';root.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
env={k:v for k,v in os.environ.items() if not k.startswith(('CARGO_','RUST','LLVM_PROFILE','NODE_','npm_','NPM_'))}
steps=[]

def run(name,command,overrides=None,expected=0,timeout=1200):
    print(name+': running',flush=True);start=time.monotonic()
    result=subprocess.run(command,cwd=repo,env={**env,**(overrides or {})},capture_output=True,timeout=timeout)
    (root/(name+'.stdout')).write_bytes(result.stdout);(root/(name+'.stderr')).write_bytes(result.stderr)
    steps.append(dict(name=name,command=command,overrides=overrides or {},exitCode=result.returncode,expected=expected,
                      seconds=time.monotonic()-start,stdoutSha256=sha(result.stdout),stderrSha256=sha(result.stderr)))
    assert result.returncode==expected,(name,result.stderr[-3000:].decode(errors='replace'))
    print(name+': expected exit '+str(expected),flush=True)

dependencies=[];restored={};held={}
for family in ['virgl-native-image','virgl-resource-capacity']:
    for role in ['worker','verifier']:
        directory=repo/'evidence'/family/role
        manifest_raw=(directory/'manifest.json').read_bytes();manifest=json.loads(manifest_raw)
        index_raw=(directory/'records.json').read_bytes();index=json.loads(index_raw)
        assert manifest_raw==subprocess.check_output(['git','show',f'{base}:evidence/{family}/{role}/manifest.json'],cwd=repo)
        assert sha(index_raw)==manifest['recordIndexSha256']
        archive=directory/'recording.tar.gz';assert sha(archive.read_bytes())==manifest['archiveSha256']
        rows=index['records'] if isinstance(index,dict) else index;expected={v['path']:v for v in rows};bodies={};links={}
        with tarfile.open(archive,'r|gz') as packed:
            for member in packed:
                assert member.name in expected and member.name not in bodies and member.name not in links
                if member.isfile():bodies[member.name]=packed.extractfile(member).read()
                else:assert member.islnk();links[member.name]=member.linkname
        assert set(bodies)|set(links)==set(expected)
        def body(name,visited=None):
            if name in bodies:return bodies[name]
            visited=set() if visited is None else visited;assert name in links and name not in visited
            raw=body(links[name],visited|{name});bodies[name]=raw;return raw
        for name,pin in expected.items():
            raw=body(name);assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
            if family=='virgl-native-image' and role=='worker':
                prefix='cold/recording/hardware/source/'
                if name.startswith(prefix):
                    relative=name.removeprefix(prefix)
                    if relative.startswith(('target/virgl-desktop-submit/pkg/','renderer/virgl-shader/build/wasm/')):restored[relative]=raw
                if name=='cold/recording/receipt.json':
                    receipt=json.loads(raw);held={p:v for p,v in receipt['sources'].items() if p.startswith(('crates/','renderer/')) and '/tests/' not in p and p not in ['renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources-README.md']}
                    (root/'held-native-receipt.json').write_bytes(raw)
        dependencies.append(dict(family=family,role=role,manifestSha256=sha(manifest_raw),indexSha256=sha(index_raw),
                                 archiveSha256=manifest['archiveSha256'],reopenedBodies=len(rows)))
        print(f'held {family}/{role}: reopened {len(rows)} complete bodies',flush=True)
        del bodies,links
assert any(p.endswith('wasm_vm_wasm_bg.wasm') for p in restored)
for relative,raw in restored.items():
    file=repo/relative
    if file.exists():assert file.read_bytes()==raw,relative
    else:file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
for relative,pin in held.items():assert sha((repo/relative).read_bytes())==pin['sha256'],relative
# The old owner, ticket and consumer bodies are byte-for-byte unchanged. The new
# metadata and native dispatch are exercised below; inherited semantics stay HELD.
source='renderer/virgl-command/resources.mjs';old=subprocess.check_output(['git','show',base+':'+source],cwd=repo).decode();new=(repo/source).read_text()
regions=[]
for start,end in [('const resources = new Map()','const prepareTransfer ='),('const prepareTransfer =','const store ='),('attachContext: operation','return success({ store: Object.freeze(store)')]:
    def section(text):return text[text.index(start):text.index(end,text.index(start))]
    before,after=section(old),section(new);assert before==after
    regions.append(dict(source=source,start=start,end=end,bytes=len(after.encode()),sha256=sha(after.encode())))
run('policy',['python3','tools/check_task_policy.py'])
for relative in ['renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/tests/dimensional-storage-acceptance.mjs','tools/virgl-dimensional-storage/fixtures.mjs','tools/virgl-dimensional-storage/browser.mjs','tools/verify-virgl-default-demo.mjs']:
    run('syntax-'+Path(relative).stem,['node','--check',relative])
if not (repo/'web/node_modules/playwright').is_dir():run('npm-dependencies',['npm','--prefix','web','ci','--no-audit','--no-fund'])
run('historical-decoder',['node','tools/verify-virgl-command-decoder.mjs','--output',str(root/'historical-decoder'),'--node-only','true'])
run('historical-resources',['node','tools/verify-virgl-resource-transfers.mjs','--output',str(root/'historical-resources')])
run('historical-images',['node','tools/virgl-desktop-submit/browser.mjs','--suite','native-image','--output',str(root/'historical-images')])
run('hardware',['node','tools/virgl-dimensional-storage/browser.mjs','--output',str(root/'hardware')])
run('fault-cube-layer',['node','tools/virgl-dimensional-storage/browser.mjs','--output',str(root/'fault-cube-layer'),'--sabotage','cube-async-layer'],expected=1)
run('default-dist-build',['make','web-dist'])
run('default-demo',['node','tools/verify-virgl-default-demo.mjs','--output',str(root/'default-demo'),'--task','E6-T11d55'])
run('coverage-audit',['python3','tools/virgl-dimensional-storage/coverage.py',str(root)])
run('integration-audit',['python3','tools/virgl-dimensional-storage/audit.py',str(root)])
paths=git('ls-files','crates/core','crates/wasm','renderer/virgl-command','tools/virgl-dimensional-storage','tools/virgl-command','tools/virgl-desktop-submit','web/roadmap.js','web/dist','tools/verify-virgl-default-demo.mjs','Makefile','Cargo.toml','Cargo.lock','AGENTS.md').splitlines()
pins={}
for relative in paths:
    file=repo/relative
    if not file.is_file():continue
    raw=file.read_bytes();pins[relative]=dict(bytes=len(raw),sha256=sha(raw));destination=root/'sources'/relative;destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(raw)
assert not git('status','--porcelain','--untracked-files=no')
receipt=dict(schema='dimensional-storage-worker-receipt-v1',task='E6-T11d55',head=head,base=base,commands=steps,sources=pins,
             dependencySeals=dependencies,carriedSources=held,carriedOwnerRegions=regions,guestExecution=False,productionAuthority=False,
             hardwareReportSha256=sha((root/'hardware/report.json').read_bytes()),auditSha256=sha((root/'integration-audit.json').read_bytes()))
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(status='passed',head=head,commands=len(steps))))
