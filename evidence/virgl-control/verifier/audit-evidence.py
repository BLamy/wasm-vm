"""Independent immutable-source/evidence audit; no worker receipt code is imported."""
import hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path.cwd();OUT=ROOT/'evidence/virgl-control/verifier';FROZEN='252b5eaba8135967c29938e7a5a4709c4d22473d'
checks=[]
def check(test,label):
    assert test,label
    checks.append(label)
def sha(b):return hashlib.sha256(b).hexdigest()
def load(path):return json.loads(path.read_text())
def bound(base,item):
    raw=(base/item['path']).read_bytes();check(sha(raw)==item['sha256'],'digest '+str(base/item['path']))
    if 'bytes'in item:check(len(raw)==item['bytes'],'size '+item['path'])
    return raw
check(sha((OUT/'predictions.md').read_bytes())=='f0b28f69fca2185a9872733b4d27b4ea314c928736d58d8fc846b6f67b5e1aab','immutable preimplementation predictions')
worker=ROOT/'evidence/virgl-control/worker';cold=ROOT/'evidence/virgl-control/cold-clone'
check(sha((worker/'receipt.json').read_bytes())=='1ca99fe2a1b9ef5fb0d779a09749b3ad7170101b4578cef584b3528b296cc5c8','supplied worker receipt digest')
check(sha((cold/'report.json').read_bytes())=='206ca33b125f5201c7bc0eecc49e3aef57e7a2e7093e3dfb3bd0ad05245ad8f9','supplied cold report digest')
cr=load(cold/'report.json');check(cr['status']=='passed' and cr['gitHead']==cr['cloneHead']==FROZEN and cr['statusBefore']==cr['statusAfter']=='','exact clean cold clone')
check(sha((cold/'acceptance/receipt.json').read_bytes())==cr['receiptSha256']=='8a5cb66d7144520e797a36a344729b7e08ea3ada82584ebaaf347928ddc6af9c','cold receipt digest')
check(sha((cold/'cold.log').read_bytes())==cr['logSha256'],'cold log digest')
clone=Path(cr['clone']);check(subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==FROZEN,'cold checkout head independently read')
check(not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone,text=True).strip(),'cold checkout remains clean')
receipts=[]
for directory,source_root in [(worker,ROOT),(cold/'acceptance',clone)]:
    receipt=load(directory/'receipt.json');receipts.append(receipt);check(receipt['status']=='passed' and receipt['gitHead']==FROZEN,'receipt frozen head '+str(directory))
    for source in receipt['sources']:
        raw=bound(source_root,source)
        tracked=subprocess.run(['git','cat-file','-e',FROZEN+':'+source['path']],cwd=ROOT,capture_output=True).returncode==0
        if tracked:check(raw==subprocess.check_output(['git','show',FROZEN+':'+source['path']],cwd=ROOT),'frozen Git source '+source['path'])
    for item in receipt['records']:bound(directory,item)
    check(receipt['portableRecordCount']==27 and receipt['nativeRecordCount']==139,'complete native control traces')
    report=load(directory/'hardware/report.json');result=report['browserResult']['result'];check(result['summary']['assertions']==2205 and result['summary']['attacks']==129 and result['summary']['totalCommands']==165,'hardware workload complete')
    check(all(n==0 for n in result['summary']['finalLiveGL'].values()),'worker final GL leak-free')
    check(report['browserErrors']=={'console':[],'page':[],'requests':[]},'worker zero browser errors')
    check(report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']]=='enabled','worker hardware rendering')
    check(sha(json.dumps(report['browserResult'],ensure_ascii=False,separators=(',',':')).encode())==report['browserResultSha256']==receipt['browserResultSha256'],'browser result digest independently recomputed')
    for item in report['servedFiles']:
        key=item['path'].lstrip('/')
        if key and (source_root/key).is_file():check(sha((source_root/key).read_bytes())==item['sha256'],'served frozen source '+key)
    for item in load(directory/'default-demo/report.json')['served']:bound(source_root,item)
    native=[]
    for line in (directory/'native-control.log').read_text().splitlines():
        if 'CONTROL3D_PORTABLE_RECORD ' in line:native.append(json.loads(line.split('CONTROL3D_PORTABLE_RECORD ',1)[1]))
    keys=('case','request','response','usedIndex','ring','transportCanonical','transportDigest')
    select=lambda x:{k:x[k] for k in keys}
    check([select(x) for x in native]==[select(x) for x in result['portableRecords']],'independent complete native/Wasm parity')
    for n,record in enumerate(native,1):
        check(record['usedIndex']==n,'ordered used index '+str(n));check(sha(bytes.fromhex(record['transportCanonical']))==record['transportDigest'],'canonical state SHA '+str(n))
        req=bytes.fromhex(record['request']);reply=bytes.fromhex(record['response']);check(len(reply)==24 and reply[16:20]==req[16:20],'literal full response context '+str(n))
        check(int.from_bytes(reply[:4],'little') in {0x1100,0x1200,0x1201,0x1203,0x1204,0x1205},'literal response vocabulary '+str(n))
        ring=record['ring'];used=bytes.fromhex(ring['used']);check(int.from_bytes(used[2:4],'little')==n,'raw used-ring index '+str(n));offset=4+((n-1)%16)*8;check(int.from_bytes(used[offset:offset+4],'little')==0 and int.from_bytes(used[offset+4:offset+8],'little')==24,'raw descriptor completion '+str(n))
    sabotage=load(directory/'sabotage-skip-context/report.json');check(sabotage['status']=='failed' and 'actual renderer context' in sabotage['browserResult']['error']['message'],'worker omitted renderer rejected')
# Canonical source equality between independent environments. Generated debug Wasm is bound separately in each receipt.
a={s['path']:s['sha256']for s in receipts[0]['sources']};b={s['path']:s['sha256']for s in receipts[1]['sources']}
for p in a:
    if not p.startswith('target/'):check(a[p]==b[p],'worker/cold same source '+p)
live=load(worker/'live-report.json');check(live['passed']==127 and live['failed']==0 and live['errors']==[] and live['proofExportAbsent'],'live ordinary demo no proof API')
check(live['expectedWasmSha256']==live['actualWasmSha256']==sha((ROOT/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes())=='75f405e190d96382f52d12906bd32f3ffdaf6ade3262438673c7f8e6d4ac0ed8','actual deployed ordinary binary')
bound(worker,live['screenshot']);check(sha((worker/'deploy.log').read_bytes())==live['deployLogSha256'],'deployment transcript bound')
own=load(OUT/'browser-report.json');check(own['status']=='passed' and subprocess.run(['git','merge-base','--is-ancestor',FROZEN,own['gitHead']],cwd=ROOT).returncode==0,'independent browser frozen head')
for source in own['sources']:bound(ROOT,source)
baseline=own['variants'][0];check(baseline['result']['assertions']>=624 and len(baseline['result']['attacks'])==44 and len(baseline['result']['records'])==79,'independent attacks complete')
check(baseline['errors']=={'console':[],'page':[],'request':[]},'independent zero browser errors');check(sha((OUT/'browser.png').read_bytes())==baseline['screenshotSha256'],'independent screenshot');check(sha((OUT/'browser-coverage.json').read_bytes())==baseline['coverageSha256'],'independent JS coverage')
for variant in own['variants'][1:]:check(variant['result']['status']=='failed','independent sabotage rejected '+variant['variant'])
for record in baseline['result']['records']:check(sha(bytes.fromhex(record['canonical']))==record['transportDigest'],'independent transport digest '+record['label'])
native=load(OUT/'native-coverage.json')
for source in native['sources']:
    raw=bound(ROOT,source);check(raw==subprocess.check_output(['git','show',FROZEN+':'+source['path']],cwd=ROOT),'coverage same frozen runtime '+source['path'])
for item in native['binaries']+native['profiles']:bound(ROOT,item)
for p in ['native-coverage.log','native-worker-replay-coverage.log','native-gpu-coverage.log']:
    txt=(OUT/p).read_text();check('test result: ok.'in txt and 'FAILED'not in txt,'instrumented native passed '+p)
report={'schema':1,'status':'passed','frozenSourceHead':FROZEN,'reviewHead':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'checks':len(checks),'checked':checks,'evidence':[{'path':str(p.relative_to(ROOT)),'sha256':sha(p.read_bytes())}for p in [worker/'receipt.json',cold/'report.json',cold/'acceptance/receipt.json',OUT/'browser-report.json',OUT/'browser-coverage.json',OUT/'native-coverage.json',OUT/'native-coverage.log']]}
(OUT/'audit.json').write_text(json.dumps(report,indent=2)+'\n');print('Independent evidence audit passed:',len(checks),'checks')
