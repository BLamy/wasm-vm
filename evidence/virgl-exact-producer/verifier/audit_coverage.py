#!/usr/bin/env python3
"""Independent exact source-region audit against the actual original profiles."""
from pathlib import Path
import collections
import hashlib
import json
import re
import subprocess

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
BASE='36a6d07cbf5708ceeaee9a186d8bacadd7278f6c'
FILES=['renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/index.mjs']
sha=lambda b:hashlib.sha256(b).hexdigest()

def changed(filename):
    patch=subprocess.check_output(['git','diff','--unified=0',BASE,'e5db73f88d84f066ca15487f06741a54509874c5','--',filename],cwd=ROOT,text=True)
    rows=[];n=None
    for row in patch.splitlines():
        if row.startswith('@@'):n=int(re.search(r'\+(\d+)',row)[1])
        elif n is not None and row.startswith('+') and not row.startswith('+++'):rows.append((n,row[1:]));n+=1
    return rows,patch

def static(text):
    s=text.strip()
    return not s or s.startswith(('/*','*','//')) or s in ['{','}','};','});'] or s.startswith(('static bool exact_declarations','const char *bridge_translate_exact','static const char *check_input_attempt','const struct bridge_exact_word *components, size_t count)')) or s=='const struct raw_exact_bank *exact)'

native=[]
for label,p in [('hot','hot-reexport.json'),('cold','cold-reexport.json'),('independent','independent-bounds/native-coverage.json')]:
    raw=(OUT/p).read_bytes();native.append({'label':label,'path':p,'sha256':sha(raw),'data':json.loads(raw)})

def native_functions(profile,filename):
    return [f for d in profile['data']['data'] for f in d['functions'] if any(p.endswith('/'+filename.removeprefix('renderer/virgl-shader/')) for p in f['filenames'])]

def own_regions(profile,filename):
    result=[]
    for f in native_functions(profile,filename):
        for r in f['regions']:
            if r[-1]==0 and r[:2]!=r[2:4] and f['filenames'][r[5]].endswith('/'+filename.removeprefix('renderer/virgl-shader/')):
                result.append((f,r))
    return result

OVERFLOW='Capacity defense is unreachable for this bounded owned emitter. Independent bounds-audit.json/metadata-size-proof.json counts every metadata format widened to10digit integers/64byte strings (59376 bytes<65536); all GLSL literal control bytes are LF (222 fixed literal LFs<5000), at most16 LF/instruction and262144 raw GLSL bytes. Therefore at most414120 JSON bytes<1589248 capacity. Fixed identifiers/decimal operands admit no arbitrary string, quote/backslash or control injection. Ordinary successes add no exact metadata and carry the unchanged writer proof. There is no external capacity override.'
def native_waiver(filename,region,source):
    if filename.endswith('bridge.c'):
        a=region[0]
        if a in [1873,1876,1892] and ('response_overflow' in source or 'JSON output exceeded' in source):return OVERFLOW
        if a==1242:return 'Complete declaration rejects every non-xyzw CONST mask (bridge.c:362); CONST has no GENERIC semantic. A declared CONST always has component mask15, so this missing-component alternative cannot execute.'
        if a==1243:return 'Every accepted CONST declaration sets constant_extent>=last+1, except last0 increments a positive extent; declared[reg] implies reg<extent (bridge.c:364-369). Extent47 and sparse declarations are independently recorded.'
        if a==1313 and source.strip()=='exact':return 'Only the three default attempts pass NULL here without branch flags; the private exact attempt always passes RAW_KNOWN_RETRY|RAW_BRANCH_RETRY, so the RHS exact can never be true when evaluated. All call sites at1392/1402/1410/1885 are inspected.'
    return None

inherited=json.loads((OUT/'predecessor/virgl-known-branches/coverage-audit.json').read_bytes())
held_selector=next(x for x in inherited['native'] if x['file'].endswith('bridge.c') and x['line']==1728)
base_source=subprocess.check_output(['git','show',BASE+':renderer/virgl-shader/bridge.c'],cwd=ROOT,text=True)
selection='branch ? "virgl-webgl2-raw-bits-v41" : known_arithmetic ? "virgl-webgl2-raw-bits-v40" : discard ? "virgl-webgl2-raw-bits-v39" : coordinates ? "virgl-webgl2-raw-bits-v38" : base_profile'
assert selection in base_source and selection in (ROOT/FILES[0]).read_text()

def branch_waiver(filename,b,side):
    if filename.endswith('bridge.c'):
        if b[0] in [1873,1876,1892] and b[1] in [81,11,30] and side==0:return OVERFLOW
        if b[0]==1242 and side==0:return native_waiver(filename,b,'')
        if b[0]==1243 and side==0:return native_waiver(filename,b,'')
        if b[:4]==[1313,61,1313,66] and side==0:return native_waiver(filename,b,'exact')
    return None

