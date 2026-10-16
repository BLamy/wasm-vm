#!/usr/bin/env python3
"""Independent source, receipt, canonical state and external-fixture audit."""
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path.cwd();E=ROOT/'evidence/virgl-scanout';OUT=E/'verifier';RUNTIME='f1aeb2538d1fda62eef7c127925ac043973f8f4a';FINAL='fbceeb4d07f1afe24e9e99a01db8b19e181cdd3e';VALIDATOR='tools/virgl-command/scanout-receipt.py';DESKTOP='tools/virgl-command/scanout-desktop.mjs';COLD='85962c4956bad75c7703767650b49763fb0e5945'
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_text())
checks=[]
def check(label,condition):
 assert condition,label
 checks.append(label)
def file_sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def bound(p,expected):check(str(p),file_sha(p)==expected)
def git_bytes(head,p):return subprocess.check_output(['git','show',head+':'+p],stderr=subprocess.DEVNULL)
check('receipt repair only',subprocess.check_output(['git','diff','--name-only',RUNTIME,FINAL],text=True).splitlines()==[VALIDATOR])
check('repair rejects non receipt source drift',"changed == [validator_path]" in (ROOT/VALIDATOR).read_text())
check('final repair changes only desktop harness and retained diagnostic',all(v==DESKTOP or v.startswith('evidence/virgl-scanout/worker/kernel-network-diagnostic/') for v in subprocess.check_output(['git','diff','--name-only',FINAL,COLD],text=True).splitlines()))
check('predictions immutable',file_sha(OUT/'predictions.md')=='274196136e3bf17fa5c8a3f9e190dc29b99ede19d39c276fd4d2f2c6afd7d982')
check('literal oracle immutable',file_sha(OUT/'pixel-oracle.mjs')=='0d459281117404313b0e3916c963217a1ca7c9cb46fc8efcc0ea7228543ac994')
partial='--held-only' in sys.argv
cold=load(E/('cold-clone/report.json' if partial else 'cold-clone-final/report.json'));clone=Path(cold['clone'])
folders=[(E/'worker',ROOT,RUNTIME)]
if not partial:folders.append((E/'cold-clone-final/acceptance',clone,COLD))
for folder,srcroot,head in folders:
 receipt=load(folder/'receipt.json');check('receipt provenance '+str(folder),receipt['gitHead']==(FINAL if head==RUNTIME else COLD) and receipt['recordingHead']==head and receipt['status']=='passed' and receipt['portableRecords']==12)
 check('executed validator frozen',receipt['validator']['path']==VALIDATOR and receipt['validator']['sha256']==sha(git_bytes(FINAL,VALIDATOR)))
 for item in receipt['records']:bound(folder/item['path'],item['sha256']);check('record length '+item['path'],(folder/item['path']).stat().st_size==item['bytes'])
 for item in receipt['sources']+receipt['inputs']:
  name=item['path']
  if name in [VALIDATOR,DESKTOP] and head==RUNTIME:b=git_bytes(head,name);check('recorded original validator retained',sha(b)==item['sha256'] and len(b)==item['bytes'])
  else:bound(srcroot/name,item['sha256']);check('source length '+name,(srcroot/name).stat().st_size==item['bytes'])
  try:b=git_bytes(head,name)
  except subprocess.CalledProcessError:continue
  check('exact tracked source '+name,sha(b)==item['sha256'])
 hardware=load(folder/'hardware/report.json');b=hardware['browserResult']['result'];check('hardware exact frozen source',hardware['gitHead']==head and not hardware['trackedChanges'] and hardware['status']==hardware['browserResult']['status']==b['status']=='passed')
 check('hardware no errors',hardware['browserErrors']=={'console':[],'page':[],'requests':[]})
 check('hardware actual headed GPU',not hardware['browser']['headless'] and hardware['browser']['gpu']['featureStatus'][hardware['browser']['webglFeature']]=='enabled' and not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)',a,re.I) for a in hardware['browser']['commandLine']))
 sourceMap={v['path']:v for v in hardware['sources']}
 for v in hardware['servedFiles']:
  if v['path'].lstrip('/') in sourceMap:check('actual served source '+v['path'],v['sha256']==sourceMap[v['path'].lstrip('/')]['sha256'])
 native=[json.loads(line.split('SCANOUT3D_PORTABLE_RECORD ',1)[1]) for line in (folder/'native-scanout.log').read_text().splitlines() if 'SCANOUT3D_PORTABLE_RECORD ' in line]
 parity=load(folder/'native-browser-parity.json');fields=parity['comparedFields'];canon=lambda x:{k:x[k] for k in fields}
 check('12 independent exact native/Wasm records',len(native)==12 and list(map(canon,native))==list(map(canon,b['portableRecords']))==parity['records'])
 for i,r in enumerate(native):
  req=bytes.fromhex(r['request']);res=bytes.fromhex(r['response']);check('literal response header '+str(i),len(res)==24 and res[16:20]==req[16:20] and res[4:8]==(int.from_bytes(req[4:8],'little')&1).to_bytes(4,'little') and res[8:16]==(req[8:16] if req[4]&1 else bytes(8)))
  for stem,prefix in [('transport',None),('submit',b'WV3DSUB2'),('scanout',b'WV3DSCN1')]:
   raw=bytes.fromhex(r[stem+'Canonical']);check(stem+' canonical digest '+str(i),sha(raw)==r[stem+'Digest'] and (prefix is None or raw[:8]==prefix))
 check('primary original draw actual canvas',b['original']['gpuDraws']==1 and b['original']['packets']==39 and b['original']['checkedPixels']==256 and b['original']['sha256']=='f079760e9fcffc2e01eed78bdc823536d545bcbcf7b6210b23eb847330d9252c')
 for scenario in ['literal','scheduling','immutable']:
  s=b[scenario]['bridge']['scanout'];p=s['presenter'];check(scenario+' terminal ownership',s['activeCaptures']==s['retainedFrames']==p['pending']==p['ownedBytes']==0 and s['queued']==sum(s[x] for x in ['drawn','superseded','cancelled','failed']))
  drawn=[v for v in s['retirements'] if v['status']=='drawn'];size=sum(v['presentation']['bytes'] for v in drawn);check(scenario+' actual draw and copy counts',len(drawn)==s['drawn'] and all(v['presentation']['drawn'] and not v['presentation']['replay'] for v in drawn) and all(p[k]==size for k in ['controllerOwnershipCopyBytes','presentationUploadBytes','backendStagingCopyBytes','imageDataCopyBytes']))
 sabotage=load(folder/'sabotage-orientation/report.json');check('worker orientation source mutation fails oracle',sabotage['status']==sabotage['browserResult']['status']=='failed' and 'scanout canvas top-left RGBA' in sabotage['browserResult']['error']['message'] and sabotage['sabotage']['servedSha256']!=sabotage['sabotage']['originalSha256'])
 d=load(folder/'desktop/report.json');check('real ordinary desktop exact source',d['gitHead']==d['gitHeadAfter']==head and d['status']=='passed' and d['proofExports']==[] and all(not v for v in d['errors'].values()))
 check('single real cold desktop',d['acceptance']==dict(runCount=1,freshContexts=1,headed=True,cacheDisabled=True,serviceWorkers='block',noSerialInput=True,warmBoots=0) and d['proof']['scheduler']['retiredInstructions']>0 and d['proof']['presentation']['drawnPresents']>0 and d['proof']['readiness']['wallpaper'] and d['proof']['readiness']['panel']['ready'] and d['proof']['readiness']['menu'])
 check('ordinary desktop proof absent',d['scope']==dict(guestExecution=True,productionVirgl=False,desktop3dAcceleration=False,unchanged2dDesktop=True) and d['servedWasmSha256']==sourceMap['web/dist/pkg/wasm_vm_wasm_bg.wasm']['sha256'])
 for key in ['image','manifest','kernel']:
  v=d[key]['before'] if key=='image' else d[key];bound(Path(v['path']),v['sha256'])
 check('image exact initial external fixture',d['image']['before']==d['image']['after'] and d['image']['before']['sha256']=='467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e' and d['image']['before']['bytes']==1073741824)
 manifest=load(Path(d['manifest']['path']));chunkCount=0
 for v in [d['harness'],*d['served']]:
  if v.get('gitPath')==DESKTOP and head==RUNTIME:check('original recorded desktop harness',sha(git_bytes(head,DESKTOP))==v['sha256'] and len(git_bytes(head,DESKTOP))==v['bytes'])
  else:bound(Path(v['path']),v['sha256']);check('desktop served size',Path(v['path']).stat().st_size==v['bytes'])
  if 'gitPath' in v:check('desktop frozen served bytes '+v['gitPath'],sha(git_bytes(head,v['gitPath']))==v['sha256'])
  if v.get('kind')=='chunk':chunkCount+=1;check('chunk content address',Path(v['path']).stem==v['sha256'] and bool(v['manifestIndices']) and all(manifest['chunks'][i]==v['sha256'] for i in v['manifestIndices']))
 check('real rootfs chunk traffic',chunkCount>0)
 for k in ['serial','screenshot','transcript']:bound(folder/'desktop'/d[k]['path'],d[k]['sha256'])
