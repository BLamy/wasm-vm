import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
PARENT='b98847797f109b0a3af6171fd0a8c21983e1057b'
FREEZE='1b8e94b79de6ee79f72116246ce4042aa7bda815'
files=['renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/tests/standard-compact-vertex-fetch.mjs','renderer/virgl-command/tests/standard-compact-vertex-fetch-adversarial.mjs','renderer/virgl-command/tests/standard-instanced-draws.mjs']
out={'schema':'standard-scalar-runtime-coverage-v1','sourceHead':FREEZE,'files':[],'status':'running'}
cov=[]
for prefix in ['hot','cold']:
    base=HERE/'unpacked'/prefix
    for p in sorted(base.rglob('browser-coverage.json')):
        # Real served mutation ranges describe other code. Coverage for a clean
        # runtime is counted only when the script hash is the exact frozen hash.
        cov.append((str(p.relative_to(HERE)),json.loads(p.read_text())['scripts']))
for p in [p for p in [HERE/'final-gpu/browser-coverage.json'] if p.exists()]:
    cov.append((str(p.relative_to(HERE)),json.loads(p.read_text())['scripts']))

for kind in ['scalar','compact']:
    report=json.loads((HERE/f'node-{kind}-wire/report.json').read_text())
    digests={r['path']:r['sha256'] for r in report['sources']}
    for p in sorted((HERE/f'node-{kind}-coverage').glob('*.json')):
        data=json.loads(p.read_text()); rows=[]
        for script in data['result']:
            for name,digest in digests.items():
                if script['url'].endswith('/'+name):
                    rows.append({'source':name,'sha256':digest,'coverage':script})
        cov.append((str(p.relative_to(HERE)),rows))
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
        counts=[];everPositive=set();everRanged=set()
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
            everPositive.update(positive);everRanged.update(positive+zero)
            counts.append({'record':p,'positiveCharacters':len(positive),'zeroCharacters':len(zero)})
        structural=not content.strip() or content.lstrip().startswith('//') or all(c in ' {}(),;' for c in content)
        held=any(r['positiveCharacters']>0 for r in counts)
        uncovered=sorted(everRanged-everPositive)
        runs=[]
        for ch in uncovered:
            if runs and ch==runs[-1][-1]+1:runs[-1].append(ch)
            else:runs.append([ch])
        segments=[text.encode('utf-16-le')[r[0]*2:(r[-1]+1)*2].decode('utf-16-le',errors='ignore') for r in runs]
        rows.append({'line':number,'source':content,'neverCoveredExecutableSegments':segments,'classification':'waived' if structural else 'executed' if held else 'needs-evidence',
                     'reason':'comment, delimiter or module import has no independent runtime branch' if structural else 'positive exact-source detailed V8 range' if held else 'no exact-source positive range','coverage':counts})
    out['files'].append({'source':name,'sha256':sha,'addedLines':len(rows),'lines':rows})
out['branchWaivers']=[{'source':'renderer/virgl-command/tests/standard-compact-vertex-fetch.mjs','line':9,'branch':'throw Error(unsupported fixture format)','classification':'waived','reason':'Fixture-only failure for an out-of-matrix format is textually the predecessor guard. The widened family search and all newly admitted widths execute; this unchanged harness guard adds no scalar runtime behavior.'}]
out['status']='passed' if all(r['classification']!='needs-evidence' for f in out['files'] for r in f['lines']) else 'needs-evidence'
(HERE/'coverage-audit.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'status':out['status'],'files':[{ 'source':f['source'],'lines':len(f['lines']),'gaps':[r for r in f['lines'] if r['classification']=='needs-evidence']} for f in out['files']]}))
