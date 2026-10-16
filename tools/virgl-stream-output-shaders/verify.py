"""Frozen affected C/Wasm gates, actual native GPU captures, and full custody."""
import argparse,hashlib,json,os,re,shutil,subprocess,time
from pathlib import Path
repo=Path(__file__).resolve().parents[2];base='6f43010dfa7b3e08bfe62f62543b7ee0468e1a21'
p=argparse.ArgumentParser();p.add_argument('--output',required=True);root=Path(p.parse_args().output).resolve();assert not root.exists();root.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
env={k:v for k,v in os.environ.items() if not k.startswith(('CARGO_','RUST','LLVM_PROFILE','NODE_','VIRGL_','npm_','NPM_')) and k not in {'CC','CXX','CFLAGS','CPPFLAGS','LDFLAGS','EMCC','EMSDK','EM_CONFIG','CHROME','PYTHONPATH','PYTHONHOME'}}
steps=[]
def run(name,command,overrides=None,expected=0,cwd=repo,timeout=1200):
    print(name+': running',flush=True);start=time.monotonic();r=subprocess.run(command,cwd=cwd,env={**env,**(overrides or {})},capture_output=True,timeout=timeout)
    (root/(name+'.stdout')).write_bytes(r.stdout);(root/(name+'.stderr')).write_bytes(r.stderr)
    steps.append(dict(name=name,command=command,cwd=str(cwd),overrides=overrides or {},exitCode=r.returncode,expected=expected,seconds=time.monotonic()-start,stdoutSha256=sha(r.stdout),stderrSha256=sha(r.stderr)));(root/'commands.json').write_text(json.dumps(steps,indent=2)+'\n')
    assert r.returncode==expected,(name,r.stderr[-3000:].decode(errors='replace'));print(name+': expected exit '+str(expected),flush=True);return r
run('policy',['python3','tools/check_task_policy.py']);run('diff-format',['git','diff','--check',base,'HEAD'])
run('predecessor',['python3','tools/virgl-stream-output-shaders/predecessor.py',str(root)])
if not (repo/'web/node_modules/playwright').is_dir():run('npm-dependencies',['npm','--prefix','web','ci','--no-audit','--no-fund'])
emcc=run('pinned-emcc',['bash','tools/setup-virgl-emsdk.sh']).stdout.decode().strip();assert emcc
compiler_env={'EMCC':emcc,'ASAN_OPTIONS':'abort_on_error=1','UBSAN_OPTIONS':'halt_on_error=1'}
for f in [repo/'renderer/virgl-shader/standard.mjs',*(repo/'tools/virgl-stream-output-shaders').glob('*.mjs')]:run('syntax-'+f.stem,['node','--check',str(f)])
run('python-syntax',['python3','-m','py_compile',*map(str,(repo/'tools/virgl-stream-output-shaders').glob('*.py'))]);run('build-syntax',['bash','-n','renderer/virgl-shader/build.sh'])
run('cases',['node','tools/virgl-stream-output-shaders/compiler.mjs','cases',str(root/'native')]);coverage=root/'coverage';coverage.mkdir()
for mode in ['native','sanitize']:
    run(mode+'-build',['bash','renderer/virgl-shader/build.sh','standard-stream-output-'+mode],compiler_env)
    r=run(mode,['renderer/virgl-shader/build/standard-stream-output-'+mode+'/standard-stream-output-test',str(root/'native/cases.bin')],{**compiler_env,'LLVM_PROFILE_FILE':str(coverage/'matrix.profraw')});(root/'native'/('native.jsonl' if mode=='native' else 'sanitize.jsonl')).write_bytes(r.stdout)
assert (root/'native/native.jsonl').read_bytes()==(root/'native/sanitize.jsonl').read_bytes()
run('allocation-build',['bash','renderer/virgl-shader/build.sh','standard-stream-output-allocation-sanitize'],compiler_env)
r=run('allocations',['renderer/virgl-shader/build/standard-stream-output-allocation-sanitize/standard-stream-output-allocation-test'],{**compiler_env,'LLVM_PROFILE_FILE':str(coverage/'allocations.profraw')});(root/'native/allocations.jsonl').write_bytes(r.stdout)
run('historical-cases',['node','tools/virgl-dimensional-shadow-shaders/compiler.mjs','cases',str(root/'historical')])
for name,mode,cwd in [('historical-baseline','native',root/'baseline'),('historical-current','native',repo),('historical-sanitize','sanitize',repo)]:
    run(name+'-build',['bash','renderer/virgl-shader/build.sh','standard-dimensional-shadow-texture-'+mode],compiler_env,cwd=cwd)
    r=run(name,[str(cwd/'renderer/virgl-shader/build'/('standard-dimensional-shadow-texture-'+mode)/'standard-dimensional-shadow-texture-test'),str(root/'historical/cases.bin')],{**compiler_env,'LLVM_PROFILE_FILE':str(coverage/'historical.profraw')},cwd=cwd);(root/'historical'/('baseline-native.jsonl' if name=='historical-baseline' else 'current-native.jsonl' if name=='historical-current' else 'sanitize.jsonl')).write_bytes(r.stdout)