if not partial:
 check('cold exact final repaired head and empty status',cold['gitHead']==cold['cloneHead']==COLD and cold['status']=='passed' and cold['statusBefore']==cold['statusAfter']=='' and cold['exitCode']==0)
 check('retained cold checkout',subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==COLD and subprocess.check_output(['git','status','--porcelain'],cwd=clone,text=True).strip()=='')
 bound(E/'cold-clone-final/acceptance/receipt.json',cold['receiptSha256']);bound(E/'cold-clone-final/cold.log',cold['logSha256'])
 check('cold scrubbed environment',all(v in (ROOT/'tools/virgl-command/scanout-cold.py').read_text() for v in ["'RUST'","'CARGO_'",'del env[key]']))
if not partial:
 bound(E/'cold-clone-final/report.json','d99c7d98cd1dee7e34b70c38b7ff480c8718806f5787c98ec96b76bb32f0da3e')
 bound(E/'cold-clone-final/acceptance/desktop/report.json','04c04d4ac2335cbac2592542e493ab6526ecdfccdf8cfa15966a12a769b2cada')
 bound(E/'cold-clone/report.json','d5fc461b9ad597b5bc7745b3beacf7ddc31a67324a363d16e16323be7758e794')
 finald=load(E/'cold-clone-final/acceptance/desktop/report.json');kernel=next(v for v in finald['served'] if v['url']=='/releases/kernel/6.6.63/Image')
 check('final kernel immutable no-cache header',kernel['cacheControl']=='no-cache' and kernel['requests']==1)
 events=[json.loads(line) for line in (E/'cold-clone-final/acceptance/desktop/browser.jsonl').read_text().splitlines()]
 response=next(v['detail'] for v in events if v['kind']=='response' and v['detail']['url'].endswith('/releases/kernel/6.6.63/Image'))
 check('kernel response normally finished with correlated request',response['status']==200 and response['headers']['cache-control']=='no-cache' and any(v['kind']=='requestfinished' and v['detail']['requestId']==response['requestId'] for v in events))
