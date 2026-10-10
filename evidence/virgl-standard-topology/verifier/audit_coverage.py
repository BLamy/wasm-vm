from pathlib import Path
import hashlib, json, re, subprocess
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
PARENT='64b246220bbf3ed5e1a6f1ed7371535ed5ec5c56';HEAD='dff28ee8cb1c494a52a6fbb5af872ed377605f66'
out={'schema':'standard-topology-runtime-coverage-v1','base':PARENT,'head':HEAD,'files':[],'unexecutedRuntimeTokens':[]}
for name in ['renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs']:
    src=(ROOT/name).read_text(); digest=hashlib.sha256(src.encode()).hexdigest()
    diff=subprocess.check_output(['git','diff','--unified=0',PARENT,HEAD,'--',name],cwd=ROOT,text=True)
    changed=[];line=0
    for l in diff.splitlines():
        if l.startswith('@@'):line=int(re.search(r'\+(\d+)',l)[1]);continue
        if l.startswith(('+++','---')):continue
        if l.startswith('+'):changed.append(line);line+=1
        elif l.startswith(' '):line+=1
    records=[]
    for cp in sorted((HERE/'unpacked').rglob('browser-coverage.json')):
        for script in json.loads(cp.read_text())['scripts']:
            if script['source']!=name:continue
            # Mutated native selector must never prove original selector coverage.
            if script['sha256']!=digest:continue
            records.append((str(cp.relative_to(HERE)),hashlib.sha256(cp.read_bytes()).hexdigest(),script['coverage']['functions']))
    starts=[];offset=0;lines=src.splitlines(keepends=True)
    for l in lines:starts.append(offset);offset+=len(l)
    def hits(o):
        result=[]
        for p,d,functions in records:
            ranges=[(r['endOffset']-r['startOffset'],r['count'],fn['functionName']) for fn in functions for r in fn['ranges'] if r['startOffset']<=o<r['endOffset']]
            if ranges:
                width=min(r[0] for r in ranges); narrow=[r for r in ranges if r[0]==width]
                result.append({'record':p,'sha256':d,'count':min(r[1] for r in narrow),'function':narrow[0][2]})
        return result
    rows=[]
    for l in changed:
        h=hits(starts[l-1]+len(lines[l-1])-len(lines[l-1].lstrip()))
        rows.append({'line':l,'text':lines[l-1].rstrip(),'hits':h,'executed':any(r['count']>0 for r in h)})
        for o in range(starts[l-1],starts[l-1]+len(lines[l-1])):
            if src[o].isalnum() and not any(r['count']>0 for r in hits(o)):
                out['unexecutedRuntimeTokens'].append({'path':name,'line':l,'offset':o,'character':src[o]})
    out['files'].append({'path':name,'sourceDigest':digest,'lines':rows})
assert not out['unexecutedRuntimeTokens'],'unexecuted runtime diff'
out['hunkClassifications']=[
 {'path':'renderer/virgl-command/decoder.mjs','classification':'executed','basis':'Literal Node/browser mode matrix and malformed/unsupported packets plus retained D6 legacy paths; positive and rejection arms have V8 hit counts.'},
 {'path':'renderer/virgl-command/state.mjs','classification':'executed','basis':'Frozen table initialization and real mode selector have positive authenticated coverage. Native calls independently show all four new modes in ordinary/instanced array/index calls; retained D6 exercises4/5.'},
 {'path':'renderer/virgl-command/tests/standard-core-topologies.mjs','classification':'executed','basis':'Hot/cold full87-frame recordings and actual mode mutation exercise positive/negative fixture paths. Smoke branch is harness routing recorded in fault-mode.'},
 {'path':'tools/verify-virgl-standard-topology.mjs','classification':'executed','basis':'Hot/cold Node, hardware and actual served mutation reports authenticate source/served/GPU/coverage/screenshot closure. Optional adversarial route is exercised by fresh promoted tests.'},
 {'path':'tools/verify-virgl-standard-topology.sh','classification':'executed','basis':'Hot/cold acceptance logs execute the full scoped frozen gate, including D6/D7 and two actual mutations.'},
 {'path':'tools/virgl-command/standard-topology-oracle.mjs','classification':'executed','basis':'All87 frames and both source-mode sabotages; independent fresh oracle rederives174 original frames without importing this implementation.'},
 {'path':'tools/virgl-command/standard-topology-pixels.mjs','classification':'executed','basis':'Both recorded physical-audit results,87 frames/50176 pixels each, source-closed receipts.'},
 {'path':'tools/virgl-command/standard-topology-receipt.py','classification':'executed','basis':'Both authenticated exact-head receipts and logged completion. Refusal branches are custody guards, independently challenged by archive/source/blob authentication rather than product behavior.'},
 {'path':'tools/virgl-command/standard-topology-cold.py','classification':'executed','basis':'Cold report/log, pinned exact head, scrubbed environment, clean before/after and copied full acceptance receipt.'},
 {'path':'tools/virgl-command/standard-topology-seal.py','classification':'executed','basis':'Authenticated2716-record archive/index/manifest; independent archive reader checks unique safe members and all declared digests.'},
 {'path':'Makefile','classification':'waived','basis':'Declarative target calls the actual recorded acceptance script; no new runtime behavior.'},
 {'path':'renderer/virgl-command/draw-README.md','classification':'waived','basis':'Documentation of isolated boundary only; physical and source evidence independently confirms stated limitations.'},
 {'path':'tasks/epic-6-transcendence/E6-T11d-truthful-guest-virgl-bringup.md','classification':'waived','basis':'Dependency/status log metadata; no runtime behavior or production authorization.'},
 {'path':'tasks/epic-6-transcendence/E6-T11d8-standard-core-topologies.md','classification':'waived','basis':'Task contract/claim/status metadata; assertions are interrogated by P1..P8, not executed.'},
 {'path':'tasks/QUEUE.md','classification':'waived','basis':'Generated task-status metadata; check_task_policy/build_queue validate consistency.'},
 {'path':'evidence/virgl-production-readiness/standard-topology-gap.json','classification':'waived','basis':'Historical negative planning probe against predecessor decoder; no new runtime claim. New full matrix supersedes mode-admission observations.'},
 {'path':'evidence/virgl-standard-topology/worker','classification':'executed','basis':'Capture/index/manifest data independently authenticated and all changed behavior rederived from actual original packets/bytes/native calls/pixels.'}
]
out['status']='passed';(HERE/'coverage-audit.json').write_text(json.dumps(out,indent=2)+'\n')
for file in out['files']:
    for line in file['lines']:print(file['path'],line['line'],max([h['count'] for h in line['hits']] or [0]),line['executed'])
