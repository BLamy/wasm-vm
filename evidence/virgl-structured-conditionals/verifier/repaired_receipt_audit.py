#!/usr/bin/env python3
"""Independent typed-tamper regression of detached prior recordings.

Development-only: receipt helper bindings are updated in temporary copies to
interrogate current validators. Original observations/artifacts stay untouched;
this does not relabel the original run or claim new exact-head evidence.
"""
import copy,hashlib,json,shutil,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT/'tools/virgl-structured-conditionals'))
import native_receipt as nr,wasm_receipt as wr,browser_receipt as br,consumer_compat as cr,faults,profiles_receipt as pr
BASE=ROOT/'evidence/virgl-structured-conditionals/worker';HEAD='242ad5705dbdfd07b269c3e5850857c893af41e7'
scratch=Path(tempfile.mkdtemp(prefix='e7-verifier-repaired-'))
helpers=['native_receipt.py','wasm_receipt.py','browser_receipt.py','consumer_compat.py','faults.py','profiles_receipt.py']
identities={x:hashlib.sha256((ROOT/'tools/virgl-structured-conditionals'/x).read_bytes()).hexdigest() for x in helpers}
def clone(sub,name):
 d=scratch/sub;d.mkdir(parents=True,exist_ok=True)
 for p in (BASE/sub).iterdir():
  if p.name!=name and not (d/p.name).exists():(d/p.name).symlink_to(p)
 return d,json.loads((BASE/sub/name).read_bytes())
nd,native=clone('native','native-report.json');wd,wasm=clone('wasm','report.json');cd,consumer=clone('consumer-regression/native','native-report.json')
for e in native['sources']:
 if e['path'].endswith('native_receipt.py'):e.update(nr.binding(ROOT/e['path']))
for e in wasm['sources']:
 if e['path'].endswith('wasm_receipt.py'):e.update(wr.binding(ROOT/e['path']))
results=[]
def attempt(name,fn,expected):
 try:fn();outcome='ACCEPTED';error=None
 except Exception as e:outcome='REJECTED';error=str(e)
 row={'name':name,'expected':expected,'outcome':outcome,'error':error};results.append(row);print(json.dumps(row),flush=True)
 assert outcome==expected,row

def native_attack(name,change):
 r=copy.deepcopy(native);change(r);(nd/'native-report.json').write_text(json.dumps(r))
 attempt(name,lambda:(nr.verify_recording(nd),nr.verify_coverage(r,nd,HEAD)),'ACCEPTED' if name.endswith('clean') else 'REJECTED')
