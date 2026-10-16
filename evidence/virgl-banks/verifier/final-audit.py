from pathlib import Path
import subprocess,json,hashlib,gzip,re
R=Path.cwd();V=R/'evidence/virgl-banks/verifier';HEAD='f88d7bb0c52cb4ac1189f7a05fb1dfdf77b03b91';BASE='9ed66780d4e476634cbe4b5296b302ab0579feec';sha=lambda b:hashlib.sha256(b).hexdigest();check=0
def require(x):
 global check
 assert x
 check+=1
changed=subprocess.check_output(['git','diff','--name-only',BASE,HEAD],text=True).splitlines();source=[]
for name in changed:
 raw=(R/name).read_bytes();frozen=subprocess.check_output(['git','show',f'{HEAD}:{name}']);require(raw==frozen);source.append({'path':name,'sha256':sha(raw)})
build=json.loads((V/'native-build.json').read_text());require(build['binaries']['baseline']==sha((R/'target/virgl-banks-verifier/baseline').read_bytes()))
for x in build['sources']:require(x['sha256']==sha((R/x['path']).read_bytes()))
n=json.loads((V/'native.json').read_text());raw=gzip.decompress((V/'native-output.jsonl.gz').read_bytes());require(n['status']=='passed' and not n['failures']);require(sha(raw)==n['outputSha256']);require(len(raw.splitlines())==n['calls']==14415);require(n['cases']==3603 and n['recoveries']==10809);require(not (V/'native-stderr.log').read_bytes());require(n['binarySha256']==build['binaries']['baseline'])
g=json.loads((V/'gpu.json').read_text());s=json.loads((V/'gpu-sabotage.json').read_text());require(g['status']=='passed' and g['result']['status']=='passed');require(s['status']=='passed' and s['result']['status']=='failed');require('independent high TEMP arithmetic bits' in s['result']['error']['message']);require(g['errors']==s['errors']=={'console':[],'page':[],'request':[]})
for run in [g,s]:
 for x in run['sources']:require(sha((R/x['path']).read_bytes())==x['sha256'])
 require(len(run['result']['parity'])==2174)
require(g['result']['memory']=={'initial':16777216,'final':16777216,'same':True});require(len(g['result']['feedback'])==4 and len(g['result']['draws'])==4)
for x in g['result']['feedback']:require(x['expected']==x['observed'] and len(x['observed'])==16 and x['observed'][:4]==[0x3e800000,0x3e400000,0x3f400000,0x3f400000]);require(x['observed'][-4:]==[0x3badcafe]*4)
for d in g['result']['draws']:
 require(len(d['checks'])==256)
 for x in d['checks']:require(x['expected']==x['observed']==[64,48,191,191])
require(s['result']['feedback'][0]['observed'][1]==0x3e800000);require(s['result']['feedback'][0]['expected'][1]==0x3e400000);require(s['result']['feedback'][0]['logs']=={'vertex':'','fragment':'','link':''})
coverage=json.loads((V/'coverage-census.json').read_text());require(coverage['allChangedExecutableLinesCovered'] and len(coverage['changedExecutableLines'])==25);require(coverage['coverageSha256']==sha((V/'native-coverage.json').read_bytes()))
audit=json.loads((V/'binding-audit.json').read_text());require(audit['status']=='held' and not audit['findings'] and audit['totalChecks']==33230);require(audit['scriptSha256']==sha((V/'binding-audit.py').read_bytes()))
extra=json.loads((V/'extra-native-parity.json').read_text());require(extra['status']=='passed' and extra['inputs']==6)
records=[{'path':str(p.relative_to(R)),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(V.rglob('*')) if p.is_file() and p.name not in ['final-audit.json','review.md']]
report={'schema':'wasm-vm-banks-verifier-final-audit-v1','status':'passed','frozenHead':HEAD,'checks':check,'nativeCases':3603,'nativeCalls':14415,'nativeRecoveries':10809,'wasmParityCases':2174,'hardwarePixelChecks':1024,'hardwareFloatWords':48,'hardwareGuardWords':16,'changedExecutableCLines':25,'bindingChecks':33230,'runtimeSources':source,'records':records,'findingCount':0}
(V/'final-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ['runtimeSources','records']},indent=2))
