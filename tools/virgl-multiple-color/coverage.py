#!/usr/bin/env python3
"""Retain every governing nested V8 partition over the changed runtime, not line totals."""
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];BASE='1206a5beb3026de10457cd395d249daf8aff9966';directory=Path(sys.argv[1]).resolve()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
added={};name=None;line=0
for row in git('diff','--unified=0',BASE,'--','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs').splitlines():
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
result=dict(schema='original-multiple-color-full-nested-coverage-v1',gitHead=git('rev-parse','HEAD'),predecessor=BASE,fullRegionsRemainAuthority=True,scripts=scripts,addedLines=added,partitions=partitions,positive=sum(p['maxCount']>0 for p in partitions),zero=[p for p in partitions if p['maxCount']==0])

waiver_rows=json.loads((ROOT/'tools/virgl-multiple-color/coverage-waivers.json').read_text())['waivers']
waiver_map={(r['source'],r['startOffset'],r['endOffset']):r for r in waiver_rows}
result['rawZero']=result['zero'];result['waived']=[];result['zero']=[]
for p in result['rawZero']:
    raw=(ROOT/p['source']).read_text().encode('utf-16-le')[p['startOffset']*2:p['endOffset']*2].decode('utf-16-le')
    key=(p['source'],p['startOffset'],p['endOffset']);waiver=waiver_map.get(key)
    if waiver and raw==waiver['text'] and hashlib.sha256(raw.encode()).hexdigest()==waiver['sha256']:
        old=subprocess.check_output(['git','show',BASE+':'+p['source']],cwd=ROOT,text=True)
        assert raw in old or not raw.strip(), 'changed waiver is not an unchanged predecessor operand'
        result['waived'].append(dict(**p,reason=waiver['reason'],text=raw,predecessorLiteralUnchanged=waiver['predecessorLiteralUnchanged']))
    else:result['zero'].append(p)
(directory/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'positive':result['positive'],'waived':len(result['waived']),'zero':[dict(source=p['source'],line=p['line'],start=p['startOffset'],end=p['endOffset'],text=(ROOT/p['source']).read_text().encode('utf-16-le')[p['startOffset']*2:p['endOffset']*2].decode('utf-16-le')) for p in result['zero']]}))