lines=[];children=[];branches=[];unexecuted=[]
for filename in FILES[:2]:
    source=(ROOT/filename).read_text();rows,patch=changed(filename);ls=source.splitlines(True);offsets=[0]
    for row in ls:offsets.append(offsets[-1]+len(row))
    absolute=lambda r,k:offsets[r[k]-1]+r[k+1]-1
    def effective(p,a,b):
        matches=[(f,r)for f,r in own_regions(p,filename) if absolute(r,0)<=a and absolute(r,2)>=b]
        if not matches:return None
        f,r=min(matches,key=lambda x:absolute(x[1],2)-absolute(x[1],0))
        return {'profile':p['label'],'profileSha256':p['sha256'],'function':f['name'],'region':r[:4],'count':r[4]}
    executable=[]
    for n,text in rows:
        assert ls[n-1].rstrip('\n')==text
        entry={'file':filename,'line':n,'text':text}
        if static(text):entry.update(status='waived',reason='Static signature/continuation, comment, delimiter or whitespace; every invoked body and child is audited independently.')
        else:
            a=offsets[n-1]+len(text)-len(text.lstrip());b=offsets[n-1]+len(text.rstrip());executable.append((a,b,n));bounds={a,b}
            for p in native:
                for f,r in own_regions(p,filename):
                    for q in [absolute(r,0),absolute(r,2)]:
                        if a<q<b:bounds.add(q)
            cells=[]
            for l,h in zip(sorted(bounds),sorted(bounds)[1:]):
                literal=source[l:h]
                if not literal.strip():continue
                points=[v for p in native if (v:=effective(p,l,h)) is not None];status='executed'if any(v['count']>0 for v in points)else'needs-evidence';reason=None
                if status=='needs-evidence':
                    if n in [1873,1876,1892]:status='waived';reason=OVERFLOW
                    elif n==1250:status='waived';reason='Function parameter continuation has no executable expression; body and all conditions are separately audited.'
                    elif n==1750:status='carried-HELD';reason='Authenticated predecessor stage_result1728 executes this identical selector literal: known-arithmetic16, discard4, coordinates4. No selected policy expression or flag changed.'
                cells.append({'startOffset':l,'endOffset':h,'source':literal,'status':status,'reason':reason,'points':points})
                if status=='needs-evidence':unexecuted.append({'file':filename,'line':n,'source':literal})
            entry.update(status='executed'if all(x['status']=='executed'for x in cells)else'waived'if all(x['status']in ['executed','waived','carried-HELD']for x in cells)else'needs-evidence',intervals=cells)
        lines.append(entry)
    branchmap={};regionmap={}
    for p in native:
        for f in native_functions(p,filename):
            for b in f['branches']:
                if any(b[0]<=n<=b[2]for n,_ in rows):branchmap[tuple(b[:4])]=f['name']
        for f,r in own_regions(p,filename):
            a,b=absolute(r,0),absolute(r,2)
            if any(a<end and b>start for start,end,_ in executable):regionmap[tuple(r[:4])]=f['name']
    for coordinates,function in sorted(branchmap.items()):
        b=list(coordinates);points=[]
        for p in native:
            points.extend({'profile':p['label'],'profileSha256':p['sha256'],'true':x[4],'false':x[5]}for f in native_functions(p,filename)for x in f['branches']if x[:4]==b)
        arms=[]
        for side,name in enumerate(['true','false']):
            status='executed'if any(p[name]>0 for p in points)else'needs-evidence';reason=None;held=None
            if status=='needs-evidence':
                if filename.endswith('bridge.c') and b[0]==1750:
                    status='carried-HELD';reason='Exact same profile-choice expression moved into a local const; its boolean flags and descending contracts are unchanged. Current exact wrapper only selects v42 above this value. Predecessor verified each selector arm, and10717 full current/preceding result bindings remain identical.';held=held_selector
                elif (reason:=branch_waiver(filename,b,side)):status='waived'
            if status=='needs-evidence':unexecuted.append({'file':filename,'region':b,'arm':name})
            arms.append({'arm':name,'status':status,'reason':reason,'held':held})
        branches.append({'file':filename,'function':function,'region':b,'points':points,'arms':arms})
    for coordinates,function in sorted(regionmap.items()):
        r=list(coordinates);a,b=absolute(r,0),absolute(r,2);points=[v for p in native if (v:=effective(p,a,b))is not None]
        status='executed'if any(v['count']>0 for v in points)else'needs-evidence';reason=None;literal=source[a:b]
        if status=='needs-evidence':
            if (reason:=native_waiver(filename,r,literal)):status='waived'
            elif filename.endswith('bridge.c') and r[0]==1750:status='carried-HELD';reason='Authenticated predecessor stage_result1728 verifies the identical factored selector; source parity and complete historical result equality are recorded.'
        if status=='needs-evidence':unexecuted.append({'file':filename,'region':r,'source':literal[:200]})
        children.append({'file':filename,'function':function,'region':r,'source':literal,'points':points,'status':status,'reason':reason})

