#!/usr/bin/env python3
"""Independent evidence-binding and literal parity audit. No product mutation."""
import hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path.cwd();E=ROOT/'evidence/virgl-submit';OUT=E/'verifier';FROZEN='f0f125fd0578a22ce08c4bc255ca63708c6e6566'
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_text())
checks=[]
def check(label,condition):
 assert condition,label
 checks.append(label)
def bound(p,expected):
 b=p.read_bytes();check(str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p),sha(b)==expected);return b
cold=load(E/'cold-clone/report.json');clone=Path(cold['clone'])
for folder,srcroot,expected in [(E/'worker',ROOT,'f3fa6b8ec0f642c93366b582d625d8987d2f40bebcd58a7130eb1a99fc770942'),(E/'cold-clone/acceptance',clone,'c641fd81027a37278835b0866f671ac40b7808d5e14fe848b1501cf52c617478')]:
 r=load(folder/'receipt.json');bound(folder/'receipt.json',expected);check('exact frozen receipt '+str(folder),r['gitHead']==FROZEN and r['status']=='passed' and r['portableRecords']==8)
 for kind,base in [('sources',srcroot),('inputs',srcroot),('records',folder)]:
  for item in r[kind]:
   b=bound(base/item['path'],item['sha256']);check('byte size '+item['path'],len(b)==item['bytes'])
 for source in r['sources']:
  try:b=subprocess.check_output(['git','show',FROZEN+':'+source['path']],stderr=subprocess.DEVNULL)
  except subprocess.CalledProcessError:continue # generated proof bindings checked above against retained build
  check('frozen tracked source '+source['path'],sha(b)==source['sha256'])
check('cold exact head and empty before/after',cold['gitHead']==cold['cloneHead']==FROZEN and cold['status']=='passed' and cold['statusBefore']==cold['statusAfter']=='' and cold['exitCode']==0)
check('retained clone still exact/clean',subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==FROZEN and subprocess.check_output(['git','status','--porcelain'],cwd=clone,text=True).strip()=='')
bound(E/'cold-clone/acceptance/receipt.json',cold['receiptSha256']);bound(E/'cold-clone/cold.log',cold['logSha256'])
check('cold launcher scrubs overrides',all(s in (ROOT/'tools/virgl-command/submit-cold.py').read_text() for s in ["'RUST'","'CARGO_'",'del env[key]']))
h=load(E/'worker/hardware/report.json');b=h['browserResult']['result'];check('hardware claim',h['status']=='passed' and h['gitHead']==FROZEN and not h['trackedChanges'] and h['browserResult']['status']=='passed' and b['assertions']==280536)
check('actual headed GPU',h['browser']['headless'] is False and h['browser']['gpu']['featureStatus'][h['browser']['webglFeature']]=='enabled')
check('no hardware application errors',h['browserErrors']=={'console':[],'page':[],'requests':[]})
for field in ['browserCoverage','screenshot']:bound(E/'worker/hardware'/h[field]['path'],h[field]['sha256'])
for item in h['servedFiles']:
 # The served path is an URL; source list establishes original bytes.
 name=item['path'].lstrip('/');match=next((x for x in h['sources'] if x['path']==name),None)
 if match:check('served source '+name,item['sha256']==match['sha256'])
parity=load(E/'worker/native-browser-parity.json');records=[]
for line in (E/'worker/native-submit.log').read_text().splitlines():
 if 'SUBMIT3D_PORTABLE_RECORD ' in line:records.append(json.loads(line.split('SUBMIT3D_PORTABLE_RECORD ',1)[1]))
check('eight actual native records',len(records)==8)
fields=parity['comparedFields'];canon=lambda r:{k:r[k] for k in fields}
check('native versus Wasm exact fields',list(map(canon,records))==list(map(canon,b['portableRecords']))==parity['records'])
for i,r in enumerate(records):
 request=bytes.fromhex(r['request']);response=bytes.fromhex(r['response']);check(f'literal header {i}',len(response)==24 and response[16:20]==request[16:20] and response[4:8]==(int.from_bytes(request[4:8],'little')&1).to_bytes(4,'little') and response[8:16]==(request[8:16] if request[4]&1 else bytes(8)))
 for stem in ['transport','submit']:check(f'{stem} digest {i}',sha(bytes.fromhex(r[stem+'Canonical']))==r[stem+'Digest'])
