"""Pin this harness, the verified pair, and unchanged runtime before navigation."""
from pathlib import Path
import hashlib, json, os, re, subprocess, time

out=Path(__file__).resolve().parent
repo=out.parents[2]
env=dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
def git(*args): return subprocess.check_output(['git',*args],cwd=repo,env=env)
def sha(data): return hashlib.sha256(data).hexdigest()
assert not git('diff','--name-only','39c1441e','--','crates','web').strip()
assert not git('status','--short','--','crates','web').strip()
entries=['tools/verify/omarchy-prepared-direct-input.mjs','tools/verify/omarchy-desktop-live.mjs']
seen=set()
def visit(name):
    if name in seen: return
    seen.add(name)
    data=(repo/name).read_bytes()
    assert data==git('show','HEAD:'+name),name
    # Static local imports constitute this recorder's module closure. Dynamic
    # imports in the existing CPU-profile helper are inspected separately.
    for spec in re.findall(r'(?:from\s*|import\s*)[\'\"]([^\'\"]+)[\'\"]',data.decode()):
        if not spec.startswith('.'): continue
        p=(repo/name).parent/spec
        if 'node_modules' in p.parts: continue
        visit(str(p.resolve().relative_to(repo)))
for entry in entries: visit(entry)
for p in [out/'record.py',out/'freeze.py']:
    assert p.read_bytes()==git('show','HEAD:'+str(p.relative_to(repo)))
assert not git('status','--short','--',*sorted(seen)).strip()
seals=['prepared-direct-opaque-gates-r2','prepared-direct-opaque-verifier-r2',
       'snapshot-allocation-gates','snapshot-allocation-verifier']
carried=[]
for name in seals:
    index=out.parent/name/'sha256.txt'
    for line in index.read_text().splitlines():
        h,p=line.split('  ',1); assert sha((repo/p).read_bytes())==h,p
    carried.append(dict(path=str(index.relative_to(repo)),sha256=sha(index.read_bytes()),files=len(index.read_text().splitlines())))
pair=repo/'target/omarchy-direct-opaque-r2'
pins={'omarchy-ready.snap.gz':(207172408,'989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75'),
      'omarchy-overlay-delta.bin.gz':(1232847,'4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972')}
for name,(size,h) in pins.items():
    data=(pair/name).read_bytes(); assert len(data)==size and sha(data)==h,name
wasm=sha((repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes())
assert wasm=='8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4'
receipt=dict(head=git('rev-parse','HEAD').decode().strip(),frozenAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
    runtimeUnchangedFrom='39c1441e',wasmSha256=wasm,pairPins=pins,carried=carried,
    files=[dict(path=p,sha256=sha((repo/p).read_bytes())) for p in sorted(seen)])
(out/'frozen.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
