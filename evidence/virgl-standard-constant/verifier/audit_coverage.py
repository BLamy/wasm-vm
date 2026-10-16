import hashlib,json,re,subprocess
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[2];path='renderer/virgl-command/state.mjs';src=(ROOT/path).read_text();digest=hashlib.sha256(src.encode()).hexdigest()
diff=subprocess.check_output(['git','diff','--unified=0','67220bb5ed0dfab2e06563b6353fd6975f9696b9','39a9d14b7052c60ca11416bdba4e6eb78a38b1dd','--',path],cwd=ROOT,text=True)
changed=[];line=0;hunks=[]
for l in diff.splitlines():
    if l.startswith('@@'):
        line=int(re.search(r'\+(\d+)',l)[1]);hunks.append(dict(header=l,lines=[]));continue
    if l.startswith('+++') or l.startswith('---'):continue
    if l.startswith('+'):changed.append(line);hunks[-1]['lines'].append(line);line+=1
    elif l.startswith('-'):continue
    elif l.startswith(' '):line+=1
coverage=[]
for side in ['hot','cold']:
    for name in ['hardware','retained-standard-draw/hardware']:
        cp=BASE/'unpacked'/side/name/'browser-coverage.json'
        if not cp.exists():continue
        cov=json.loads(cp.read_text())
        for script in cov['scripts']:
            if script['source']==path:
                assert script['sha256']==digest
                coverage.append((str(cp.relative_to(BASE)),script['coverage']['functions']))
lines=src.splitlines(keepends=True);starts=[];offset=0
for l in lines:starts.append(offset);offset+=len(l)
out=[]
for l in changed:
    t=lines[l-1];o=starts[l-1]+len(t)-len(t.lstrip());hits=[]
    for p,functions in coverage:
        ranges=[(r['endOffset']-r['startOffset'],r['count'],f['functionName']) for f in functions for r in f['ranges'] if r['startOffset']<=o<r['endOffset']]
        if ranges:
            width=min(r[0] for r in ranges);count=min(r[1] for r in ranges if r[0]==width);hits.append(dict(record=p,count=count,function=next(r[2] for r in ranges if r[0]==width)))
    hit=any(r['count']>0 for r in hits);out.append(dict(line=l,text=t.rstrip(),executed=hit,hits=hits))
unexecuted=[]
for l in changed:
    for o in range(starts[l-1],starts[l-1]+len(lines[l-1])):
        if not src[o].isalnum():continue
        reached=False
        for _,functions in coverage:
            ranges=[r for fn in functions for r in fn['ranges'] if r['startOffset']<=o<r['endOffset']]
            if ranges and min(ranges,key=lambda r:r['endOffset']-r['startOffset'])['count']>0:
                reached=True;break
        if not reached:unexecuted.append(dict(line=l,offset=o,character=src[o]))
assert not unexecuted,'changed runtime token is unproven'
result=dict(schema='D7-scoped-coverage-v1',stateDigest=digest,base='67220bb5ed0dfab2e06563b6353fd6975f9696b9',runtimeFreeze='39a9d14b7052c60ca11416bdba4e6eb78a38b1dd',hunks=hunks,lines=out,unexecutedRuntimeTokens=unexecuted)
(BASE/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print('records',len(coverage),'added/changed lines',len(out),'unhit lines',[(x['line'],x['text']) for x in out if not x['executed']])
for x in out:print(x['line'],max([r['count'] for r in x['hits']] or [0]),x['text'])
