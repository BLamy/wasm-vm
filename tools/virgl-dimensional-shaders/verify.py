"""Frozen C/Wasm dimensional compiler and complete native GPU byte evidence."""
import argparse,hashlib,json,os,shutil,subprocess,time
from pathlib import Path
repo=Path(__file__).resolve().parents[2];base='48b2ba0c7ee90d13093f7782e5a2502e44095753'
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);root=Path(parser.parse_args().output).resolve()
assert not root.exists();root.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
env={k:v for k,v in os.environ.items() if not k.startswith(('CARGO_','RUST','LLVM_PROFILE','NODE_','VIRGL_','npm_','NPM_')) and k not in {'CC','CXX','CFLAGS','CPPFLAGS','LDFLAGS','EMCC','EMSDK','EM_CONFIG','CHROME','PYTHONPATH','PYTHONHOME'}}
steps=[]
def run(name,command,overrides=None,expected=0,timeout=1200):
    print(name+': running',flush=True);start=time.monotonic()
    p=subprocess.run(command,cwd=repo,env={**env,**(overrides or {})},capture_output=True,timeout=timeout)
    (root/(name+'.stdout')).write_bytes(p.stdout);(root/(name+'.stderr')).write_bytes(p.stderr)
    steps.append(dict(name=name,command=command,overrides=overrides or {},exitCode=p.returncode,expected=expected,seconds=time.monotonic()-start,stdoutSha256=sha(p.stdout),stderrSha256=sha(p.stderr)))
    assert p.returncode==expected,(name,p.stderr[-3000:].decode(errors='replace'));print(name+': expected exit '+str(expected),flush=True);return p
assert not git('diff','--name-only',base,'HEAD','--','crates','renderer/virgl-command','tools/guest'),'unchanged native/consumer boundaries held from D56'
run('policy',['python3','tools/check_task_policy.py'])
run('diff-format',['git','diff','--check',base,'HEAD'])
run('predecessor',['python3','tools/virgl-dimensional-shaders/predecessor.py',str(root/'native/predecessor')])
if not (repo/'web/node_modules/playwright').is_dir():run('npm-dependencies',['npm','--prefix','web','ci','--no-audit','--no-fund'])
emcc=run('pinned-emcc',['bash','tools/setup-virgl-emsdk.sh']).stdout.decode().strip();assert emcc
compiler_env={'EMCC':emcc,'ASAN_OPTIONS':'abort_on_error=1','UBSAN_OPTIONS':'halt_on_error=1'}
for p in [repo/'renderer/virgl-shader/standard.mjs',repo/'renderer/virgl-shader/tests/standard-dimensional-texture-browser.mjs',*(repo/'tools/virgl-dimensional-shaders').glob('*.mjs')]:run('syntax-'+p.stem,['node','--check',str(p)])
run('python-syntax',['python3','-m','py_compile',*map(str,(repo/'tools/virgl-dimensional-shaders').glob('*.py'))])
run('matrix',['node','tools/virgl-dimensional-shaders/compiler.mjs','cases',str(root/'native')])
run('native-build',['bash','renderer/virgl-shader/build.sh','standard-dimensional-texture-native'],compiler_env)
p=run('native',['renderer/virgl-shader/build/standard-dimensional-texture-native/standard-dimensional-texture-test',str(root/'native/cases.bin')]);(root/'native/native.jsonl').write_bytes(p.stdout)
coverage=root/'coverage';coverage.mkdir()
run('sanitized-build',['bash','renderer/virgl-shader/build.sh','standard-dimensional-texture-sanitize'],compiler_env)
p=run('sanitized',['renderer/virgl-shader/build/standard-dimensional-texture-sanitize/standard-dimensional-texture-test',str(root/'native/cases.bin')],{**compiler_env,'LLVM_PROFILE_FILE':str(coverage/'matrix.profraw')});(root/'native/sanitize.jsonl').write_bytes(p.stdout)
assert (root/'native/native.jsonl').read_bytes()==(root/'native/sanitize.jsonl').read_bytes()
run('allocation-build',['bash','renderer/virgl-shader/build.sh','standard-dimensional-texture-allocation-sanitize'],compiler_env)
p=run('allocations',['renderer/virgl-shader/build/standard-dimensional-texture-allocation-sanitize/standard-dimensional-texture-allocation-test'],{**compiler_env,'LLVM_PROFILE_FILE':str(coverage/'allocations.profraw')});(root/'native/allocations.jsonl').write_bytes(p.stdout)
for mode,binary in [('matrix','standard-dimensional-texture-sanitize/standard-dimensional-texture-test'),('allocations','standard-dimensional-texture-allocation-sanitize/standard-dimensional-texture-allocation-test')]:
    run('profile-'+mode,['xcrun','llvm-profdata','merge','-sparse',str(coverage/(mode+'.profraw')),'-o',str(coverage/(mode+'.profdata'))])
    p=run('coverage-'+mode,['xcrun','llvm-cov','export','renderer/virgl-shader/build/'+binary,'-instr-profile='+str(coverage/(mode+'.profdata'))]);(coverage/(mode+'.json')).write_bytes(p.stdout)
