#!/usr/bin/env python3
"""Require every finest V8 partition over the changed runtime to execute."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
repo=Path(__file__).resolve().parents[2];root=Path(sys.argv[1]).resolve();base='37a6794437424049d38acb733191a16c1cdca998'
sha=lambda b:hashlib.sha256(b).hexdigest();paths=['renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs']
diff=subprocess.check_output(['git','diff','--unified=0',base,'--',*paths],cwd=repo,text=True)
changed={};name=None;line=0
for row in diff.splitlines():
    if row.startswith('+++ b/'):name=row[6:]
    elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
    elif row.startswith('+') and name:changed.setdefault(name,[]).append(line);line+=1
    elif row.startswith(' '):line+=1
scripts=[]
for record in ['hardware','historical-resources','historical-images']:
    report=json.loads((root/record/'report.json').read_bytes());assert report['status']=='passed'
    coverage=json.loads((root/record/'browser-coverage.json').read_bytes());assert sha((root/record/'browser-coverage.json').read_bytes())==report['browserCoverage']['sha256']
    for s in coverage.get('scripts',[coverage]):
        if s['source'] in changed:
            assert s['sha256']==sha((repo/s['source']).read_bytes());scripts.append(dict(record=record,**s))
partitions=[];waived=[];zero=[]
for name,lines in changed.items():
    text=(repo/name).read_text();utf=text.encode('utf-16-le');rows=text.splitlines(keepends=True);offsets=[0]
    for row in rows:offsets.append(offsets[-1]+len(row.encode('utf-16-le'))//2)
    observed=[s for s in scripts if s['source']==name]
    for line in lines:
        start,end=offsets[line-1],offsets[line];points={start,end}
        for s in observed:
            for f in s['coverage']['functions']:
                for r in f['ranges']:
                    points.update(v for v in [r['startOffset'],r['endOffset']] if start<v<end)
        points=sorted(points)
        for a,b in zip(points,points[1:]):
            raw=utf[a*2:b*2].decode('utf-16-le');counters=[]
            for s in observed:
                ranges=[r for f in s['coverage']['functions'] for r in f['ranges'] if r['startOffset']<=a and b<=r['endOffset']]
                if ranges:
                    size=min(r['endOffset']-r['startOffset'] for r in ranges)
                    finest=[r for r in ranges if r['endOffset']-r['startOffset']==size]
                    counters.append(dict(record=s['record'],ranges=finest,count=min(r['count'] for r in finest)))
            p=dict(source=name,line=line,startOffset=a,endOffset=b,text=raw,sha256=sha(raw.encode()),counters=counters,maxCount=max((v['count'] for v in counters),default=0))
            if p['maxCount']>0:partitions.append(p)
            elif not raw.strip() or re.fullmatch(r'[\s{}(),;]+',raw) or rows[line-1].lstrip().startswith(('//','/*','*')):
                waived.append(dict(**p,reason='Only whitespace, comments or structural delimiters; no executable operand.'))
            else:zero.append(p)
result=dict(schema='dimensional-storage-finest-v8-v1',head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),base=base,
            changedLines=changed,scripts=scripts,executed=partitions,waived=waived,needsEvidence=zero)
(root/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(executed=len(partitions),waived=len(waived),needsEvidence=[dict(source=p['source'],line=p['line'],text=p['text']) for p in zero])))
assert not zero,'unexecuted changed runtime partition'
