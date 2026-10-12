#!/usr/bin/env python3
"""Fresh reconstruction of every smallest governing V8 partition in the diff."""
import hashlib,json,re,subprocess
from pathlib import Path
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2];BASE='4e924b694715ec40e653e2e0c87ecc49c929d040'
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT)
names=['renderer/virgl-command/'+n+'.mjs' for n in ['state','decoder','constant-domain']]
added={};name=None;line=0
for row in git('diff','--unified=0',BASE,'HEAD','--',*names).decode().splitlines():
 if row.startswith('+++ b/'):name=row[6:]
 elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
 elif row.startswith('+'):added.setdefault(name,[]).append(line);line+=1
 elif row.startswith(' '):line+=1
waivers={(w['source'],w['startOffset'],w['endOffset']):w for w in json.loads((ROOT/'tools/virgl-shadow-samplers/coverage-waivers.json').read_text())['waivers']}
held=json.loads((OUT/'unpacked/verifier/fresh/authentication.json').read_text());held_sources={r['path']:r['sha256'] for r in held['sourceClosure']}
assert held['status']=='passed' and held['unchangedCommandStorageRustWebGuest']
dependency=next(r for r in held['carried'] if r['family']=='virgl-instanced-stencil' and r['role']=='worker')
dep_folder=ROOT/'evidence/virgl-instanced-stencil/worker';mr,ir=(dep_folder/'manifest.json').read_bytes(),(dep_folder/'records.json').read_bytes()
assert sha(mr)==dependency['manifestSha256'] and sha(ir)==dependency['indexSha256']
for leaf,raw in [('manifest.json',mr),('records.json',ir)]:assert raw==git('show',BASE+':'+(dep_folder/leaf).relative_to(ROOT).as_posix())
dep_rows={r['path']:r for r in json.loads(ir)['records']}
for n in names:
 row=dep_rows['hot/hardware-bindings/source/'+n];assert row['sha256']==sha(git('show',BASE+':'+n));held_sources[n]=row['sha256']
def audit(side):
 directory=OUT/'unpacked/current'/side;scripts=[]
 for file in sorted(directory.glob('hardware-*/browser-coverage.json')):
  for s in json.loads(file.read_text())['scripts']:
   if s['source'] in added:scripts.append(dict(record=file.relative_to(OUT/'unpacked/current').as_posix(),recordSha256=sha(file.read_bytes()),**s))
 for file in sorted((directory/'node-coverage').glob('coverage-*.json')):
  for s in json.loads(file.read_text())['result']:
   for n in names:
    if s['url'].endswith('/'+n) and '/predecessor/historical/' not in s['url']:scripts.append(dict(source=n,sha256=sha((ROOT/n).read_bytes()),coverage=s,record=file.relative_to(OUT/'unpacked/current').as_posix(),recordSha256=sha(file.read_bytes())))
 for s in scripts:assert s['sha256']==sha((ROOT/s['source']).read_bytes())
 partitions=[];zero=[];positive=0
 for n,lines in added.items():
  text=(ROOT/n).read_text();u16=text.encode('utf-16-le');offsets=[0]
  for row in text.splitlines(keepends=True):offsets.append(offsets[-1]+len(row.encode('utf-16-le'))//2)
  recordings=[s for s in scripts if s['source']==n]
  allranges=[(s,r) for s in recordings for f in s['coverage']['functions'] for r in f['ranges']]
  for l in lines:
   a,b=offsets[l-1:l+1];cuts=sorted({a,b}|{v for _,r in allranges for v in [r['startOffset'],r['endOffset']] if a<v<b})
   for left,right in zip(cuts,cuts[1:]):
    governing=[]
    for s in recordings:
     candidates=[r for f in s['coverage']['functions'] for r in f['ranges'] if r['startOffset']<=left and right<=r['endOffset']]
     if candidates:
      minimum=min(r['endOffset']-r['startOffset'] for r in candidates);finest=[r for r in candidates if r['endOffset']-r['startOffset']==minimum];assert len({r['count'] for r in finest})==1
      governing.append(dict(record=s['record'],recordSha256=s['recordSha256'],**finest[0]))
    p=dict(source=n,line=l,startOffset=left,endOffset=right,text=u16[2*left:2*right].decode('utf-16-le'),count=max((r['count'] for r in governing),default=0),governing=governing)
    if p['count']>0:positive+=1;p['classification']='executed'
    else:
     w=waivers.get((n,left,right));assert w and p['text']==w['text'] and sha(p['text'].encode())==w['sha256'],(side,n,l,left,right,p['text'])
     old=git('show',BASE+':'+n);assert w['classification']=='unchanged-operand' and sha(old)==w['predecessorSourceSha256']==held_sources[n]
     assert old.decode().encode('utf-16-le')[2*w['predecessorStartOffset']:2*w['predecessorEndOffset']].decode('utf-16-le')==p['text']
     assert w['predecessor']==BASE and sha((ROOT/w['predecessorEvidence']).read_bytes())==w['predecessorEvidenceSha256']
     assert not re.search(r'shadowSamplers|sampler2DShadow|shadmask|shadadd|wv_shadow_ref',p['text'])
     p['classification']='unchanged historical operand';p['heldEvidence']=dict(manifest=w['predecessorEvidenceSha256'],verifierManifest='9079ba5b7457d02cdf180075f049e26c542484db1c794a56c7bba676461fb7c6',authenticationSha256=sha((OUT/'unpacked/verifier/fresh/authentication.json').read_bytes()),consumerManifestSha256=dependency['manifestSha256'],consumerIndexSha256=dependency['indexSha256'],consumerSourceRecord='hot/hardware-bindings/source/'+n,sourceSha256=sha(old),oldStart=w['predecessorStartOffset'],oldEnd=w['predecessorEndOffset']);zero.append(p)
    partitions.append(p)
 original=json.loads((directory/'coverage-audit.json').read_text())
 assert positive==original['positive']==493 and len(zero)==len(original['waived'])==25 and not original['zero']
 assert {(p['source'],p['startOffset'],p['endOffset'],p['count']) for p in partitions}=={(p['source'],p['startOffset'],p['endOffset'],p['maxCount']) for p in original['partitions']}
 return dict(side=side,positive=positive,unchangedWaivers=len(zero),unclassified=0,partitions=partitions)
results=[audit(s) for s in ['hot','cold']]
(OUT/'finest-coverage-audit.json').write_text(json.dumps(dict(status='passed',prediction='P11',records=results),indent=2)+'\n')
print(json.dumps(dict(status='passed',counts=[{k:v for k,v in r.items() if k!='partitions'} for r in results])))
