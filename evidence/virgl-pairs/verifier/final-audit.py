import hashlib,json,subprocess
from pathlib import Path
R=Path.cwd();V=R/'evidence/virgl-pairs/verifier';FROZEN='8b7106488b84c256cae7f4eae87eee16a4f09eee';checks=0
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def check(x,label):
 global checks
 checks+=1
 if not x:raise AssertionError(label)
def read(name):return json.loads((V/name).read_text())
check(sha(V/'predictions.md')=='4d2edf5971eafebbf73dfe527077673907252a1ffea56af40b51888107150ba1','immutable predictions')
for p,expected in [('evidence/virgl-pairs/worker/receipt.json','d25f140bc69845e49660eb362b7f9edfd52f63e2f606241b76f2ea93b3de891a'),('evidence/virgl-pairs/cold-clone/report.json','334bea0d3044c94950be086c47d758986ff27c1e1063e5f68f32011fa889ebd3'),('evidence/virgl-pairs/cold-clone/acceptance/receipt.json','6bf2d0baa115bf3f312348cd2ed1f72a81bbc6222a5cb56c60314b8396ba4b9d')]:check(sha(R/p)==expected,p)
source=[]
for p in subprocess.check_output(['git','diff','--name-only','cffb8d57',FROZEN],text=True).splitlines():
 expected=hashlib.sha256(subprocess.check_output(['git','show',FROZEN+':'+p])).hexdigest();check(sha(R/p)==expected,'frozen '+p);source.append({'path':p,'sha256':expected})
for x in read('native-build.json')['sources']:check(sha(R/x['path'])==x['sha256'],'native source '+x['path'])
n=read('native.json');check(n['status']=='passed'and n['cases']==2729 and n['translations']==8187 and n['mutations']==1024 and n['stderr']=='','native results');check(all(x['actual']==x['expected']for x in n['records']if x['expected']is not None),'native independent predictions')
originals=[x for x in n['records']if x['name'].startswith('original-') and x['mode']<2];check(len(originals)==19 and sum(x['actual']for x in originals)==12,'exact originals')
g=read('gpu.json');s=read('gpu-sabotage.json');check(g['status']=='passed'and g['result']['status']=='passed','hardware passed');check(g['result']['assertions']==944 and g['result']['pixels']==84,'hardware counts');check(len([e for e in g['result']['events']if e['call']=='drawElements'])==27,'27 renderer draws');check(all(x==0 for x in g['result']['cleanup']['budgets'].values())and g['result']['cleanup']['live']==0,'zero ownership');check(g['result']['cleanup']['nativeObjects']==98,'native lifecycle')
for report in [g,s]:
 check(report['errors']=={'console':[],'page':[],'request':[]},'zero browser errors')
 for p in report['sources']:check(sha(R/p['path'])==p['sha256'],'served verifier source '+p['path'])
check(s['status']=='passed'and s['result']['status']=='failed','sabotage expected failure');check('first flat 3,3: expected [0,0,255,255], actual [128,64,64,255]'in s['result']['error']['message'],'exact sabotage oracle')
last=[r for r in s['result']['records']if r.get('name')=='first flat'and 'program'in r][0];check(last['program']!=last['requested'],'sabotage actual wrong program')
check(read('native-sabotage.json')['status']=='passed','native omission control');check(read('defensive.json')['trustedDefensiveChecks']==19,'trusted defensive supplement')
check(read('binding-audit.json')['status']=='bindings-held','binding helper')
c=read('js-coverage-census.json');check(all(not f['unhitChangedRanges']for f in c['files'].values()),'no changed JS holes')
for p in c['inputs']:check(sha(R/p['path'])==p['sha256'],'coverage binding')
r=read('coverage-census.json');check(r['sourceSha256']==sha(R/r['source']),'native coverage source');check(r['nativeCoverageSha256']==sha(V/'native-coverage.json'),'native coverage export');check(len(r['zeroBranches'])==7,'explicit native waiver census')
for i in range(1,23):check('| P%02d '%i in (V/'review.md').read_text(),'prediction disposition '+str(i))
files=[{'path':str(p.relative_to(R)),'size':p.stat().st_size,'sha256':sha(p)}for p in sorted(V.iterdir())if p.is_file()and p.name not in ['final-audit.json','manifest.json']]
report={'status':'passed','checks':checks,'frozenSource':FROZEN,'workerClaim':'09e923695edd77d2b0500e3e81ce7cabfcc60835','sources':source,'verifierFiles':files,'nativeCases':n['cases'],'nativeCalls':n['translations'],'hardwareAssertions':g['result']['assertions'],'hardwarePixels':g['result']['pixels'],'nativeDefensiveChecks':19,'remainingNativeBranchWaivers':7,'unhitChangedJsRanges':0}
(V/'final-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k not in ['sources','verifierFiles']},indent=2))
