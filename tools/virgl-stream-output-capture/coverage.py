"""Report every governing nested V8 counter over the selected runtime diff.

Zero counters remain explicit proof gaps; this ledger does not infer execution
from a line total or classify untested error branches as static declarations.
"""
import hashlib,json,re,subprocess,sys
from pathlib import Path
repo=Path(__file__).resolve().parents[2];root=Path(sys.argv[1]).resolve()
base='967826b1539c3099b2da5952a553c282b0428d35';runtime='75c3a664a0df8f0fb3ce4ff1c248a4167411c09d'
paths=['renderer/virgl-command/'+n+'.mjs' for n in ['constant-domain','control-bridge','decoder','resources','state']]
git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True)
sha=lambda b:hashlib.sha256(b).hexdigest();changed={};name=None;line=0
for row in git('diff','--unified=0',base,runtime,'--',*paths).splitlines():
    if row.startswith('+++ b/'):name=row[6:]
    elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
    elif row.startswith('+') and name:changed.setdefault(name,[]).append(line);line+=1
    elif row.startswith(' '):line+=1
scripts=[]
for group in ['layouts','primitives','retirement','selected-regression']:
    file=root/group/'browser-coverage.json';report=json.loads((file.parent/'report.json').read_bytes())
    assert report['status']=='passed';data=json.loads(file.read_bytes())
    for record in data['scripts']:
        if record['source'] not in paths:continue
        body=git('show',runtime+':'+record['source']).encode();assert sha(body)==record['sha256']
        scripts.append(dict(record=file.relative_to(root).as_posix(),**record))
for file in sorted([*(root/'node-coverage').glob('coverage-*.json'),*(root/'metadata-supplement/node-coverage').glob('coverage-*.json')]):
    for record in json.loads(file.read_bytes())['result']:
        name=next((p for p in paths if record['url'].endswith('/'+p)),None)
        if name:
            body=git('show',runtime+':'+name).encode();assert (root/'sources'/name).read_bytes()==body
            scripts.append(dict(record=file.relative_to(root).as_posix(),source=name,sha256=sha(body),coverage=record))
executed=[];static=[];missing=[]
for name,lines in changed.items():
    body=git('show',runtime+':'+name);rows=body.splitlines(keepends=True);raw=body.encode('utf-16-le');starts=[0]
    for row in rows:starts.append(starts[-1]+len(row.encode('utf-16-le'))//2)
    observed=[s for s in scripts if s['source']==name]
    for line in lines:
        a0,b0=starts[line-1:line+1];points={a0,b0}
        for s in observed:
            for f in s['coverage']['functions']:
                for r in f['ranges']:points.update(at for at in [r['startOffset'],r['endOffset']] if a0<at<b0)
        points=sorted(points)
        for a,b in zip(points,points[1:]):
            counters=[]
            for s in observed:
                ranges=[r for f in s['coverage']['functions'] for r in f['ranges'] if r['startOffset']<=a and b<=r['endOffset']]
                if ranges:counters.append(dict(record=s['record'],**min(ranges,key=lambda r:(r['endOffset']-r['startOffset'],r['count']))))
            text=raw[a*2:b*2].decode('utf-16-le');p=dict(source=name,line=line,startOffset=a,endOffset=b,text=text,sha256=sha(text.encode()),maxCount=max((r['count'] for r in counters),default=0),counters=counters)
            if p['maxCount']>0:executed.append(p)
            elif not text.strip() or re.fullmatch(r'[\s{}(),;:?]+',text) or rows[line-1].lstrip().startswith(('//','/*','*')):static.append(dict(**p,reason='Whitespace, comments or delimiters contain no executable operand.'))
            else:missing.append(p)
result=dict(schema='stream-output-capture-full-nested-coverage-v1',runtimeHead=runtime,base=base,scripts=scripts,changedLines=changed,executed=executed,staticWaivers=static,needsEvidence=missing)
(root/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(executed=len(executed),static=len(static),needsEvidence=[{k:p[k] for k in ['source','line','text']} for p in missing])))
