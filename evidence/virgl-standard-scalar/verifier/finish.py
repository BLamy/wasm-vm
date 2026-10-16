#!/usr/bin/env python3
"""Produce point citations and a scoped changed-hunk classification."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
BASE='b98847797f109b0a3af6171fd0a8c21983e1057b'
WORKER='2879d9a49c5b9b4f351993f0cf75342c7743d41b'
RUNTIME='1b8e94b79de6ee79f72116246ce4042aa7bda815'
PROMOTED='f8770251a815c9c9d7dbca58e671a0ec61262c94'
load=lambda name:json.loads((HERE/name).read_text())
sha=lambda raw:hashlib.sha256(raw).hexdigest()
physical,fresh,coverage=load('physical-audit.json'),load('fresh-audit.json'),load('coverage-audit.json')
assert all(r['status']=='passed' for r in [physical,fresh,coverage,load('authentication.json')])
citations={'schema':'standard-scalar-point-citations-v1','workerArchiveSha256':'99c79728c82a3c7ddef092b1faa10420192df535be67da662e1724b3aab596d2','frames':{}}
labels=['scaled32-round-36-1-0-true','norm32-endpoint-word-40-0-true','norm32-generic-round-32-0','norm32-generic-round-40-1','scalar-missing-36-3-true','scaled32-shared-overlap','pending-waiting-attributes-reuse','restore-A-last']
for label in labels:
    row=next(r for r in physical['frames'] if r['record']=='hot/hardware/report.json' and r['label']==label)
    citations['frames'][label]=row
for row in physical['faults']:
    if row['record'].startswith('hot/'):
        citations['frames'][row['record']]=row
for label in ['critic-seeded-85-false','critic-seeded-43-true','critic-rational-39-true-0','critic-pending-reuse']:
    row=next(r for r in fresh['frames'] if r['label']==label)
    citations['frames'][label]=row
for row in fresh['faults']:citations['frames'][row['record']]=row
for row in citations['frames'].values():
    p=HERE/row['record'] if row['record'].startswith('final-') else HERE/'unpacked'/row['record']
    raw=p.read_bytes();assert sha(raw)==row['recordSha256']
    assert ('"label": "'+row['label']+'"') in raw.decode().splitlines()[row['line']-1]
(HERE/'citations.json').write_text(json.dumps(citations,indent=2)+'\n')
classifications={
 'Makefile':('executed','hot/cold default make verify-E6-T11d13 runs the added target'),
 'renderer/virgl-command/decoder.mjs':('executed','all seven added table lines and each literal family/component have exact-source V8 hits and original wire/pointer authority'),
 'renderer/virgl-command/state.mjs':('executed','all six added converter lines and all new signed/unsigned 8/16/32, normalized/scaled branches have exact-source detailed V8 hits and exact generic words'),
 'renderer/virgl-command/tests/standard-compact-vertex-fetch.mjs':('executed','six changed helper lines execute in native/generic32 and affected compact runs; only the textually unchanged fixture-only unsupported-format throw is waived'),
 'renderer/virgl-command/tests/standard-compact-vertex-fetch-adversarial.mjs':('executed','updated scalar exclusions execute in 297-case headed hot/cold and node coverage; original sealed negative history remains unchanged'),
 'renderer/virgl-command/tests/standard-instanced-draws.mjs':('executed','new R32_UNORM expectation executes in the independently reconstructed 80-case original/legacy wire matrix; native float32 admission remains covered'),
 'renderer/virgl-command/tests/standard-scalar-vertex-fetch.mjs':('executed','396 wire cases,391 native frames, ten rejections, six lifetimes, disposal and two actual GPU sabotage witnesses execute every declared acceptance slice'),
 'tools/verify-virgl-standard-scalar.mjs':('executed','wire/default headed/fault/promoted paths execute at exact source hashes; defensive CLI/timeouts/error handling are harness guards, not additional product behaviors'),
 'tools/verify-virgl-standard-scalar.sh':('executed','complete frozen hot and scrubbed cold acceptance logs record all commands, native/sanitized programs and affected original compact/scalar GPU evidence'),
 'tools/virgl-command/standard-scalar-cold.py':('executed','authenticated cold report/log and still-present clean exact-freeze clone prove the pristine default command; failure-only defensive checks are harness guards'),
 'tools/virgl-command/standard-scalar-enums.c':('executed','native and ASan/UBSan programs compile all declarative static assertions and emit the independently pinned 32-enum list'),
 'tools/virgl-command/standard-scalar-oracle.mjs':('executed','worker byte/word/pixel oracle executes in all physical slices; a separate arithmetic byte decoder, exact BigInt rational rounding and original-TGSI interpreter refute self-licking expected values'),
 'tools/virgl-command/standard-scalar-pixels.mjs':('executed','hot/cold full independent saved-pixel receipts are rechecked from original blobs; all changed scalar product behavior is independently authenticated'),
 'tools/virgl-command/standard-scalar-receipt.py':('executed','hot/cold receipts close531sources/2generated/154historical identities, full blobs/source coverage and final command; defensive invalid-receipt checks add no product semantics'),
 'tools/virgl-command/standard-scalar-retained-critic.mjs':('executed','each retained critic44 original-TGSI full-pixel audit and297wire cases are separately replayed'),
 'tools/virgl-command/standard-scalar-seal.py':('executed','committed index/archive authenticate every hot/cold closure record; defensive invalid-seal checks add no product semantics')
}
diff=subprocess.check_output(['git','diff','--unified=0',BASE,WORKER],cwd=ROOT,text=True)
entries=[];name=None
for line in diff.splitlines():
    if line.startswith('diff --git '):
        name=line.split(' b/',1)[1]
    elif line.startswith('@@ '):
        classification,reason=classifications.get(name,('waived','declarative task/queue/README metadata or authenticated recorded evidence; no executable product behavior'))
        entries.append({'source':name,'hunk':line,'classification':classification,'reason':reason})
assert set(classifications)<=set(r['source'] for r in entries)
(HERE/'hunk-audit.json').write_text(json.dumps({'schema':'standard-scalar-scoped-hunk-audit-v1','status':'passed','diffBase':BASE,'diffHead':WORKER,'hunks':entries,'branchWaivers':coverage['branchWaivers'],'unexecutedRuntimeSegments':[]},indent=2)+'\n')
predictions=load('predictions.json')['predictions']
proofs={'P1':['authentication.json'],'P2':['physical-audit.json','coverage-audit.json'],'P3':['physical-audit.json','citations.json'],'P4':['physical-audit.json','citations.json'],'P5':['physical-audit.json'],'P6':['physical-audit.json'],'P7':['physical-audit.json','fresh-audit.json'],'P8':['physical-audit.json','citations.json'],'P9':['coverage-audit.json','hunk-audit.json'],'P10':['authentication.json'],'P11':['fresh-audit.json','citations.json']}
verdict={'schema':'standard-scalar-critic-verdict-v1','task':'E6-T11d13','verdict':'verified','runtimeHead':RUNTIME,'workerHead':WORKER,'harnessHead':PROMOTED,'workerArchiveSha256':citations['workerArchiveSha256'],'predictions':[dict(p,status='HELD',citations=proofs[p['id']]) for p in predictions],'findings':[],'carryForward':'154 predecessor evidence files and unchanged compiler/allocator/source/generated pins; no unrelated compiler gauntlet restarted','scope':'isolated standard scalar floating fetch; general native array arithmetic retains numerical pixel authority','guestExecution':False,'productionDrawAuthority':False,'throughputClaim':False}
(HERE/'verdict.json').write_text(json.dumps(verdict,indent=2)+'\n')
print(json.dumps({'verdict':'verified','predictions':len(predictions),'hunks':len(entries),'pointCitations':len(citations['frames'])}))
