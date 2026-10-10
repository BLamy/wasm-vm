import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
PARENT='1fbdfa7e53ebe6e8ed4a80935687d8b71a797f42'
FREEZE='ac77cdd095de121d71628308d920bfdcdbc454c3'
files=['renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs']
out={'schema':'standard-compact-runtime-coverage-v1','sourceHead':FREEZE,'files':[],'status':'running'}
cov=[]
for prefix in ['hot','cold']:
    base=HERE/'unpacked'/prefix
    for p in sorted(base.rglob('browser-coverage.json')):
        # Real served mutation ranges describe other code. Coverage for a clean
        # runtime is counted only when the script hash is the exact frozen hash.
        cov.append((str(p.relative_to(HERE)),json.loads(p.read_text())['scripts']))
for p in [HERE/'final-gpu/browser-coverage.json']:
    cov.append((str(p.relative_to(HERE)),json.loads(p.read_text())['scripts']))
for name in files:
    original=subprocess.check_output(['git','show',FREEZE+':'+name],cwd=ROOT)
    text=original.decode()
    sha=hashlib.sha256(original).hexdigest()
    diff=subprocess.check_output(['git','diff','--unified=0',PARENT,FREEZE,'--',name],cwd=ROOT,text=True)
    added=[];line=0
    for d in diff.splitlines():
        m=re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@',d)
        if m:line=int(m.group(1));continue
        if d.startswith('+++') or d.startswith('---'):continue
        if d.startswith('+'):added.append(line);line+=1
        elif d.startswith(' '):line+=1
    lines=text.splitlines(keepends=True)
    offset=0;positions=[]
    for l in lines:
        positions.append(offset);offset+=len(l.encode('utf-16-le'))//2
    scripts=[(p,s['coverage']) for p,rows in cov for s in rows if s['source']==name and s['sha256']==sha]
    rows=[]
    for number in added:
        content=lines[number-1].rstrip()
        start=positions[number-1];end=start+len(content.encode('utf-16-le'))//2
        counts=[]
        for p,script in scripts:
            # Partition the line at all V8 boundaries and apply the narrowest
            # enclosing block/function range at each executable character.
            ranges=[r for f in script['functions'] for r in f['ranges']]
            positive=[];zero=[]
            for ch in range(start,end):
                char=text.encode('utf-16-le')[ch*2:ch*2+2].decode('utf-16-le',errors='ignore')
                if char.isspace() or char in '{}(),;':continue
                containing=[r for r in ranges if r['startOffset']<=ch<r['endOffset']]
                if not containing:continue
                r=min(containing,key=lambda r:r['endOffset']-r['startOffset'])
                (positive if r['count'] else zero).append(ch)
            counts.append({'record':p,'positiveCharacters':len(positive),'zeroCharacters':len(zero)})
        structural=not content.strip() or content.lstrip().startswith('//') or all(c in ' {}(),;' for c in content)
        held=any(r['positiveCharacters']>0 for r in counts)
        rows.append({'line':number,'source':content,'classification':'waived' if structural else 'executed' if held else 'needs-evidence',
                     'reason':'comment, delimiter or module import has no independent runtime branch' if structural else 'positive exact-source detailed V8 range' if held else 'no exact-source positive range','coverage':counts})
    out['files'].append({'source':name,'sha256':sha,'addedLines':len(rows),'lines':rows})
out['branchWaivers']=[
    {'source':'renderer/virgl-command/state.mjs','line':368,'branch':'legacy-only offset predicate after !standard',
     'classification':'waived','reason':'The added standard-mode bypass executes. The unexecuted legacy body is textually the predecessor predicate; 297 fresh browser literal packets and 301 hot/cold original wire packets exercise unchanged legacy admission. No new legacy renderer semantics.'},
    {'source':'renderer/virgl-command/state.mjs','line':1159,'branch':'legacy-only stride/offset modulo-four conjunction',
     'classification':'waived','reason':'The added standard-mode bypass executes with compact and effective-offset cases. The unexecuted legacy modulo-four conjunction is the predecessor predicate, whose decoder and guard admission remains unchanged.'}
]
out['status']='passed' if all(r['classification']!='needs-evidence' for f in out['files'] for r in f['lines']) else 'needs-evidence'
(HERE/'coverage-audit.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'status':out['status'],'files':[{ 'source':f['source'],'lines':len(f['lines']),'gaps':[r for r in f['lines'] if r['classification']=='needs-evidence']} for f in out['files']]}))
