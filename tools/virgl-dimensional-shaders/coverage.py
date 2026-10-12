#!/usr/bin/env python3
"""Retain every governing nested V8 partition over the changed runtime, not line totals."""
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];BASE='48b2ba0c7ee90d13093f7782e5a2502e44095753';directory=Path(sys.argv[1]).resolve()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
added={};name=None;line=0
for row in git('diff','--unified=0',BASE,'--','renderer/virgl-shader/standard.mjs').splitlines():
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
                if candidates:counters.append(dict(record=script['record'],**min(candidates,key=lambda r:(r['endOffset']-r['startOffset'],r['count']))))
            partitions.append(dict(source=name,line=line,startOffset=a,endOffset=b,maxCount=max((c['count'] for c in counters),default=0),counters=counters))
result=dict(schema='original-dimensional-texture-full-nested-coverage-v1',gitHead=git('rev-parse','HEAD'),predecessor=BASE,fullRegionsRemainAuthority=True,scripts=scripts,addedLines=added,partitions=partitions,positive=sum(p['maxCount']>0 for p in partitions),zero=[p for p in partitions if p['maxCount']==0])
native_files=['renderer/virgl-shader/'+name for name in ['standard_guard.c','standard_emit.c','bridge.c','standard_guard.h']]
native_added={};name=None;line=0
for row in git('diff','--unified=0',BASE,'--',*native_files).splitlines():
    if row.startswith('+++ b/'):name=row[6:]
    elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
    elif row.startswith('+') and name:native_added.setdefault(name,[]).append(line);line+=1
    elif row.startswith(' '):line+=1
native_records=[]
for file in sorted((directory/'coverage').glob('*.json')):
    data=json.loads(file.read_text())
    for fn in data['data'][0]['functions']:
        if any(Path(p).is_relative_to(ROOT) and Path(p).relative_to(ROOT).as_posix() in native_added for p in fn['filenames']):
            native_records.append(dict(record=file.relative_to(directory).as_posix(),**fn))
native_partitions=[];waivers=[]
for name,lines in native_added.items():
    full=(ROOT/name).read_text();source_lines=full.splitlines(keepends=True);offsets=[0]
    for row in source_lines:offsets.append(offsets[-1]+len(row))
    scopes=[]
    for fn in native_records:
        regions=[]
        for r in fn['regions']:
            if r[7]!=0 or Path(fn['filenames'][r[5]]).resolve()!=ROOT/name:continue
            a=offsets[r[0]-1]+r[1]-1;b=offsets[r[2]-1]+r[3]-1
            if a<b:regions.append(dict(start=a,end=b,count=r[4],original=r))
        if regions:scopes.append(dict(record=fn['record'],function=fn['name'],regions=regions))
    for line in lines:
        start,end=offsets[line-1],offsets[line];points={start,end}
        for scope in scopes:
            for r in scope['regions']:
                for at in [r['start'],r['end']]:
                    if start<at<end:points.add(at)
        points=sorted(points)
        for a,b in zip(points,points[1:]):
            if not full[a:b].strip():continue
            counters=[]
            for scope in scopes:
                candidates=[r for r in scope['regions'] if r['start']<=a and b<=r['end']]
                if candidates:
                    r=min(candidates,key=lambda r:(r['end']-r['start'],r['count']));counters.append(dict(record=scope['record'],function=scope['function'],**r))
            if not counters:
                waivers.append(dict(source=name,line=line,start=a,end=b,text=full[a:b],reason='Declaration, signature, comment or punctuation outside executable LLVM regions; ABI/types checked by full native/sanitized/Wasm matrix.'))
            else:native_partitions.append(dict(source=name,line=line,start=a,end=b,text=full[a:b],maxCount=max(r['count'] for r in counters),counters=counters))
result.update(llvm=native_records,nativeAddedLines=native_added,nativePartitions=native_partitions,nativePositive=sum(p['maxCount']>0 for p in native_partitions),nativeZero=[p for p in native_partitions if p['maxCount']==0],nativeDeclarationWaivers=waivers)
(directory/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ('positive','zero','nativePositive','nativeZero')}))