def slot(r):next(c for c in r['cases'] if c['ok'] and c['result']['metadata'].get('constantDomains'))['result']['metadata']['constantDomains'][0]['slot']=False
def index(r):next(c for c in r['cases'] if c['ok'] and len(c['result']['metadata']['inputs'])>1)['result']['metadata']['inputs'][1]['index']=True
for name,change in [('native-clean',lambda r:None),('native-domain-slot-bool',slot),('native-input-index-bool',index),('native-call-counter-float',lambda r:r['stats'].__setitem__('calls',float(r['stats']['calls']))),('native-omitted-source',lambda r:r['coverage']['sources'].pop())]:native_attack(name,change)
(nd/'native-report.json').write_text(json.dumps(native));raw=(nd/'native-report.json').read_bytes();wasm['nativeReport']={'path':'../native/native-report.json','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
for name,change in [('wasm-clean',lambda r:None),('wasm-schedule-bool',lambda r:r['allocationPressure']['releaseSchedule'].__setitem__(0,False)),('wasm-bytes-float',lambda r:r['allocationPressure']['targets'][0]['capacityBefore'].__setitem__('availableRequestedBytes',float(r['allocationPressure']['targets'][0]['capacityBefore']['availableRequestedBytes'])))]:
 r=copy.deepcopy(wasm);change(r);(wd/'report.json').write_text(json.dumps(r));attempt(name,lambda:wr.verify_recording(wd,native),'ACCEPTED' if name.endswith('clean') else 'REJECTED')
cases={e['name']:e['result'] for e in native['cases']};pairs={e['name']:e['result'] for e in native['pairs']};originals={e['sha256']:e['result'] for e in native['originals']};fixture=json.loads((ROOT/br.FIXTURE).read_bytes());normal=json.loads((BASE/'hardware/report.json').read_bytes())['acceptance']
for name,change in [('browser-clean',lambda r:None),('browser-taken-int',lambda r:r['rigs'][0]['atlases'][0]['branches'][0].__setitem__('taken',0)),('browser-pixel-bool',lambda r:r['rigs'][0]['atlases'][0]['rgbaBytes'].__setitem__(2,False)),('browser-pixel-change',lambda r:r['rigs'][0]['atlases'][0]['rgbaBytes'].__setitem__(2,255)),('browser-count-float',lambda r:r.__setitem__('drawCount',39.0))]:
 r=copy.deepcopy(normal);change(r);attempt(name,lambda:br.verify_proof(r,fixture,cases,pairs,originals),'ACCEPTED' if name.endswith('clean') else 'REJECTED')
for name,change in [('consumer-clean',lambda r:None),('consumer-result-ok-int',lambda r:r['cases'][0]['result'].__setitem__('ok',int(r['cases'][0]['result']['ok'])))]:
 r=copy.deepcopy(consumer);change(r);(cd/'native-report.json').write_text(json.dumps(r));attempt(name,lambda:cr.verify_native(cd,HEAD),'ACCEPTED' if name.endswith('clean') else 'REJECTED')
clean_by_sha={c['inputSha256']:c['result'] for c in native['cases']}
for name in ['fault-clean','fault-schema-bool','fault-wasm-stability-int','fault-native-exit-bool']:
 target=scratch/name;shutil.copytree(BASE/'fault-artifacts',target);m=json.loads((target/'manifest.json').read_bytes());m['harness']=faults.binding(ROOT/'tools/virgl-structured-conditionals/faults.py');mode=m['modes']['join-union']
 if name=='fault-schema-bool':m['schema']=True
 if name=='fault-wasm-stability-int':
  p=target/mode['wasmTranslations']['path'];r=json.loads(p.read_bytes());r['memory']['bufferIdentityStable']=1;p.write_text(json.dumps(r));mode['wasmTranslations']=faults.binding(p,target)
 if name=='fault-native-exit-bool':
  p=target/mode['nativeTranslations']['path'];r=json.loads(p.read_bytes());r[0]['returnCode']=False;p.write_text(json.dumps(r));mode['nativeTranslations']=faults.binding(p,target)
  p=target/mode['wasmTranslations']['path'];r=json.loads(p.read_bytes());r['nativeTranslations']=mode['nativeTranslations'];p.write_text(json.dumps(r));mode['wasmTranslations']=faults.binding(p,target)
 (target/'manifest.json').write_text(json.dumps(m));attempt(name,lambda:faults.verify_recording(target,clean_by_sha),'ACCEPTED' if name.endswith('clean') else 'REJECTED')
attempt('profile-clean',lambda:pr.verify_recording(BASE/'profiles'),'ACCEPTED')
pd=scratch/'profile-float';shutil.copytree(BASE/'profiles',pd);r=json.loads((pd/'coverage.json').read_bytes());next(f for f in r[0]['functions'] if f['functionName']=='parseConstantDomain')['ranges'][0]['count']=50.0;(pd/'coverage.json').write_text(json.dumps(r));r=json.loads((pd/'report.json').read_bytes());r['coverage']=pr.binding(pd/'coverage.json',pd);(pd/'report.json').write_text(json.dumps(r));attempt('profile-counter-float',lambda:pr.verify_recording(pd),'REJECTED')
assert identities=={x:hashlib.sha256((ROOT/'tools/virgl-structured-conditionals'/x).read_bytes()).hexdigest() for x in helpers},'validator changed during audit'
report={'status':'passed','boundary':__doc__,'originalRuntimeHead':HEAD,'receiptHelpersSha256':identities,'results':results,'passed':len(results),'artifactDirectory':str(scratch)}
(OUT/'repaired-receipt-results.json').write_text(json.dumps(report,indent=2)+'\n');print('All independent clean and typed-corruption controls held.')
shutil.rmtree(scratch)