run('wasm-stack',['bash','renderer/virgl-shader/build.sh','standard-wasm-stack'],compiler_env)
(root/'stack').mkdir()
for p in (repo/'renderer/virgl-shader/build/standard-wasm-stack').glob('*.su'):shutil.copyfile(p,root/'stack'/p.name)
run('wasm-build',['bash','renderer/virgl-shader/build.sh','wasm'],compiler_env)
(root/'node-coverage').mkdir()
run('native-wasm-facade-audit',['node','tools/virgl-dimensional-shaders/compiler.mjs','audit',str(root/'native')],{'NODE_V8_COVERAGE':str(root/'node-coverage')})
for seed in [27149,81953,163841]:run('hardware-'+str(seed),['node','tools/virgl-dimensional-shaders/browser.mjs','--inputs',str(root),'--output',str(root/('hardware-'+str(seed))),'--seed',str(seed)])
run('fault-wrong-layer',['node','tools/virgl-dimensional-shaders/browser.mjs','--inputs',str(root),'--output',str(root/'fault-wrong-layer'),'--fault','wrong-layer'],expected=1)
run('physical-audit',['node','tools/virgl-dimensional-shaders/pixels.mjs',str(root)])
run('coverage-audit',['python3','tools/virgl-dimensional-shaders/coverage.py',str(root)])
audit=json.loads((root/'native/audit.json').read_bytes());assert audit['status']=='passed' and audit['exactNativeWasm'] and audit['historicalResponses']==7163 and audit['fixedMemoryBytes']==16777216
cov=json.loads((root/'coverage-audit.json').read_bytes());assert not cov['zero'] and not cov['nativeZero'],'changed executable region needs evidence'
allocations=[json.loads(line) for line in (root/'native/allocations.jsonl').read_text().splitlines()];assert allocations[-1]['faults']==allocations[-1]['recoveries']==213
frames={}
for p in (root/'stack').glob('*.su'):
    for line in p.read_text().splitlines():
        fields=line.split('\t');frames[fields[0].rsplit(':',1)[-1]]=int(fields[1])
stack={}
for mode in ['stage','pair']:
    names=['bridge_translate_standard_dimensional_texture'+('_pair' if mode=='pair' else ''),'standard_'+mode,'standard_convert','vrend_convert_shader','standard_emit']
    assert all(name in frames for name in names),names
    sizes={name:frames[name] for name in names};assert sum(sizes.values())<262144;stack[mode]=dict(frames=sizes,selectedFrameSumBytes=sum(sizes.values()),limitBytes=262144,unchangedDependencyBoundary=base)
run('default-dist-build',['make','web-dist'])
run('default-demo',['node','tools/verify-virgl-default-demo.mjs','--output',str(root/'default-demo'),'--task','E6-T11d57'])
assert not git('status','--porcelain','--untracked-files=no')
source_paths=git('ls-files','renderer/virgl-shader','tools/virgl-dimensional-shaders','tools/virgl-shadow-shaders','tools/virgl-instance-base','tools/virgl-floating-depth/primary','tools/lib/virgl-browser-runner.mjs','tools/setup-virgl-emsdk.sh','tools/build-web-dist.sh','tools/verify-virgl-default-demo.mjs','web/roadmap.js','web/dist','Makefile','AGENTS.md','tasks/epic-6-transcendence/E6-T11d57-dimensional-texture-shaders.md').splitlines()
pins={}
for relative in source_paths:
    p=repo/relative
    if not p.is_file():continue
    body=p.read_bytes();assert body==subprocess.check_output(['git','show',head+':'+relative],cwd=repo);pins[relative]=dict(bytes=len(body),sha256=sha(body));dest=root/'sources'/relative;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)
generated={}
for relative in ['renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm', 'renderer/virgl-shader/build/standard-dimensional-texture-native/standard-dimensional-texture-test', 'renderer/virgl-shader/build/standard-dimensional-texture-sanitize/standard-dimensional-texture-test', 'renderer/virgl-shader/build/standard-dimensional-texture-allocation-sanitize/standard-dimensional-texture-allocation-test']:
    body=(repo/relative).read_bytes();generated[relative]=dict(bytes=len(body),sha256=sha(body));dest=root/'generated'/relative;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)
physical=json.loads((root/'physical-audit.json').read_bytes());assert len(physical['results'])==4
receipt=dict(schema='dimensional-shader-worker-receipt-v1',task='E6-T11d57',head=head,base=base,commands=steps,sources=pins,generated=generated,compiler=audit,coverage=dict(javascript=cov['positive'],native=cov['nativePositive']),allocations=allocations[-1],stack=stack,physicalAuditSha256=sha((root/'physical-audit.json').read_bytes()),guestExecution=False,productionAuthority=False)
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(status='passed',head=head,commands=len(steps),compilerCases=audit['cases'])))
