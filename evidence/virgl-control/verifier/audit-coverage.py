"""Source-bound changed-line census; native LLVM segments plus innermost CDP ranges."""
from pathlib import Path
import bisect,hashlib,json,re,subprocess
root=Path.cwd();out=root/'evidence/virgl-control/verifier';frozen='252b5eaba8135967c29938e7a5a4709c4d22473d'
changed={};hunks=[];file=None
for line in subprocess.check_output(['git','diff','--unified=0','0b7c9341',frozen],text=True).splitlines():
    if line.startswith('+++ b/'):file=line[6:];changed.setdefault(file,set())
    elif line.startswith('@@'):
        m=re.search(r'\+(\d+)(?:,(\d+))?',line);start=int(m[1]);length=int(m[2] or 1);changed[file].update(range(start,start+length));hunks.append({'path':file,'start':start,'length':length})
native=json.loads((out/'native-coverage.json').read_text());rows=[]
for f in native['files']:
    rel=str(Path(f['filename']).relative_to(root));text=(root/rel).read_text().splitlines();segments=f['segments'];line_results=[]
    for n in sorted(changed[rel]):
        content=text[n-1];a=(n,len(content)-len(content.lstrip())+1);b=(n,len(content)+1);counts=[]
        for i,s in enumerate(segments):
            start=tuple(s[:2]);end=tuple(segments[i+1][:2])if i+1<len(segments)else(10**9,0)
            if start>=b:break
            if end>a and s[3]and not s[5]:counts.append(s[2])
        line_results.append({'line':n,'count':max(counts)if counts else None,'text':content.strip()})
    zero=[]
    for i,s in enumerate(segments[:-1]):
        e=segments[i+1]
        if not s[2]and s[3]and not s[5]and s[:2]!=e[:2]and any(n in changed[rel]for n in range(s[0],e[0]+1)):
            zero.append({'start':s[:2],'end':e[:2],'text':text[s[0]-1].strip()})
    rows.append({'path':rel,'sha256':hashlib.sha256((root/rel).read_bytes()).hexdigest(),'summary':f['summary'],'changedLines':line_results,'unhitSegments':zero})
worker=json.loads((root/'evidence/virgl-control/worker/hardware/browser-coverage.json').read_text())['scripts'];own=json.loads((out/'browser-coverage.json').read_text())['scripts'];js=[]
for item in worker:
    source=item['source']
    if source!='renderer/virgl-command/control-bridge.mjs'and not source.endswith('/inline1.js'):continue
    content=(root/source).read_text();scripts=[item['coverage']]+[s for s in own if s['url'].endswith('/'+source)];all_ranges=[[r for f in s['functions']for r in f['ranges']]for s in scripts];positions=sorted({0,len(content),*[r[k]for ranges in all_ranges for r in ranges for k in ['startOffset','endOffset']]});unhit=[]
    for a,b in zip(positions,positions[1:]):
        if not content[a:b].strip():continue
        counts=[]
        for ranges in all_ranges:
            containing=[r for r in ranges if r['startOffset']<=a and r['endOffset']>=b]
            if containing:counts.append(min(containing,key=lambda r:r['endOffset']-r['startOffset'])['count'])
        if counts and max(counts)==0:unhit.append({'startOffset':a,'endOffset':b,'text':content[a:b]})
    js.append({'path':source,'sha256':hashlib.sha256(content.encode()).hexdigest(),'unhitNonWhitespace':unhit,'recordings':len(scripts)})
assert all(not r['unhitNonWhitespace']for r in js),js
summary={r['path']:{'changed':len(r['changedLines']),'hit':sum(bool(x['count'])for x in r['changedLines']),'zero':sum(x['count']==0 for x in r['changedLines']),'noninstrumented':sum(x['count']is None for x in r['changedLines'])}for r in rows}
report={'schema':1,'frozenHead':frozen,'baseline':'0b7c9341','hunks':hunks,'native':rows,'js':js,'summary':summary,'interpretation':'Counts are executed LLVM/CDP ranges, not blanket branch coverage. Review.md gives narrow reasons for all remaining zero/defensive and noninstrumented ranges; Wasm Rust wrapper maps to recorded API/event scenarios rather than native LLVM.'}
(out/'coverage-review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'native':summary,'jsUnhitNonWhitespace':sum(len(x['unhitNonWhitespace'])for x in js),'hunks':len(hunks)},indent=2))
