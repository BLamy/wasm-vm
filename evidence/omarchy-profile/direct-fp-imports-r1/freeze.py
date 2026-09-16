"""Pin direct FP import code, original trial contract and unchanged AN proofs."""
from pathlib import Path
import hashlib, json, os, re, subprocess, time

out = Path(__file__).resolve().parent
repo = out.parents[2]
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
def git(*args): return subprocess.check_output(['git', *args], cwd=repo, env=env)
def sha(data): return hashlib.sha256(data).hexdigest()
baseline = '04ea9fe4'
paths = ['Makefile', 'crates/core/src/jit.rs', 'crates/core/src/softfloat.rs',
 'crates/jit-translate/src/lib.rs', 'crates/jit-runtime/src/lib.rs',
 'crates/wasm/src/jit_browser.rs', 'crates/wasm/tests/jit_fp_direct_imports_verifier.rs',
 'docs/jit-fp-policy.md', 'web/roadmap.js', 'tools/verify/omarchy-direct-fp-baseline.py']
paths += ['crates/wasm/tests/jit_fp_'+name+'_verifier.rs'
          for name in ['arithmetic','from_integer','to_word','division','fmadd']]
seen = set()
def visit(name):
 if name in seen: return
 seen.add(name)
 data = (repo/name).read_text()
 for spec in re.findall(r'(?:from\s*|import\s*)[\'\"]([^\'\"]+)[\'\"]', data):
  if spec.startswith('.'):
   p = (repo/name).parent/spec
   if 'node_modules' not in p.parts: visit(str(p.resolve().relative_to(repo)))
roots = {'tools/verify/omarchy-direct-fp-input.mjs', 'tools/verify/omarchy-direct-fp-browser.mjs',
 'tools/verify/omarchy-direct-fp-benchmark.mjs','tools/verify/omarchy-direct-fp-fixture.mjs',
 'tools/verify/omarchy-desktop-live.mjs'}
for name in roots: visit(name)
paths += sorted(seen)
paths += [str(p.relative_to(repo)) for p in out.iterdir() if p.suffix in ('.py','.mjs')]
for name in paths:
 assert (repo/name).read_bytes() == git('show','HEAD:'+name), name
assert not git('status','--short','--',*paths,'web/dist').strip()
carried = []
for name,relative in [('fmadd-single-r1', True),('fmadd-single-verifier', False)]:
 index = out.parent/name/'sha256.txt'
 rows = index.read_text().splitlines()
 for line in rows:
  digest,p = line.split('  ',1)
  assert sha(((index.parent if relative else repo)/p).read_bytes()) == digest, p
 carried.append(dict(path=str(index.relative_to(repo)),sha256=sha(index.read_bytes()),files=len(rows)))
unchanged = []
for name in sorted(seen-roots):
 old = git('show',baseline+':'+name)
 assert old == (repo/name).read_bytes(), name
 unchanged.append(dict(path=name,sha256=sha(old)))
for name in ['crates/core','crates/jit-translate','crates/jit-runtime','tests/support']:
 assert not git('diff',baseline,'HEAD','--',name).strip(), name
pair = repo/'target/omarchy-direct-opaque-r2'
pins = {'omarchy-ready.snap.gz':(207172408,'989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75'),
 'omarchy-overlay-delta.bin.gz':(1232847,'4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972')}
for name,(size,digest) in pins.items():
 data = (pair/name).read_bytes()
 assert len(data) == size and sha(data) == digest, name
wasm = sha((repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes())
assert f'const DIRECT_FP_WASM = "{wasm}";' in (repo/'tools/verify/omarchy-direct-fp-input.mjs').read_text()
artifact_names = ['pkg/wasm_vm_wasm_bg.wasm','pkg/wasm_vm_wasm.js','roadmap.js','app.html','tasks.json','sw.js']
receipt = dict(head=git('rev-parse','HEAD').decode().strip(),
 frozenAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),wasmSha256=wasm,pairPins=pins,
 carried=carried,unchangedRecorder=unchanged,
 files=[dict(path=p,sha256=sha((repo/p).read_bytes())) for p in sorted(set(paths))],
 artifacts=[dict(path='web/dist/'+p,sha256=sha((repo/'web/dist'/p).read_bytes())) for p in artifact_names])
(out/'frozen.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