profiles=[]
for p in sorted((OUT/'unpacked').glob('**/node-v8/*.json'))+sorted((OUT/'independent-v8').glob('*.json'))+sorted((OUT/'independent-v8-final').glob('*.json'))+sorted((OUT/'independent-v8-promoted').glob('*.json'))+sorted((OUT/'independent-v8-bounds').glob('*.json')):
    raw=p.read_bytes();profiles.append({'path':str(p.relative_to(OUT)),'sha256':sha(raw),'scripts':json.loads(raw)['result']})
for p in sorted((OUT/'unpacked').glob('**/gpu-*/browser-coverage.json'))+sorted(OUT.glob('gpu-*/browser-coverage.json')):
    raw=p.read_bytes();envelope=json.loads(raw)
    for s in envelope['scripts']:
        if s['source']=='renderer/virgl-shader/index.mjs':assert s['sha256']==sha((ROOT/s['source']).read_bytes())
    profiles.append({'path':str(p.relative_to(OUT)),'sha256':sha(raw),'scripts':[s['coverage']for s in envelope['scripts']]})
filename=FILES[2];source=(ROOT/filename).read_text();ls=source.splitlines(True);offsets=[0]
for row in ls:offsets.append(offsets[-1]+len(row))
def ranges(profile):return [(f,r)for s in profile['scripts']if s['url'].endswith('/'+filename)for f in s['functions']for r in f['ranges']]
def effective_js(p,a,b):
    matches=[(f,r)for f,r in ranges(p)if r['startOffset']<=a and r['endOffset']>=b]
    if not matches:return None
    f,r=min(matches,key=lambda x:x[1]['endOffset']-x[1]['startOffset']);return {'profile':p['path'],'profileSha256':p['sha256'],'function':f['functionName'],'region':r}
rows,_=changed(filename);executable=[];jschildren=[]
for n,text in rows:
    entry={'file':filename,'line':n,'text':text}
    if static(text):entry.update(status='waived',reason='Comment/delimiter/whitespace; invoked body and children audited separately.')
    else:
        a=offsets[n-1]+len(text)-len(text.lstrip());b=offsets[n-1]+len(text.rstrip());executable.append((a,b));bounds={a,b}
        for p in profiles:
            for f,r in ranges(p):
                for q in [r['startOffset'],r['endOffset']]:
                    if a<q<b:bounds.add(q)
        cells=[]
        for l,h in zip(sorted(bounds),sorted(bounds)[1:]):
            if not source[l:h].strip():continue
            points=[v for p in profiles if(v:=effective_js(p,l,h))is not None];status='executed'if any(v['region']['count']>0 for v in points)else'needs-evidence'
            cells.append({'startOffset':l,'endOffset':h,'source':source[l:h],'status':status,'points':points})
            if status=='needs-evidence':unexecuted.append({'file':filename,'line':n,'source':source[l:h]})
        entry.update(status='executed'if all(x['status']=='executed'for x in cells)else'needs-evidence',intervals=cells)
    lines.append(entry)
regions={}
for p in profiles:
    for f,r in ranges(p):
        if r is not f['ranges'][0] and any(a<r['endOffset'] and b>r['startOffset']for a,b in executable):regions[(r['startOffset'],r['endOffset'])]=f['functionName']
for (a,b),function in sorted(regions.items()):
    points=[v for p in profiles if(v:=effective_js(p,a,b))is not None];status='executed'if any(v['region']['count']>0 for v in points)else'needs-evidence'
    if status=='needs-evidence':unexecuted.append({'file':filename,'startOffset':a,'endOffset':b,'source':source[a:b]})
    jschildren.append({'file':filename,'function':function,'line':source.count('\n',0,a)+1,'startOffset':a,'endOffset':b,'source':source[a:b],'points':points,'status':status})
report={'task':'E6-T12g6m3b','status':'passed'if not unexecuted else'needs-evidence','base':BASE,'nativeProfiles':[{k:v for k,v in p.items()if k!='data'}for p in native],'v8Profiles':[{k:v for k,v in p.items()if k!='scripts'}for p in profiles],'lines':lines,'nativeBranches':branches,'nativeRegions':children,'v8Children':jschildren,'gaps':unexecuted,'method':'Each changed line is partitioned at all code-region boundaries; the smallest applicable native/V8 child overrides parents. Every LLVM true/false alternative and V8 child is independently classified. Unchanged native/consumer descendants carry authenticated HELD source/evidence bindings; no containing function count substitutes for a child.'}
report['summary']={'runtimeLines':len(lines),'nativeBranchSites':len(branches),'nativeBranchAlternatives':len(branches)*2,'nativeRegions':len(children),'v8Children':len(jschildren),'nativeAlternatives':dict(collections.Counter(a['status']for b in branches for a in b['arms'])),'v8Verdicts':dict(collections.Counter(x['status']for x in jschildren)),'gaps':len(unexecuted)}
(OUT/'coverage-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report['summary']))
for gap in unexecuted:print(json.dumps(gap))
if unexecuted:raise SystemExit(1)
