#!/usr/bin/env python3
"""One frozen affected gate, with complete original-byte and finest-V8 evidence."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
repo=Path(__file__).resolve().parents[2];base='deb7b3113f9adeb2e6e80449a6710dd3295093ea'
p=argparse.ArgumentParser();p.add_argument('--output',required=True);root=Path(p.parse_args().output).resolve();assert not root.exists();root.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest();git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
env={k:v for k,v in os.environ.items() if not k.startswith(('RUST','CARGO_','NODE_','VIRGL_','LLVM_PROFILE','npm_','NPM_')) and k not in {'CC','CXX','CFLAGS','CPPFLAGS','LDFLAGS','EMCC','EMSDK','EM_CONFIG','CHROME','PYTHONPATH','PYTHONHOME'}}
steps=[]
def run(name,command,overrides=None,expected=0,timeout=1000):
    print(name+': running',flush=True);start=time.monotonic();r=subprocess.run(command,cwd=repo,env={**env,**(overrides or {})},capture_output=True,timeout=timeout)
    for stream in ['stdout','stderr']:(root/(name+'.'+stream)).write_bytes(getattr(r,stream))
    steps.append(dict(name=name,command=command,overrides=overrides or {},exitCode=r.returncode,expected=expected,seconds=time.monotonic()-start,stdoutSha256=sha(r.stdout),stderrSha256=sha(r.stderr)))
    assert r.returncode==expected,(name,r.stderr[-3000:].decode(errors='replace'));print(name+': expected exit '+str(expected),flush=True)
run('policy',['python3','tools/check_task_policy.py']);run('format',['git','diff','--check',base,'HEAD'])
run('predecessor',['python3','tools/virgl-dimensional-views/predecessor.py',str(root/'predecessor')])
for name in ['constant-domain','decoder','resources','state','control-bridge']:run('syntax-'+name,['node','--check','renderer/virgl-command/'+name+'.mjs'])
for file in [*(repo/'tools/virgl-dimensional-views').glob('*.mjs'),repo/'renderer/virgl-command/tests/native-dimensional-views.mjs',repo/'renderer/virgl-command/tests/dimensional-view-owners.mjs']:run('syntax-'+file.stem,['node','--check',str(file)])
run('python-syntax',['python3','-m','py_compile',*map(str,(repo/'tools/virgl-dimensional-views').glob('*.py'))])
if not (repo/'web/node_modules/playwright').is_dir():run('npm-dependencies',['npm','--prefix','web','ci','--no-audit','--no-fund'])
run('facade',['node','tools/virgl-dimensional-views/facade.mjs',str(root/'facade'),str(root/'predecessor')],{'NODE_V8_COVERAGE':str(root/'node-coverage')})
for seed in [27449,84131,176129]:run('hardware-'+str(seed),['node','tools/virgl-dimensional-views/browser.mjs','--output',str(root/('hardware-'+str(seed))),'--seeds',str(seed)])
for mode in ['attacks','sharing','boundaries']:run(mode,['node','tools/virgl-dimensional-views/browser.mjs','--output',str(root/mode),'--'+mode,'true'])
run('fault-wrong-layer',['node','tools/virgl-dimensional-views/browser.mjs','--output',str(root/'fault-wrong-layer'),'--fault','true'],expected=1)
run('legacy-transport',['node','tools/virgl-native-dimensional/browser.mjs','--output',str(root/'legacy-transport')])
for mode in ['bindings','historical']:run('historical-'+mode,['node','tools/verify-virgl-shadow-samplers.mjs','--output',str(root/('historical-'+mode)),'--mode',mode,'--smoke','true'])
run('historical-native-image',['node','tools/virgl-desktop-submit/browser.mjs','--suite','native-image','--output',str(root/'historical-native-image')])
run('physical-audit',['python3','tools/virgl-dimensional-views/audit.py',str(root)])
run('coverage-audit',['python3','tools/virgl-dimensional-views/coverage.py',str(root)])
run('default-build',['make','web-dist']);run('default-demo',['node','tools/verify-virgl-default-demo.mjs','--output',str(root/'default-demo'),'--task','E6-T11d58'])
assert not git('status','--porcelain','--untracked-files=no')
pins={}
for relative in git('ls-files','renderer/virgl-command','tools/virgl-dimensional-views','tools/virgl-native-dimensional','tools/verify-virgl-default-demo.mjs','tools/build-web-dist.sh','tools/virgl-floating-depth-consumer/primary.json','tools/virgl-floating-depth-consumer/primary','tools/virgl-floating-depth/primary','web/roadmap.js','web/dist','Makefile','AGENTS.md','tasks/epic-6-transcendence/E6-T11d58-dimensional-sampler-views.md').splitlines():
    file=repo/relative
    if not file.is_file():continue
    raw=file.read_bytes();assert raw==subprocess.check_output(['git','show',head+':'+relative],cwd=repo);pins[relative]=dict(bytes=len(raw),sha256=sha(raw));dest=root/'sources'/relative;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
authentication=json.loads((root/'predecessor/authentication.json').read_bytes());coverage=json.loads((root/'coverage-audit.json').read_bytes());physical=json.loads((root/'physical-audit.json').read_bytes())
assert not coverage['needsEvidence'] and physical['completedPhysicalRefutations']==1
receipt=dict(schema='dimensional-view-worker-receipt-v1',task='E6-T11d58',head=head,base=base,commands=steps,sources=pins,generated=authentication['generated'],dependencySeals=authentication['dependencies'],
    coverage=dict(executed=len(coverage['executed']),held=len(coverage['held']),staticWaivers=len(coverage['waived']),newExecutableGaps=0),physical=physical,actualLinuxGuest=False,productionAuthority=False)
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(status='passed',head=head,commands=len(steps),coverage=receipt['coverage'])))
