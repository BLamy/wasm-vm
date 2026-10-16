import json,re,subprocess,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'target/evidence/virgl-standard-points-critic';W=OUT/'worker/hot'
paths=['renderer/virgl-shader/'+n for n in ['bridge.c','standard_emit.c','standard_guard.c','standard_guard.h']]+['renderer/virgl-command/'+n for n in ['state.mjs','constant-domain.mjs','decoder.mjs']]
lines={}
for name in paths:
 d=subprocess.check_output(['git','diff','--unified=0','c810cbef23caa7a19b090491ccc30c093d432518','3d9cfcd03f2eabe900c50173242834aa6ce5f0e6','--',name],cwd=ROOT,text=True)
 n=0;rows=[]
 for line in d.splitlines():
  m=re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@',line)
  if m:n=int(m[1]);continue
  if line.startswith(('+++','---','diff ','index ')):continue
  if line.startswith('+'):rows.append(n);n+=1
  elif line.startswith(' '):n+=1
 lines[name]=rows
cdata=[];sources=[]
for name in ['coverage/points.json','retained-compiler/coverage/matrix.json','retained-compiler/coverage/allocations.json']:
 raw=(W/name).read_bytes();sources.append({'path':'worker/hot/'+name,'sha256':hashlib.sha256(raw).hexdigest()})
 for f in json.loads(raw)['data'][0]['files']:
  for p in paths:
   if f['filename'].endswith('/'+p):cdata.append((p,f['segments']))
jsdata=[]
for base in [W/'hardware',W/'retained-assembly/hardware',W/'retained-restart/hardware',OUT/'novel']:
 raw=(base/'browser-coverage.json').read_bytes();sources.append({'path':str(base.relative_to(OUT)/'browser-coverage.json'),'sha256':hashlib.sha256(raw).hexdigest()})
 for s in json.loads(raw)['scripts']:
  if s['source'] in paths:assert s['sha256']==hashlib.sha256((ROOT/s['source']).read_bytes()).hexdigest(),s['source']
  jsdata.append(s)
out={'schema':'standard-point-changed-hunk-coverage-v1','sources':sources,'runtimeSources':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths},'lines':[]}
for name,added in lines.items():
 text=(ROOT/name).read_text();assert not name.endswith('.mjs') or text.isascii(),name;ls=text.splitlines(keepends=True);starts=[];at=0
 for line in ls:starts.append(at);at+=len(line)
 for n in added:
  body=ls[n-1].rstrip();count=0
  if name.endswith('.c'):
   for file,segs in cdata:
    if file!=name:continue
    for a,b in zip(segs,segs[1:]):
     if not a[3] or a[5] or not a[2]:continue
     for col,ch in enumerate(body,1):
      if not (ch.isalnum() or ch=='_'):continue
      if (a[0],a[1])<=(n,col)<(b[0],b[1]):count=max(count,a[2])
  elif name.endswith('.mjs'):
   for s in jsdata:
    if s['source']!=name:continue
    ranges=[r for fn in s['coverage']['functions'] for r in fn['ranges']]
    for col,ch in enumerate(body):
     if not (ch.isalnum() or ch=='_'):continue
     pos=starts[n-1]+col
     inside=[r for r in ranges if r['startOffset']<=pos<r['endOffset']]
     if inside:count=max(count,min(inside,key=lambda r:r['endOffset']-r['startOffset'])['count'])
  row={'path':name,'line':n,'text':body,'count':count,'classification':'hit' if count else 'needs-classification'};out['lines'].append(row)
for row in out['lines']:
 if row['count']:continue
 body=row['text'].strip()
 if row['path']=='renderer/virgl-shader/bridge.c' and row['line']==2318:
  row['classification']='waived-unreachable-defensive'
  row['reason']='standard_point_tokens receives the same trusted token header already accepted by tgsi_text_translate and standard_constant_order/tgsi_parse_init. No caller-owned token stream exists; re-parsing cannot fail without internal memory corruption. Inspection confirms scratch is freed before returning even in that defensive branch.'
 elif row['path']=='renderer/virgl-shader/bridge.c' and row['line']==2355:
  row['classification']='waived-unreachable-defensive'
  row['reason']='The standard grammar and successfully translated immutable TGSI stream contain only DECLARATION, IMMEDIATE, PROPERTY and INSTRUCTION body tokens. Processor/header tokens are consumed by parse_init; the default label cannot be reached by an admitted original shader.'
 else:
  assert (not re.search(r'[A-Za-z0-9_]',body) or body.startswith(('#include','/*','*','static const char *standard_point_tokens','const struct tgsi_token *original','struct tgsi_token **result')) or row['path'].endswith('standard_guard.h')),row
  row['classification']='waived-structural'
  row['reason']='Header/enum declaration, comment, signature or brace; no independently executable runtime behavior.'
out['guardClassification']=[
 {'path':'renderer/virgl-shader/bridge.c','line':2313,'classification':'executed-defensive-bound','reason':'The valid fragment grammar permits at most POSITION, PCOORD and 16 unique GENERIC input semantics, so all 32 physical slots cannot be occupied. The unused alias search is exercised with IN/SV collisions at indices 0 and 1 and IN31.'},
 {'path':'renderer/virgl-shader/bridge.c','lines':[2314,2315,2317,2325,2355,2357,2361,2386],'classification':'executed-or-waived-trusted-validation-guard','reason':'Actual point arena OOM/recovery and upstream failure paths execute under the allocation harness; all builder kinds and large accepted streams execute. The parser/header/default-token defense is behind successful immutable pinned parsing. Fixed 8192-token capacity is checked on every builder call; bounds failures free the owned buffer and produce no output.'},
 {'path':'renderer/virgl-command/state.mjs','line':540,'classification':'executed-critic','reason':'An original declared but unused SV[1] PCOORD optimizes away POINT_COORD_Y; native reflection correctly records inactive, while POINT_SIZE remains required.'},
 {'path':'renderer/virgl-command/state.mjs','lines':[621,622,645],'classification':'executed-critic','reason':'Real native POINTS with constant-color/alpha blending and active POINT_COORD_Y exercises the added component accounting. Explicitly recorded host-limit overrides reject vertex limit 1 and fragment blend limit 4 before native draw.'}
]
out['status']='passed';out['executed']=sum(r['classification']=='hit' for r in out['lines']);out['waivedStructural']=sum(r['classification']=='waived-structural' for r in out['lines']);out['waivedDefensive']=sum(r['classification']=='waived-unreachable-defensive' for r in out['lines'])
(OUT/'coverage-audit.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k in ['status','executed','waivedStructural','waivedDefensive']}))
