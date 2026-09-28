#!/usr/bin/env python3
"""Check the completed worker seal without rewriting worker evidence."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
BASE = REPO / 'evidence/omarchy-profile'
GATES = BASE / 'admission-after-fp-gates'
PAIR = BASE / 'admission-after-fp-r1'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
load = lambda p: json.loads(p.read_text())
env = {**os.environ, 'DEVELOPER_DIR':'/Library/Developer/CommandLineTools'}

entries = {}
for line in (GATES/'sha256.txt').read_text().splitlines():
    digest, name = line.split('  ', 1)
    assert name not in entries, name
    assert sha(BASE/name) == digest, name
    entries[name] = digest
actual = {str(p.relative_to(BASE)) for d in [GATES,PAIR] for p in d.rglob('*') if p.is_file() and p != GATES/'sha256.txt'}
assert actual == set(entries), sorted(actual.symmetric_difference(entries))
submission, frozen, commands, ab = [load(p) for p in [GATES/'submission.json',GATES/'frozen.json',GATES/'commands.json',PAIR/'ab.json']]
assert submission['recordingHead'] == frozen['head'] == ab['head'] == '81f01ba31171b8d670f3842948e556b62bcb0d75'
assert submission['verifiedRuntimeParent'] == frozen['verifiedParent'] == '53103e762c6c4003a5976bfa90131a03702fd2e7'
assert submission['wasmSha256'] == frozen['wasmSha256'] == ab['wasmSha256'] == '1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d'
assert all(row['code'] == 0 for row in commands['commands']) and commands['allPassed']
assert not submission['controlResponsive'] and not submission['candidateResponsive'] and not submission['runtimeOrRecorderChanges']
for row in frozen['files']:
    assert sha(REPO/row['path']) == row['sha256']
runtime_diff = subprocess.check_output(['git','diff','--name-only',submission['verifiedRuntimeParent'],'HEAD','--','crates','web','tools/verify'],cwd=REPO,env=env,text=True)
assert not runtime_diff.strip(), runtime_diff
own = load(OUT/'pair-inspection.json')
worker = load(PAIR/'audit.json')
for independent, submitted in zip(own['arms'],worker['arms']):
    for name in ['arm','reportSha256','outcome','completedReads','pendingReads']:
        assert independent[name] == submitted[name], name
    assert independent['trustedPhysicalEvents'] == submitted['trustedEvents'] == 128
    assert independent['nonceVerified'] is False and submitted['nonceReplies'] == 0
    assert independent['desktopAccepted'] is submitted['machineAcceptance'] is False
receipt = dict(checkedHead=subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,env=env,text=True).strip(),
               sealedSourceHead=submission['head'],recordingHead=ab['head'],
               sealedFiles=len(entries), indexSha256=sha(GATES/'sha256.txt'),
               allFilesMatched=True, completeIndex=True, runtimeOrRecorderChanges=False,
               workerAndIndependentOutcomesAgree=True,
               abSha256=sha(PAIR/'ab.json'), sourcePinsMatched=len(frozen['files']),
               entries=entries)
(OUT/'seal-inspection.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:v for k,v in receipt.items() if k!='entries'},indent=2))