assert (root/'historical/baseline-native.jsonl').read_bytes()==(root/'historical/current-native.jsonl').read_bytes()==(root/'historical/sanitize.jsonl').read_bytes()
run('profile',['xcrun','llvm-profdata','merge','-sparse',*map(str,coverage.glob('*.profraw')),'-o',str(coverage/'native.profdata')])
r=run('native-coverage',['xcrun','llvm-cov','export','renderer/virgl-shader/build/standard-stream-output-sanitize/standard-stream-output-test','-object=renderer/virgl-shader/build/standard-stream-output-allocation-sanitize/standard-stream-output-allocation-test','-object=renderer/virgl-shader/build/standard-dimensional-shadow-texture-sanitize/standard-dimensional-shadow-texture-test','-instr-profile='+str(coverage/'native.profdata')]);(coverage/'native.json').write_bytes(r.stdout)
run('wasm-stack',['bash','renderer/virgl-shader/build.sh','standard-wasm-stack'],compiler_env);(root/'stack').mkdir()
for f in (repo/'renderer/virgl-shader/build/standard-wasm-stack').glob('*.su'):shutil.copyfile(f,root/'stack'/f.name)
run('wasm-build',['bash','renderer/virgl-shader/build.sh','wasm'],compiler_env)
run('historical-wasm-build',['bash','renderer/virgl-shader/build.sh','wasm'],compiler_env,cwd=root/'baseline')
(root/'node-coverage').mkdir()
for mode,directory in [('audit',root/'native'),('facade',root/'native'),('historical',root)]:run('wasm-'+mode,['node','tools/virgl-stream-output-shaders/compiler.mjs',mode,str(directory)],{'NODE_V8_COVERAGE':str(root/'node-coverage')})
for seed in [54831,90107,171281]:run('hardware-'+str(seed),['node','tools/virgl-stream-output-shaders/browser.mjs','--output',str(root/('hardware-'+str(seed))),'--seed',str(seed)])
run('fault-varying-order',['node','tools/virgl-stream-output-shaders/browser.mjs','--output',str(root/'fault-varying-order'),'--seed','54831','--fault','varying-order'],expected=1)
run('physical-audit',['python3','tools/virgl-stream-output-shaders/audit.py',str(root)]);run('coverage-audit',['python3','tools/virgl-stream-output-shaders/coverage.py',str(root)])
cov=json.loads((root/'coverage-audit.json').read_bytes());assert not cov['zero'] and not cov['nativeZero'],'changed executable region needs evidence'
alloc=[json.loads(line) for line in (root/'native/allocations.jsonl').read_text().splitlines()];assert alloc[-1]['faults']==alloc[-1]['recoveries']==181
frames={}
for f in (root/'stack').glob('*.su'):
    for line in f.read_text().splitlines():
        fields=line.split('\t');frames[fields[0].rsplit(':',1)[-1]]=int(fields[1])
stack={}
for mode in ['stage','pair']:
    names=['bridge_translate_standard_stream_output'+('_pair' if mode=='pair' else ''),'standard_'+mode+'_layout','standard_convert','vrend_convert_shader','standard_emit','standard_stream_output_validate'];assert all(n in frames for n in names),names;sizes={n:frames[n] for n in names};assert sum(sizes.values())<262144;stack[mode]=dict(frames=sizes,selectedFrameSumBytes=sum(sizes.values()),limitBytes=262144,unchangedDependencyBoundary=base)
run('default-dist-build',['make','web-dist']);run('default-demo',['node','tools/verify-virgl-default-demo.mjs','--output',str(root/'default-demo'),'--task','E6-T11d65'])
assert not git('status','--porcelain','--untracked-files=no')
paths=set(git('ls-files','renderer/virgl-shader','tools/virgl-stream-output-shaders','tools/virgl-dimensional-shadow-shaders','tools/virgl-dimensional-depth-surfaces/custody.py','tools/setup-virgl-emsdk.sh','tools/build-web-dist.sh','tools/verify-virgl-default-demo.mjs','web/roadmap.js','web/dist','Makefile','AGENTS.md','tasks/epic-6-transcendence/E6-T11d65-stream-output-shaders.md').splitlines());pending=[repo/n for n in paths if n.endswith('.mjs')];seen=set()
while pending:
    f=pending.pop().resolve()
    if f in seen:continue
    seen.add(f)
    for ref in re.findall(r"(?:from\s+|import\s*)['\"]([^'\"]+)['\"]",f.read_text()):
        if ref.startswith('.'):
            dependency=(f.parent/ref).resolve()
            if 'build/wasm' in str(dependency):continue
            assert dependency.is_file() and dependency.is_relative_to(repo);paths.add(dependency.relative_to(repo).as_posix())
            if dependency.suffix in ['.mjs','.js']:pending.append(dependency)
sources={}
for name in sorted(paths):
    f=repo/name
    if not f.is_file():continue
    body=f.read_bytes();assert body==subprocess.check_output(['git','show',head+':'+name],cwd=repo);sources[name]=dict(bytes=len(body),sha256=sha(body));dest=root/'sources'/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)
for name in ['virgl-shader.mjs','virgl-shader.wasm']:
    dest=root/'generated'/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((repo/'renderer/virgl-shader/build/wasm'/name).read_bytes())
receipt=dict(schema='stream-output-shader-worker-v1',task='E6-T11d65',head=head,base=base,commands=steps,sources=sources,compiler=json.loads((root/'native/audit.json').read_bytes()),historical=json.loads((root/'historical/audit.json').read_bytes()),predecessors=json.loads((root/'authentication.json').read_bytes()),coverage=dict(javascript=cov['positive'],native=cov['nativePositive'],zero=0),allocations=alloc[-1],stack=stack,physical=json.loads((root/'physical-audit.json').read_bytes()),actualLinuxGuest=False,productionAuthority=False)
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(status='passed',head=head,commands=len(steps))))
