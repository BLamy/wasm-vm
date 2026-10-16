import hashlib,json,subprocess
from pathlib import Path
R=Path.cwd();V=R/'evidence/virgl-components/verifier';B=R/'target/virgl-components-verifier';checks=[]
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def require(v,label):
 assert v,label
 checks.append(label)
def load(n):return json.loads((V/n).read_text())
require(h(V/'predictions.md')=='5fe2743631e39d7ae47169d728df315f41c368f82106f786ebe999e144896692','immutable predictions')
prep=load('preparation.json')
for item in prep['originalBodies']:
 for p in item['paths']:require(h(R/p)==item['sha256'],'original '+p)
build=load('native-build.json')
for item in build['sources']:
 p=R/item['path'];require(h(p)==item['sha256'],'native source '+item['path'])
 if not item['path'].startswith('evidence/virgl-components/verifier/'):
  require(hashlib.sha256(subprocess.check_output(['git','show','ae3bdf0f:'+item['path']])).hexdigest()==item['sha256'],'frozen native source '+item['path'])
for name,digest in build['binaries'].items():require(h(B/name)==digest,'native executable '+name)
require(all('-fsanitize=address,undefined' in c and '-DNDEBUG' not in c for c in build['commands']),'sanitizers and active assertions')
native=load('native.json');require(native['status']=='passed' and native['cases']==34474 and native['translations']==55897 and native['recoveries']==21423 and native['errors']=='','primary native result')
require(h(B/'cases.bin')==native['streamSha256'],'replay stream')
for row in native['records']:
 require(row['expected']==row['actual'],'native '+row['name'])
 if not row['actual']:require(row['error']['code'] in ['parse-error','unsupported-feature','input-too-large'],'bounded guard reject '+row['name'])
supp=load('supplemental-native.json');require(supp['status']=='passed' and supp['cases']==24 and supp['stderr']=='','supplemental native result')
for c in load('supplemental-cases.json'):require(c['native']['ok']==c['ok'],'supplemental '+c['name'])
for name in ['gpu.json','gpu-sabotage.json']:
 j=load(name);require(j['status']=='passed','hardware result '+name)
 require(j['errors']=={'console':[],'page':[],'request':[]},'hardware errors '+name)
 for item in j['sources']:require(h(R/item['path'])==item['sha256'],'hardware source '+item['path'])
 require(next(x['sha256'] for x in j['sources'] if x['path'].endswith('.wasm'))=='f2d4c721eaccebe8d967f8ba3d87b62228e2b7add4066971d7ab5560c8ec45eb','worker hardware Wasm identity')
 if name=='gpu.json':
  require(j['result']['status']=='passed' and j['result']['assertions']==7146 and j['result']['pixels']==6238,'hardware exact counts')
  require(all(n==0 for n in j['result']['cleanup'].values()),'native GL cleanup')
  vectors=[x for x in j['result']['records'] if x['label']=='original vertex actual clip-vector']
  require([x['actual'] for x in vectors]==[[.5,-.4375,.6875,1],[.59375,-.125,.3125,1.375]],'preselected exact vectors')
 else:require('expected [0.5,-0.4375,0.6875,1], actual [0.5,-0.4375,0.5625,1]' in j['result']['error']['message'],'z-only control intended failure')
control=load('sabotage-native.json');require(control['status']=='passed' and control['expectedBaseline'] and not control['actualMutated']['ok'] and control['stderr']=='','native consumed-lane control')
cov=load('coverage-census.json');require(h(R/cov['source'])==cov['sourceSha256'],'coverage source')
require(h(V/'native-coverage.json')==cov['nativeCoverageSha256'],'coverage export')
require(h(B/'baseline')==cov['binarySha256'],'coverage executable')
for p in cov['profiles']:require(h(R/p['path'])==p['sha256'],'coverage profile '+p['path'])
require(sum(x['count'] is not None for x in cov['added'])==24 and all(x['count'] is None or x['count']>0 for x in cov['added']),'all changed executable lines')
require(len(cov['zeroBranches'])==1 and cov['zeroBranches'][0][:4]==[230,58,230,69],'only redundant parser invariant outcome')
binding=load('binding-audit.json');require(binding['status']=='bindings-held','fresh helper audit held')
paths=subprocess.check_output(['git','diff','--name-only','ebd18189','ae3bdf0f'],text=True).splitlines();require(not any(p.startswith(('crates/','web/')) for p in paths),'unchanged Rust/default web boundary')
report={'status':'passed','frozenHead':'ae3bdf0f1d707f239b00907269f5c783fcf597e5','claimHead':'2b17963668dcd06f3378366478e6164b2ec2d6d4','checks':len(checks),'nativeCases':34498,'nativeTranslations':55921,'nativeRecoveries':21423,'browserCases':845,'browserAssertions':7146,'pixels':6238,'nativeSha256':h(V/'native.json'),'gpuSha256':h(V/'gpu.json'),'bindingAuditSha256':h(V/'binding-audit.json'),'coverageSha256':h(V/'coverage-census.json'),'checkedRecordLabelsSha256':hashlib.sha256('\n'.join(checks).encode()).hexdigest()}
(V/'final-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