check('raw primary capture',b['original']['packetCount']==210 and b['original']['gpuDraws']==3 and b['original']['checkedPixels']==768 and len(b['original']['submissions'])==8)
check('reference output poison does not seed pixels',[f['sha256'] for f in b['original']['frames']]==b['outputReferencePoison']['hashes'])
check('100 draw queue then destruction',b['ordered']['gpuDraws']==100 and b['ordered']['maximumPending']==1 and b['ordered']['queuedCommands']==101 and b['ordered']['heartbeats']>0)
for kind in ['early-collect','early-completion']:
 r=load(E/f'worker/sabotage-{kind}/report.json');check('worker control '+kind,r['status']=='failed' and r['browserResult']['status']=='failed' and r['sabotage']['mode']==kind)
for name in ['worker/default-demo/report.json','worker/live-report.json']:
 r=load(E/name);check(name+' passing truthful default',r['status']=='passed' and r['gitHead']==FROZEN and r['passed']==127 and r['failed']==0 and r['proofExportAbsent'] and r['errors']==[])
 bound((E/name).parent/r['screenshot']['path'],r['screenshot']['sha256'])
wasm=sha((ROOT/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes());live=load(E/'worker/live-report.json');check('live fetched exact ordinary wasm',wasm==live['actualWasmSha256']==live['expectedWasmSha256']=='0b926d93b2ef3de3092dc54184e7f6becd9509d0eaf63c8aa7b363a399b58eb8');bound(E/'worker/deploy.log',live['deployLogSha256'])
check('only explicitly allowed favicon404',not live['httpErrors'] and all(x['location']['url'].endswith('/favicon.ico') and '404' in x['text'] for x in live['faviconErrors']))
check('predictions immutable',sha((OUT/'predictions.md').read_bytes())=='93a6ca5849a6cf6b63c61110c0f21a58dcd6e959047731036038b73f337efba8')
check('resources carry unchanged B1',sha((ROOT/'renderer/virgl-command/resources.mjs').read_bytes())=='7c7a1d62b7649e058d3b406ea42289286f487b55f7f55623f850ee030453b1e2')
def lock_packages(p):
 return [dict(re.findall(r'^(name|version|source) = "([^"\n]*)"',block,re.M)) for block in p.read_text().split('[[package]]')[1:]]
rootlock=lock_packages(ROOT/'Cargo.lock');ownlock=lock_packages(OUT/'native/Cargo.lock');original={(p['name'],p['version'],p.get('source')) for p in rootlock};check('native verifier dependency versions match frozen lock',all((p['name'],p['version'],p.get('source')) in original for p in ownlock if p['name']!='virgl-submit-independent-verifier'))
for variant in ['attacks','early-readback','wrong-completion']:
 r=load(OUT/(variant+'.json'));check('own '+variant,r['status']=='passed');
 for source in r['sources']:bound(ROOT/source['path'],source['sha256'])
 if variant=='attacks':check('own result',r['result']['status']=='passed' and r['result']['assertions']>=2707)
 else:check('own intended failure '+variant,r['result']['status']=='failed' and r['control']=='caught intended sequencing violation')
for name in ['native-test.log','mmio-test.log']:
 s=(OUT/name).read_text();check(name+' no failure/ignore','test result: ok.' in s and not re.search(r'\bFAILED\b|test result: FAILED|[1-9]\d* ignored',s))
result={'status':'passed','frozen':FROZEN,'checkedBindingsAndAssertions':len(checks),'checks':checks,'workerReceiptSha256':sha((E/'worker/receipt.json').read_bytes()),'coldReceiptSha256':sha((E/'cold-clone/acceptance/receipt.json').read_bytes()),'liveReportSha256':sha((E/'worker/live-report.json').read_bytes()),'ownAttackSha256':sha((OUT/'attacks.json').read_bytes()),'initialPredictionsSha256':sha((OUT/'predictions.md').read_bytes())}
(OUT/'audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='checks'},indent=2))
