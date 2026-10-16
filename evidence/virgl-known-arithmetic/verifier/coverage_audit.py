#!/usr/bin/env python3
"""Audit changed source regions with the worker's own native/V8 coverage."""
from pathlib import Path
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[3];O=ROOT/'target/evidence/virgl-known-arithmetic-critic';E=Path(__file__).parent;U=O/'unpacked'
def sha(b):return hashlib.sha256(b).hexdigest()
files=['renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/raw_known_arithmetic.h','renderer/virgl-shader/raw_bits.h','renderer/virgl-command/constant-domain.mjs']
diff=subprocess.check_output(['git','diff','--unified=0','bfd5c97f..cba5ae02','--',*files],cwd=ROOT,text=True)
(E/'runtime.diff').write_text(diff)
changed={};cur=None;line=0
for s in diff.splitlines():
 if s.startswith('+++ b/'):cur=s[6:];changed[cur]=[]
 elif s.startswith('@@'):
  m=re.search(r'\+(\d+)(?:,(\d+))?',s);line=int(m[1])
 elif s.startswith('+')and not s.startswith('+++'):changed[cur].append((line,s[1:]));line+=1
 elif not s.startswith('-')and not s.startswith('\\'):line+=1
cs=[];zeros=[]
for kind in ['hot','cold']:
 native=json.loads((O/(kind+'-original-coverage.json')).read_bytes())
 functions=[f for d in native['data']for f in d['functions']]
 for name,rows in changed.items():
  if not name.endswith(('.c','.h')):continue
  for ln,text in rows:
   if not text.strip():continue
   matches=[]
   for f in functions:
    for r in f['regions']:
     if r[-1]!=0 or r[:2]==r[2:4] or not f['filenames'][r[5]].endswith('/'+name.removeprefix('renderer/virgl-shader/')):continue
     if r[0]<=ln<=r[2] and not(ln==r[2]and r[3]==1):matches.append({'function':f['name'],'range':r[:4],'count':r[4]})
   cs.append({'kind':kind,'file':name,'line':ln,'source':text,'regions':matches})
  for f in functions:
   for r in f['regions']:
    if r[-1]!=0 or r[4]!=0 or r[:2]==r[2:4]or not f['filenames'][r[5]].endswith('/'+name.removeprefix('renderer/virgl-shader/')):continue
    touched=[ln for ln,text in rows if r[0]<=ln<=r[2] and text.strip()and not(ln==r[2]and r[3]==1)]
    if touched:zeros.append({'kind':kind,'file':name,'function':f['name'],'range':r[:4],'count':0,'touchedLines':touched})
js=[]
name='renderer/virgl-command/constant-domain.mjs';source=(ROOT/name).read_text();lines=source.splitlines(keepends=True);offsets=[0]
for line in lines:offsets.append(offsets[-1]+len(line))
for kind,prefix in [('hot','hot'),('cold','cold/acceptance')]:
 for recording in [f'gpu-{s}'for s in [1779033703,3144134277,1013904242]]+['fault-word','fault-shadow']:
  profile=json.loads((U/prefix/recording/'browser-coverage.json').read_bytes())
  script=next(s for s in profile['scripts']if s['coverage']['url'].endswith('/'+name))
  assert script['sha256']==sha(source.encode())
  for ln,text in changed[name]:
   if not text.strip():continue
   a,b=offsets[ln-1],offsets[ln]
   hits=[]
   for f in script['coverage']['functions']:
    for r in f['ranges']:
     if r['startOffset']<b and r['endOffset']>a:hits.append({'function':f['functionName'],**r})
   js.append({'kind':kind,'recording':recording,'file':name,'line':ln,'source':text,'ranges':hits})
result={'schema':'virgl-known-arithmetic-critic-coverage-v1','status':'auditing','basis':'LLVM code regions (kind 0), containing ranges and nested return regions; V8 original script hashes and containing block/function ranges','nativeChangedLines':cs,'zeroCodeRegionsTouchingDiff':zeros,'originalV8ChangedLines':js}
(E/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print('Native zero regions touching executable diff:')
for z in zeros:
 print(z)
print('JS nested zero source snippets (hot main):')
s=next(s for s in json.loads((U/'hot/gpu-1779033703/browser-coverage.json').read_bytes())['scripts']if s['coverage']['url'].endswith('/'+name))
seen=set()
for f in s['coverage']['functions']:
 for r in f['ranges']:
  if r['count']==0 and any(r['startOffset']<offsets[ln]and r['endOffset']>offsets[ln-1]for ln,_ in changed[name]):
   if(r['startOffset'],r['endOffset'])not in seen:print(r,source[r['startOffset']:r['endOffset']]);seen.add((r['startOffset'],r['endOffset']))
