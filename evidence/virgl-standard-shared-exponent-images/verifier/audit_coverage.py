#!/usr/bin/env python3
"""Judge every full nested governing interval, never just added-line samples."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
BASE='cd59854e79cedf31abe35585bbe1fe616a8fc7ae'
SUBMISSION='dcd1668079c047d27bba75d230e3be9b51ffa3de'
PATHS=['renderer/virgl-command/resources.mjs','renderer/virgl-command/shared-exponent-images.mjs','renderer/virgl-command/shared-exponent-gpu.mjs']
sha=lambda b:hashlib.sha256(b).hexdigest()


def main():
    diff=subprocess.check_output(['git','diff','--unified=0',BASE,SUBMISSION,'--',*PATHS],cwd=ROOT,text=True)
    added={};name=None;line=0
    for row in diff.splitlines():
        if row.startswith('+++ b/'):name=row[6:]
        elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
        elif row.startswith('+') and name:added.setdefault(name,[]).append(line);line+=1
        elif row.startswith(' '):line+=1
    scripts=[]
    # Final frozen critic run and sealed worker input only; exploratory critic
    # runs remain navigation and are not necessary evidence for this verdict.
    files=[f for directory in (OUT/'unpacked',OUT/'final') for f in directory.rglob('browser-coverage.json')]
    for file in files:
        envelope=json.loads((file.parent/'report.json').read_bytes())
        if envelope.get('status')!='passed':continue
        served={r['path'].lstrip('/'):r['sha256'] for r in envelope['servedFiles']}
        for s in json.loads(file.read_bytes()).get('scripts',[]):
            if s['source'] not in added:continue
            assert s['sha256']==served[s['source']]==sha((ROOT/s['source']).read_bytes())
            scripts.append(dict(record=str(file.relative_to(OUT)),**s))
    for file in (OUT/'unpacked').glob('*/node-coverage/coverage-*.json'):
        for s in json.loads(file.read_bytes())['result']:
            for name in added:
                if s['url'].endswith('/'+name):
                    scripts.append(dict(record=str(file.relative_to(OUT)),source=name,sha256=sha((ROOT/name).read_bytes()),coverage=s))
    results=[];unexecuted=[]
    for name,lines in added.items():
        text=(ROOT/name).read_text();utf16=text.encode('utf-16-le');starts=[0]
        for s in text.splitlines(keepends=True):starts.append(starts[-1]+len(s.encode('utf-16-le'))//2)
        records=[s for s in scripts if s['source']==name]
        ranges=[r for s in records for fn in s['coverage']['functions'] for r in fn['ranges']]
        cuts=sorted(set(x for r in ranges for x in (r['startOffset'],r['endOffset'])))
        for line in lines:
            lo,hi=starts[line-1],starts[line]
            points=[lo]+[c for c in cuts if lo<c<hi]+[hi]
            for a,z in zip(points,points[1:]):
                fragment=utf16[a*2:z*2].decode('utf-16-le');observed=[]
                for s in records:
                    covered=[r for fn in s['coverage']['functions'] for r in fn['ranges'] if r['startOffset']<=a<r['endOffset']]
                    if covered:
                        governing=min(covered,key=lambda r:r['endOffset']-r['startOffset'])
                        observed.append(dict(record=s['record'],**governing))
                count=max((r['count'] for r in observed),default=0)
                row=dict(source=name,line=line,start=a,end=z,fragment=fragment,
                         maxCount=count,governing=observed,status='EXECUTED' if count else 'NEEDS EVIDENCE')
                if not count:
                    if not fragment.strip() or re.fullmatch(r'[\s{};,]*',fragment):
                        row.update(status='WAIVED',reason='Syntax/whitespace has no executable behavior; its enclosing changed native branch is separately judged.')
                    else:unexecuted.append({k:v for k,v in row.items() if k!='governing'})
                results.append(row)
    result=dict(schema='fresh-shared-exponent-full-nested-v8-audit-v1',status='HELD' if not unexecuted else 'NEEDS EVIDENCE',
                authority='Full source UTF16 partitions over union of every nested V8 range boundary; smallest governing interval per recording, then execution union. All observed scripts source/served hashes authenticated.',
                sourceHead='7e88b69a565d0042297e3001c8c4044efdf4cca9',predecessor=BASE,submission=SUBMISSION,
                scriptRecords=len(scripts),addedLines=sum(map(len,added.values())),partitions=len(results),
                executed=sum(r['status']=='EXECUTED' for r in results),waived=sum(r['status']=='WAIVED' for r in results),
                unexecuted=unexecuted,scripts=scripts,regions=results)
    (OUT/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ('status','scriptRecords','addedLines','partitions','executed','waived','unexecuted')}))
    assert not unexecuted


if __name__=='__main__':main()
