#!/usr/bin/env python3
"""Retain every governing nested V8 partition over the changed runtime, not line totals."""
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];BASE='3e5e41429aadc9acbe68fade926d2763d1e2a356';directory=Path(sys.argv[1]).resolve()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
added={};name=None;line=0
for row in git('diff','--unified=0',BASE,'--','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs').splitlines():
    if row.startswith('+++ b/'):name=row[6:]
    elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
    elif row.startswith('+') and name:added.setdefault(name,[]).append(line);line+=1
    elif row.startswith(' '):line+=1
scripts=[]
for file in directory.rglob('browser-coverage.json'):
    if '/fault-' in str(file):continue
    for row in json.loads(file.read_text())['scripts']:
        if row['source'] in added:scripts.append(dict(record=file.relative_to(directory).as_posix(),**row))
for file in (directory/'node-coverage').glob('coverage-*.json'):
    for row in json.loads(file.read_text())['result']:
        if row['url'].startswith(ROOT.as_uri()+'/'):
            name=row['url'][len(ROOT.as_uri())+1:]
            if name in added:scripts.append(dict(record=file.relative_to(directory).as_posix(),source=name,sha256=hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),coverage=row))
for script in scripts:
    assert script['sha256']==hashlib.sha256((ROOT/script['source']).read_bytes()).hexdigest(), 'stale runtime coverage record'
partitions=[]
for name,lines in added.items():
    text=(ROOT/name).read_text().splitlines(keepends=True);offsets=[0]
    for row in text:offsets.append(offsets[-1]+len(row.encode('utf-16-le'))//2)
    observed=[s for s in scripts if s['source']==name]
    for line in lines:
        start,end=offsets[line-1],offsets[line];points={start,end}
        for script in observed:
            for fn in script['coverage']['functions']:
                for r in fn['ranges']:
                    for offset in (r['startOffset'],r['endOffset']):
                        if start<offset<end:points.add(offset)
        points=sorted(points)
        for a,b in zip(points,points[1:]):
            counters=[]
            for script in observed:
                candidates=[r for fn in script['coverage']['functions'] for r in fn['ranges'] if r['startOffset']<=a and b<=r['endOffset']]
                if candidates:counters.append(dict(record=script['record'],**min(candidates,key=lambda r:r['endOffset']-r['startOffset'])))
            partitions.append(dict(source=name,line=line,startOffset=a,endOffset=b,maxCount=max((c['count'] for c in counters),default=0),counters=counters))
result=dict(schema='original-packed-normalized-consumer-full-nested-coverage-v1',gitHead=git('rev-parse','HEAD'),predecessor=BASE,fullRegionsRemainAuthority=True,scripts=scripts,addedLines=added,partitions=partitions,positive=sum(p['maxCount']>0 for p in partitions),zero=[p for p in partitions if p['maxCount']==0])

result['rawZero']=list(result['zero']);result['waived']=[]
waivers={(r['source'],r['startOffset'],r['endOffset']):r for r in json.loads((ROOT/'tools/virgl-packed-normalized-consumer/coverage-waivers.json').read_text())['waivers']}
result['zero']=[]
for p in result['rawZero']:
    key=(p['source'],p['startOffset'],p['endOffset']);r=waivers.get(key);raw=(ROOT/p['source']).read_text().encode('utf-16-le')[p['startOffset']*2:p['endOffset']*2].decode('utf-16-le')
    if r and r['text']==raw and hashlib.sha256(raw.encode()).hexdigest()==r['sha256']:
        old=subprocess.check_output(['git','show',BASE+':'+p['source']],cwd=ROOT)
        assert hashlib.sha256(old).hexdigest()==r['predecessorSourceSha256'] and raw.encode() in old and 'normalized' not in raw.lower()
        result['waived'].append(dict(**p,reason=r['reason'],predecessorSourceSha256=r['predecessorSourceSha256']))
    else:result['zero'].append(p)

(directory/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(positive=result['positive'],zero=[dict(source=p['source'],line=p['line'],start=p['startOffset'],end=p['endOffset'],text=(ROOT/p['source']).read_text().encode('utf-16-le')[p['startOffset']*2:p['endOffset']*2].decode('utf-16-le')) for p in result['zero']])))
assert not result['zero'],'unexecuted changed governing runtime partitions'
