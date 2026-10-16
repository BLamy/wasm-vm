import json,re,subprocess,hashlib
from pathlib import Path
R=Path.cwd();V=R/'evidence/virgl-components/verifier';B=R/'target/virgl-components-verifier';h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source=R/'renderer/virgl-shader/bridge.c';sha=h(source)
assert hashlib.sha256(subprocess.check_output(['git','show','ae3bdf0f:renderer/virgl-shader/bridge.c'])).hexdigest()==sha
profiles=sorted(B.glob('native-*.profraw'))
subprocess.run(['xcrun','llvm-profdata','merge','-sparse',*[str(p) for p in profiles],'-o',str(B/'baseline.profdata')],check=True)
raw=subprocess.check_output(['xcrun','llvm-cov','export',str(B/'baseline'),'-instr-profile='+str(B/'baseline.profdata'),str(source)])
(V/'native-coverage.json').write_bytes(raw);j=json.loads(raw);f=j['data'][0]['files'][0];assert Path(f['filename'])==source
added=[];line=0
for x in subprocess.check_output(['git','diff','--unified=0','ebd18189','ae3bdf0f','--','renderer/virgl-shader/bridge.c'],text=True).splitlines():
 if x.startswith('@@'):line=int(re.search(r'\+(\d+)',x)[1])
 elif x.startswith('+') and not x.startswith('+++'):added.append(line);line+=1
 elif not x.startswith('-') and not x.startswith('\\'):line+=1
counts={}
for a,b in zip(f['segments'],f['segments'][1:]):
 if a[3] and not a[5]:
  for n in range(a[0],b[0]+int(b[1]>1)):counts[n]=max(counts.get(n,0),a[2])
branches=[b for b in f['branches'] if any(b[0]<=n<=b[2] for n in added)]
text=source.read_text().splitlines()
r={'base':'ebd18189','frozen':'ae3bdf0f1d707f239b00907269f5c783fcf597e5','source':str(source.relative_to(R)),'sourceSha256':sha,'binarySha256':h(B/'baseline'),'profiles':[{'path':str(p.relative_to(R)),'sha256':h(p)} for p in profiles],'nativeCoverageSha256':h(V/'native-coverage.json'),'added':[{'line':n,'count':counts.get(n),'source':text[n-1]} for n in added],'changedBranches':branches,'zeroBranches':[b for b in branches if b[4]==0 or b[5]==0]}
assert not [x for x in r['added'] if x['count']==0]
(V/'coverage-census.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({'addedLines':len(added),'executed':sum(counts.get(n,0)>0 for n in added),'nonExecutable':sum(counts.get(n) is None for n in added),'zeroBranches':r['zeroBranches']},indent=2))
