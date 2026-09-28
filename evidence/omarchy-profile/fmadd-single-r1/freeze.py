"""Pin the submitted code, recorder closure, runtime and unchanged desktop pair."""
from pathlib import Path
import hashlib, json, os, re, subprocess, time

out=Path(__file__).resolve().parent
repo=out.parents[2]
env=dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
def git(*args): return subprocess.check_output(['git',*args],cwd=repo,env=env)
def sha(data): return hashlib.sha256(data).hexdigest()
paths=['Makefile','crates/core/src/jit.rs','crates/core/src/softfloat.rs',
 'crates/core/tests/fp_fmadd_flags.rs','crates/jit-translate/src/lib.rs',
 'crates/jit-translate/tests/differential.rs','crates/jit-runtime/src/lib.rs',
 'crates/jit-runtime/tests/fp_fmadd.rs','crates/jit-runtime/tests/fp_fmadd_verifier.rs',
 'crates/jit-runtime/tests/fp_division_verifier.rs','crates/jit-runtime/tests/fp_from_integer_verifier.rs',
 'crates/jit-runtime/tests/fp_to_word_verifier.rs','crates/wasm/src/jit_browser.rs',
 'crates/wasm/tests/jit_fp_fmadd.rs','crates/wasm/tests/jit_fp_fmadd_verifier.rs',
 'tests/support/jit_fp_fmadd.rs','tests/support/jit_fp_fmadd_verifier.rs','tests/support/fmadd_goldens.rs',
 'docs/jit-fp-policy.md','web/roadmap.js']
seen=set()
def visit(name):
 if name in seen: return
 seen.add(name)
 data=(repo/name).read_bytes()
 for spec in re.findall(r'(?:from\s*|import\s*)[\'\"]([^\'\"]+)[\'\"]',data.decode()):
  if not spec.startswith('.'): continue
  p=(repo/name).parent/spec
  if 'node_modules' not in p.parts: visit(str(p.resolve().relative_to(repo)))
for name in ['tools/verify/omarchy-fmadd-input.mjs','tools/verify/omarchy-fmadd-browser.mjs','tools/verify/omarchy-desktop-live.mjs']:
 visit(name)
paths+=sorted(seen)
paths += [str(p.relative_to(repo)) for p in out.iterdir() if p.suffix in ('.py','.mjs')]
for name in paths:
 assert (repo/name).read_bytes()==git('show','HEAD:'+name),name
assert not git('status','--short','--',*paths,'web/dist').strip()
carried=[]
for name in ['prepared-recycling-gates','prepared-recycling-verifier']:
 index=out.parent/name/'sha256.txt'
 for line in index.read_text().splitlines():
  h,p=line.split('  ',1); assert sha((repo/p).read_bytes())==h,p
 carried.append(dict(path=str(index.relative_to(repo)),sha256=sha(index.read_bytes()),files=len(index.read_text().splitlines())))
unchanged=[]
for name in sorted(seen-{'tools/verify/omarchy-fmadd-input.mjs','tools/verify/omarchy-fmadd-browser.mjs','tools/verify/omarchy-desktop-live.mjs'}):
 old=git('show','e7e378288581069ae0471e3ca141507e1f5faf30:'+name)
 assert old==(repo/name).read_bytes(),name
 unchanged.append(dict(path=name,sha256=sha(old)))
assert not git('diff','e7e378288581069ae0471e3ca141507e1f5faf30','HEAD','--','crates/core/src/resume.rs').strip()
pair=repo/'target/omarchy-direct-opaque-r2'
pins={'omarchy-ready.snap.gz':(207172408,'989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75'),
 'omarchy-overlay-delta.bin.gz':(1232847,'4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972')}
for name,(size,h) in pins.items():
 data=(pair/name).read_bytes(); assert len(data)==size and sha(data)==h,name
wasm=sha((repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes())
assert f'const FMADD_WASM = "{wasm}";' in (repo/'tools/verify/omarchy-fmadd-input.mjs').read_text()
artifactNames=['pkg/wasm_vm_wasm_bg.wasm','pkg/wasm_vm_wasm.js','roadmap.js','app.html','tasks.json','sw.js']
receipt=dict(head=git('rev-parse','HEAD').decode().strip(),frozenAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
 wasmSha256=wasm,pairPins=pins,carried=carried,unchangedRecorder=unchanged,
 files=[dict(path=p,sha256=sha((repo/p).read_bytes())) for p in sorted(set(paths))],
 artifacts=[dict(path='web/dist/'+p,sha256=sha((repo/'web/dist'/p).read_bytes())) for p in artifactNames])
(out/'frozen.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
