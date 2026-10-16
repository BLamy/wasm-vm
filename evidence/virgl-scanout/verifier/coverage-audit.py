#!/usr/bin/env python3
"""Export exact-source native coverage and census added Rust/JS lines/ranges.
Build/profraw/object files stay under target, never in review evidence.
"""
import hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path.cwd();OUT=ROOT/'evidence/virgl-scanout/verifier';BASE='ab5f3a85cbf25dd151b6ae74904dd5e1fc793820';FROZEN='f1aeb2538d1fda62eef7c127925ac043973f8f4a'
LLVM=Path('/Users/blamy/.rustup/toolchains/1.96.0-aarch64-apple-darwin/lib/rustlib/aarch64-apple-darwin/bin')
sha=lambda b:hashlib.sha256(b).hexdigest()
def added(name):
 out=[];n=0
 for line in subprocess.check_output(['git','diff','--unified=0',BASE,FROZEN,'--',name],text=True).splitlines():
  if line.startswith('@@'):n=int(re.search(r'\+(\d+)',line)[1])
  elif line.startswith('+') and not line.startswith('+++'):out.append(n);n+=1
  elif not line.startswith('-') and not line.startswith('\\'):n+=1
 return out
paths=['crates/core/src/dev/virtio/gpu/scanout3d.rs','crates/core/src/dev/virtio/gpu/submit3d.rs','crates/core/src/dev/virtio/gpu/mod.rs','crates/core/src/lib.rs']
roots=[ROOT/'target/virgl-scanout-verifier-native']
binary_name=re.search(r'Running unittests src/lib.rs \(([^)]+)\)',(OUT/'native-run.log').read_text())[1]
binaries=[ROOT/binary_name]
profiles=list(roots[0].glob('*.profraw'))
merged=roots[0]/'merged.profdata';subprocess.run([str(LLVM/'llvm-profdata'),'merge','-sparse',*[str(x) for x in profiles],'-o',str(merged)],check=True)
j=json.loads(subprocess.check_output([str(LLVM/'llvm-cov'),'export',str(binaries[0]),'-instr-profile='+str(merged),*paths]))
j['data'][0]['functions']=[f for f in j['data'][0]['functions'] if any(str((ROOT/x).resolve()) in f['filenames'] for x in paths)]
(OUT/'native-coverage.json').write_text(json.dumps(j,separators=(',',':'))+'\n')
result={'base':BASE,'frozen':FROZEN,'nativeObjects':[{'path':str(x.relative_to(ROOT)),'sha256':sha(x.read_bytes())} for x in binaries],'profiles':[{'path':str(x.relative_to(ROOT)),'sha256':sha(x.read_bytes())} for x in profiles],'native':[],'javascript':[]}
for f in j['data'][0]['files']:
 p=Path(f['filename']);name=str(p.relative_to(ROOT));lines=p.read_text().splitlines();counts={}
 for a,b in zip(f['segments'],f['segments'][1:]):
  if a[3] and not a[5]:
   for n in range(a[0],b[0]+(b[1]>1)):counts[n]=max(counts.get(n,0),a[2])
 diff=added(name);zero=sorted(n for n in diff if counts.get(n)==0)
 regions=[]; merged_regions={}
 for fun in j['data'][0]['functions']:
  for r in fun['regions']:
   if fun['filenames'][r[5]]!=str(p) or r[7]!=0:continue
   key=tuple(r[:4]);merged_regions[key]=max(merged_regions.get(key,0),r[4])
 for key,count in merged_regions.items():
  if count==0 and any(key[0]<=n<=key[2] for n in diff):regions.append({'start':key[:2],'end':key[2:4]})
 result['native'].append({'path':name,'sha256':sha(p.read_bytes()),'added':len(diff),'positiveLineCounts':sum(counts.get(n,0)>0 for n in diff),'zeroLines':[{'line':n,'text':lines[n-1]} for n in zero],'unmapped':[n for n in diff if n not in counts],'zeroRegions':regions})
for name in ['renderer/virgl-command/control-bridge.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/scanout.mjs','web/dist/src/sink/virgl-scanout-presenter.js']:
 txt=(ROOT/name).read_text();diff=added(name);runs=[]
 for p in [OUT/'attack-coverage.json',OUT.parent/'worker/hardware/browser-coverage.json',OUT.parent/'worker/submit-regression/hardware/browser-coverage.json',OUT.parent/'worker/submit-regression/control-regression/browser-coverage.json']:
  data=json.loads(p.read_text());sc=next((x.get('coverage',x) for x in data['scripts'] if x.get('source','')==name or x.get('url','').endswith('/'+name)),None)
  if sc:runs.append([r for f in sc['functions'] for r in f['ranges']])
 def count(pos,rs):
  match=[r for r in rs if r['startOffset']<=pos<r['endOffset']];return min(match,key=lambda r:r['endOffset']-r['startOffset'])['count'] if match else 0
 zeros=[]
 for r in runs[1]:
  a,b=r['startOffset'],r['endOffset'];start=1+txt[:a].count('\n');end=1+txt[:b].count('\n')
  if r['count']==0 and any(start<=n<=end for n in diff) and any(not txt[x].isspace() and not any(count(x,rs)>0 for rs in runs) for x in range(a,b)):
   zeros.append({'startLine':start,'endLine':end,'startOffset':a,'endOffset':b,'text':txt[a:b]})
 result['javascript'].append({'path':name,'sha256':sha(txt.encode()),'added':len(diff),'uncoveredChangedRanges':zeros})
(OUT/'coverage-census.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:[{x:y for x,y in v.items() if x in ['path','added','positiveLineCounts','zeroLines','uncoveredChangedRanges']} for v in result[k]] for k in ['native','javascript']},indent=2))
