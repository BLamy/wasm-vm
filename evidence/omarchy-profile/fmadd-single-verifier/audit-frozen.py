#!/usr/bin/env python3
"""Independently bind the frozen diff, fixtures, carry seals and local artifact."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
worker = repo/'evidence/omarchy-profile/fmadd-single-r1'
frozen = json.loads((worker/'frozen.json').read_text())
head = '618286f3b1431990bbeddb9ef40d894b67be0605'
assert frozen['head'] == head
env = dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
git = lambda *args: subprocess.check_output(['git',*args],cwd=repo,env=env)
sha = lambda b: hashlib.sha256(b).hexdigest()
checked = {}
for row in frozen['files'] + frozen['artifacts']:
    p = row['path']
    data = (repo/p).read_bytes()
    assert data == git('show',head+':'+p) and sha(data)==row['sha256'], p
    checked[p] = sha(data)
carried = []
for seal in frozen['carried']:
    index = (repo/seal['path']).read_bytes()
    assert sha(index) == seal['sha256']
    lines = index.decode().splitlines()
    assert len(lines)==seal['files']
    for line in lines:
        digest,p=line.split('  ',1)
        assert sha((repo/p).read_bytes())==digest,p
    carried.append(seal)
for row in frozen['unchangedRecorder']:
    old = git('show','e7e378288581069ae0471e3ca141507e1f5faf30:'+row['path'])
    assert old == (repo/row['path']).read_bytes() and sha(old)==row['sha256']
assert not git('diff','29ea3537',head,'--','Cargo.toml','Cargo.lock','.cargo','crates/core/src/resume.rs')
runtime_diff = git('diff','29ea3537',head,'--','crates/core/src','crates/jit-translate/src','crates/jit-runtime/src','crates/wasm/src').decode()
added_lines = [line[1:] for line in runtime_diff.splitlines() if line.startswith('+') and not line.startswith('+++')]
assert not any('#[ignore]' in line or '#[cfg(test)]' in line for line in added_lines)
assert set(git('diff','--name-only','29ea3537',head,'--','crates/core/src','crates/jit-translate/src','crates/jit-runtime/src','crates/wasm/src').decode().splitlines())=={
    'crates/core/src/jit.rs','crates/core/src/softfloat.rs','crates/jit-translate/src/lib.rs',
    'crates/jit-runtime/src/lib.rs','crates/wasm/src/jit_browser.rs'}
(out/'runtime-diff.patch').write_text(runtime_diff)
preflight = json.loads((out/'native-first.json').read_text())
for p,digest in preflight['source'].items():
    if p != 'tests/support/jit_fp_fmadd_verifier.rs':
        assert checked[p] == digest,p
current_support=(repo/'tests/support/jit_fp_fmadd_verifier.rs').read_text()
old_support=Path(json.loads((out/'sabotage.json').read_text())['scratch'])/'src/proof.rs'
old_text=old_support.read_text()
assert old_text[:old_text.index('pub const GOLDENS:')]==current_support[:current_support.index('pub const GOLDENS:')]
assert old_text.split('pub const GOLDENS:')[1].split('    Golden {',2)[1] == current_support.split('pub const GOLDENS:')[1].split('    Golden {',2)[1]
pair=[]
for filename,(size,digest) in frozen['pairPins'].items():
    p=repo/'target/omarchy-direct-opaque-r2'/filename
    data=p.read_bytes()
    assert len(data)==size and sha(data)==digest
    pair.append(dict(name=filename,size=size,sha256=digest))
receipt=dict(head=head,sourceAndArtifactFiles=checked,
    carriedSeals=carried,unchangedRecorderFiles=len(frozen['unchangedRecorder']),
    dependencyAndSnapshotBoundaryUnchanged=True,noNewTestOnlyRuntimeOrIgnore=True,
    independentNativeRuntimeMatchesFrozen=True,sabotageWitnessAndAssertionUnchanged=True,
    pair=pair,wasmSha256=frozen['wasmSha256'],
    runtimeDiffSha256=sha(runtime_diff.encode()))
(out/'frozen-inspection.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:v for k,v in receipt.items() if k!='sourceAndArtifactFiles'},indent=2))
