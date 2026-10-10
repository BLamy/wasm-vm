#!/usr/bin/env python3
"""Independent full nested V8 audit; never use line maxima as execution proof."""
import difflib, hashlib, json, subprocess, sys, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = 'a5085b5491f24b3c700fb7cef7b1629c2efef914'
RUNTIME = ['renderer/virgl-command/resources.mjs', 'renderer/virgl-command/packed-float-images.mjs']
sha = lambda data: hashlib.sha256(data).hexdigest()

def main():
    output = Path(sys.argv[1]); output.mkdir(parents=True, exist_ok=True)
    records = []
    with tarfile.open(ROOT/'evidence/virgl-standard-packed-float-images/worker/recording.tar.gz', 'r:gz') as archive:
        for member in archive.getmembers():
            if member.name.endswith('browser-coverage.json') or '/node-coverage/' in member.name and member.name.endswith('.json'):
                raw = archive.extractfile(member).read(); obj = json.loads(raw)
                scripts = [(s['source'], s['coverage'], s['sha256']) for s in obj['scripts']] if 'scripts' in obj else [(s['url'].split('/wasm-vm/')[-1], s, None) for s in obj.get('result', [])]
                for name, script, digest in scripts:
                    if name in RUNTIME:
                        current = (ROOT/name).read_bytes()
                        if digest is not None: assert digest == sha(current)
                        records.append(dict(member=member.name, digest=sha(raw), source=name, functions=script['functions']))
    for extra in sys.argv[2:]:
        path = Path(extra); raw = path.read_bytes(); obj = json.loads(raw)
        for script in obj['scripts']:
            if script['source'] in RUNTIME:
                assert script['sha256'] == sha((ROOT/script['source']).read_bytes())
                records.append(dict(member=str(path.relative_to(ROOT)), digest=sha(raw), source=script['source'], functions=script['coverage']['functions']))
    entries = []
    for name in RUNTIME:
        current = (ROOT/name).read_text(); old = subprocess.run(['git','show',BASE+':'+name],cwd=ROOT,capture_output=True).stdout.decode()
        before, after = old.splitlines(True), current.splitlines(True); positions=[0]
        for line in after: positions.append(positions[-1]+len(line))
        available=[r for r in records if r['source']==name]
        for tag, a,b,c,d in difflib.SequenceMatcher(a=before,b=after,autojunk=False).get_opcodes():
            if tag not in ('insert','replace'):continue
            for index in range(c,d):
                text=after[index]; begin,end=positions[index],positions[index+1]
                left=begin+len(text)-len(text.lstrip()); right=begin+len(text.rstrip())
                if left>=right:continue
                endpoints={left,right}
                for record in available:
                    for function in record['functions']:
                        for region in function['ranges']:
                            endpoints.update(p for p in [region['startOffset'],region['endOffset']] if left<p<right)
                points=sorted(endpoints)
                for lo,hi in zip(points,points[1:]):
                    fragment=current[lo:hi]
                    if not fragment.strip():continue
                    witnesses=[]
                    for record in available:
                        candidates=[(reg['endOffset']-reg['startOffset'],reg['count'],fun['functionName'],reg) for fun in record['functions'] for reg in fun['ranges'] if reg['startOffset']<=lo and reg['endOffset']>=hi]
                        if not candidates:continue
                        shortest=min(x[0] for x in candidates); governing=[x for x in candidates if x[0]==shortest]; minimum=min(x[1] for x in governing)
                        witness=next(x for x in governing if x[1]==minimum)
                        witnesses.append(dict(member=record['member'],digest=record['digest'],count=minimum,function=witness[2],governing=witness[3]))
                    held=any(w['count']>0 for w in witnesses)
                    entries.append(dict(source=name,sourceSha256=sha(current.encode()),line=index+1,start=lo,end=hi,text=fragment,held=held,witnesses=witnesses))
    result=dict(schema='d27-full-nested-minimum-coverage-v1',status='passed' if all(e['held'] for e in entries) else 'needs-classification',scriptRecords=len(records),intervals=entries)
    (output/'coverage.json').write_text(json.dumps(result,indent=2)+'\n')
    zero=[dict(source=e['source'],line=e['line'],start=e['start'],end=e['end'],text=e['text']) for e in entries if not e['held']]
    print(json.dumps(dict(status=result['status'],scriptRecords=len(records),intervals=len(entries),zero=zero),indent=2))

if __name__=='__main__':main()
