#!/usr/bin/env python3
"""Interrogate the final pristine-clone recording and its complete digest inventory."""
import hashlib,json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent
HEAD='b4ee940d78f651553c2b900be95f8b083085cdf9'
def read(p):return json.loads(p.read_bytes())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def same(a,b):return json.dumps(a,sort_keys=True,separators=(',',':'))==json.dumps(b,sort_keys=True,separators=(',',':'))
source=pathlib.Path(sys.argv[1]).resolve();warm=ROOT/'evidence/virgl-indirect-constants/worker';report=read(source/'report.json');receipt=read(source/'acceptance/receipt.json')
assert report['status']=='passed' and type(report['exitCode']) is int and report['exitCode']==0
assert report['gitHead']==report['cloneHead']==report['cloneHeadAfter']==HEAD
assert report['statusBefore']==report['statusAfter']=='' and report['command']==['make','verify-E6-T12e8']
assert report['logSha256']==sha(source/'cold.log') and report['receiptSha256']==sha(source/'acceptance/receipt.json')
assert report['harnessSha256']==hashlib.sha256(subprocess.check_output(['git','show',HEAD+':tools/virgl-indirect-constants/cold.py'],cwd=ROOT)).hexdigest()
seen=set()
for item in report['acceptanceFiles']:
 assert item['path'] not in seen;seen.add(item['path']);p=source/item['path'];assert type(item['bytes']) is int and p.stat().st_size==item['bytes'] and sha(p)==item['sha256'],item['path']
assert seen=={str(p.relative_to(source)) for p in (source/'acceptance').rglob('*') if p.is_file()}
assert receipt['gitHead']==HEAD and receipt['status']=='passed' and receipt['task']=='E6-T12e8' and receipt['guestExecution'] is False
for item in receipt['sources']:
 if '/build/' in item['path']:continue
 raw=subprocess.check_output(['git','show',HEAD+':'+item['path']],cwd=ROOT)
 assert len(raw)==item['bytes'] and hashlib.sha256(raw).hexdigest()==item['sha256'],item['path']
wn=read(warm/'native/native-report.json');cn=read(source/'acceptance/native/native-report.json')
fields=['originals','cases','pairs','rawCases','rawPairs','integerCases','integerPairs','floatCases','floatPairs','numericCases','numericPairs','componentCases','componentPairs','dotCases','dotPairs','constantCases','constantPairs','structuredCases','structuredPairs']
for key in fields:assert same(wn[key],cn[key]),key
for key in ['stats','layout','flow','compatibility','seeds','mutationsPerSeed']:assert same(wn[key],cn[key]),key
assert same(read(warm/'wasm/report.json')['counts'],read(source/'acceptance/wasm/report.json')['counts'])
for branch in ['hardware','sabotage-decoder-bypass','sabotage-index-offset']:
 a=read(warm/branch/'report.json')['acceptance'];b=read(source/'acceptance'/branch/'report.json')['acceptance']
 assert a['status']==b['status']
 for key in ['drawCount','checkedPixels','capturedWords']:
  if key in a:assert same(a[key],b[key]),(branch,key)
 for wr,cr in zip(a['rigs'],b['rigs']):
  assert wr['name']==cr['name'] and len(wr['atlases'])==len(cr['atlases']) and len(wr['draws'])==len(cr['draws'])
  for wd,cd in zip(wr['atlases']+wr['draws'],cr['atlases']+cr['draws']):assert same(wd['rgbaBytes'],cd['rgbaBytes']),(branch,wr['name'])
result={'schema':1,'status':'passed','head':HEAD,'coldReportSha256':sha(source/'report.json'),'coldReceiptSha256':sha(source/'acceptance/receipt.json'),'acceptanceFiles':len(seen),'sources':len(receipt['sources']),'fullNativeCaseAndPairEntries':sum(len(cn[k]) for k in fields),'allNativeStatsAndOutcomesMatchWarm':True,'allGpuPixelBytesMatchWarm':True,'removedEnvironmentNames':report['removedEnvironmentNames'],'clone':report['clone']}
(OUT/'cold-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