for name in ['attacks','orientation','early-readback','stale-delivery']:
 r=load(OUT/(name+'.json'));check('independent '+name,r['status']=='passed' and r['errors']=={'console':[],'page':[],'request':[]})
 for v in r['sources']:bound(ROOT/v['path'],v['sha256'])
 if name=='attacks':check('actual independent cases',r['result']['status']=='passed' and r['result']['assertions']>=2758)
 else:check('intended independent corruption',r['result']['status']=='failed' and r['control']=='caught intended sequencing violation')
n=(OUT/'native-run.log').read_text();check('17 scoped native tests', 'test result: ok. 17 passed; 0 failed; 0 ignored' in n and not re.search(r'\bFAILED\b',n))
for name in ['worker/submit-regression/default-demo/report.json','worker/live-report.json']:
 r=load(E/name);check(name+' default demo',r['status']=='passed' and r['passed']==127 and r['failed']==0 and r['proofExportAbsent'] and r['errors']==[])
 bound((E/name).parent/r['screenshot']['path'],r['screenshot']['sha256'])
live=load(E/'worker/live-report.json');check('live exact production wasm',live['actualWasmSha256']==live['expectedWasmSha256']==file_sha(ROOT/'web/dist/pkg/wasm_vm_wasm_bg.wasm'))
def lock_packages(p):
 return [dict(re.findall(r'^(name|version|source) = "([^"\n]*)"',block,re.M)) for block in p.read_text().split('[[package]]')[1:]]
rootlock=lock_packages(ROOT/'Cargo.lock');ownlock=lock_packages(OUT/'native/Cargo.lock');original={(p['name'],p['version'],p.get('source')) for p in rootlock};check('native verifier dependency versions match frozen lock',all((p['name'],p['version'],p.get('source')) in original for p in ownlock if p['name']!='virgl-scanout-independent-verifier'))
for p in ['renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','web/src/sink/presentation.js','web/src/sink/canvas2d.js','web/src/sink/frame-scheduler.js']:
 check('unchanged verified dependency '+p,git_bytes('ab5f3a85cbf25dd151b6ae74904dd5e1fc793820',p)==git_bytes(RUNTIME,p))
result=dict(status='held-partial' if partial else 'passed',runtime=RUNTIME,receiptRepair=FINAL,finalHarness=COLD,checks=checks,checkedBindingsAndAssertions=len(checks),workerReceiptSha256=file_sha(E/'worker/receipt.json'),coldReceiptSha256=None if partial else file_sha(E/'cold-clone-final/acceptance/receipt.json'),ownAttackSha256=file_sha(OUT/'attacks.json'))
(OUT/('audit-held.json' if partial else 'audit.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='checks'},indent=2))
