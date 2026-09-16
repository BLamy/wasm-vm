#!/usr/bin/env python3
"""Inspect the sole recorded clean clone; never rebuild or rerun it."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
worker = repo / 'evidence/omarchy-profile/fmadd-single-r1'
frozen = json.loads((worker / 'frozen.json').read_text())
report = json.loads((worker / 'cold/report.json').read_text())
clone = Path(report['clone'])
sha = lambda data: hashlib.sha256(data).hexdigest()
def git(*args, cwd=repo):
    return subprocess.check_output(['git', *args], cwd=cwd)

head = 'c531ceffb9b7adc8de9f5ebc927d00076a26f1dd'
assert report['head'] == head
assert git('rev-parse', 'HEAD', cwd=clone).decode().strip() == head
assert report['passed'] and report['pristineBeforeBuild']
assert len(report['commands']) == 4
assert [row['args'][0] for row in report['commands']] == ['git','git','make','make']
assert report['commands'][2]['args'] == ['make', 'web-dist']
assert report['commands'][3]['args'][:2] == ['make', 'verify-E5_5-T03an']
assert all(row['code'] == 0 for row in report['commands'])
assert all(row['startedAt'] <= row['finishedAt'] for row in report['commands'])
assert all(a['finishedAt'] <= b['startedAt']
           for a,b in zip(report['commands'], report['commands'][1:]))

checked = []
for row in frozen['files'] + frozen['artifacts']:
    relative = row['path']
    assert sha(git('show', head + ':' + relative, cwd=clone)) == row['sha256'], relative
    assert sha((clone / relative).read_bytes()) == row['sha256'], relative
    checked.append(relative)
assert report['committedWasmSha256'] == report['rebuiltWasmSha256'] == frozen['wasmSha256']

# Inspect the exact recorded runner's scrub and pristine-before-build order.
runner = (worker / 'run-cold.py').read_text()
assert "key.startswith('CARGO_') or key in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG')" in runner
assert "scrubbed.append(key); del env[key]" in runner
assert "env=env,stdout=log,stderr=subprocess.STDOUT" in runner
assert "assert clean=='',clean" in runner
assert runner.index("assert clean=='',clean") < runner.index("run(['make','web-dist']")
assert 'shell=True' not in runner

manifests = ['web/dist/artifacts-alpine.json','web/dist/artifacts-node-alpine.json',
             'web/dist/artifacts-omarchy.json','web/dist/artifacts.json']
assert git('diff','--name-only',frozen['head'],head).decode().splitlines() == manifests
status = git('status','--porcelain',cwd=clone).decode().splitlines()
assert status == [' M ' + path for path in manifests], status
changes = []
def compare(a,b,path):
    if isinstance(a,dict):
        assert a.keys() == b.keys(), path
        for key in a: compare(a[key], b[key], path + [key])
    elif isinstance(a,list):
        assert len(a) == len(b), path
        for index,(av,bv) in enumerate(zip(a,b)): compare(av,bv,path + [index])
    elif a != b:
        assert path[-1] in ('url', 'baseUrl'), path
        changes.append({'path':path, 'before':a, 'after':b})
for path in manifests:
    before = json.loads(git('show', frozen['head'] + ':' + path))
    after = json.loads(git('show', head + ':' + path))
    compare(before, after, [path])
    assert json.loads((clone/path).read_text()) == before, path

hot = (worker / 'acceptance.log').read_text()
cold = (worker / 'cold/acceptance.log').read_text()
summary = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;', cold)
assert summary == [(str(n),'0','0') for n in [1,1,3,5,2,6]], summary
critic = lambda text: sorted(line for line in text.splitlines() if line.startswith('CRITIC_'))
assert critic(cold) == critic(hot)
assert len(critic(cold)) == 33, len(critic(cold))
assert 'Compiling wasm-vm-core v0.0.1 (' + str(clone) + '/crates/core)' in cold
receipt = {'passed':True,'head':head,'frozenHead':frozen['head'],
           'clone':str(clone),'sourceAndArtifactHashesChecked':checked,
           'pristineBeforeBuildGuardInspected':True,'environmentScrubInspected':True,
           'rebuiltWasmSha256':report['rebuiltWasmSha256'],
           'manifestOnlyChanges':changes,'postBuildChanges':status,
           'testCounts':[int(row[0]) for row in summary],
           'hotColdCriticLinesIdentical':len(critic(cold)),
           'reportSha256':sha((worker/'cold/report.json').read_bytes()),
           'acceptanceSha256':sha((worker/'cold/acceptance.log').read_bytes()),
           'buildSha256':sha((worker/'cold/build.log').read_bytes())}
(out/'cold-inspection.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
