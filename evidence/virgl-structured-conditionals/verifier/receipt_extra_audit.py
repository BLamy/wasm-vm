#!/usr/bin/env python3
import copy,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'tools/virgl-structured-conditionals'))
import browser_receipt,wasm_receipt,consumer_compat
HEAD='242ad5705dbdfd07b269c3e5850857c893af41e7';BASE=ROOT/'evidence/virgl-structured-conditionals/worker'
native=json.loads((BASE/'native/native-report.json').read_bytes());results=[]
def attempt(name,fn,mutation):
 try:fn();outcome='ACCEPTED';error=None
 except Exception as e:outcome='REJECTED';error=str(e)
 row={'attack':name,'outcome':outcome,'mutation':mutation,'error':error};results.append(row);print(json.dumps(row),flush=True)
fixture=json.loads((ROOT/browser_receipt.FIXTURE).read_bytes());cases={e['name']:e['result'] for e in native['cases']};pairs={e['name']:e['result'] for e in native['pairs']};originals={e['sha256']:e['result'] for e in native['originals']}
normal=json.loads((BASE/'hardware/report.json').read_bytes())['acceptance']
attempt('browser-clean',lambda:browser_receipt.verify_proof(normal,fixture,cases,pairs,originals),{})
for label,change in [('taken-int',lambda v:int(v)),('taken-inverted',lambda v:not v)]:
 proof=copy.deepcopy(normal);branch=proof['rigs'][0]['atlases'][0]['branches'][0];before=branch['taken'];branch['taken']=change(before)
 attempt('browser-'+label,lambda:browser_receipt.verify_proof(proof,fixture,cases,pairs,originals),{'field':'rigs[0].atlases[0].branches[0].taken','before':before,'after':branch['taken']})
proof=copy.deepcopy(normal);pixels=proof['rigs'][0]['atlases'][0]['rgbaBytes'];offset=pixels.index(0);pixels[offset]=False
attempt('browser-pixel-bool',lambda:browser_receipt.verify_proof(proof,fixture,cases,pairs,originals),{'field':f'rigs[0].atlases[0].rgbaBytes[{offset}]','before':0,'after':False})
for label,change in [('clean',lambda r:None),('schedule-bool',lambda r:r['allocationPressure']['releaseSchedule'].__setitem__(0,False)),('requested-bytes-float',lambda r:r['allocationPressure']['targets'][0]['capacityBefore'].__setitem__('availableRequestedBytes',float(r['allocationPressure']['targets'][0]['capacityBefore']['availableRequestedBytes'])))]:
 scratch=OUT/('receipt-wasm-'+label);scratch.mkdir(exist_ok=True)
 for path in (BASE/'wasm').iterdir():
  target=scratch/path.name
  if path.name!='report.json' and not target.exists():target.symlink_to(path)
 # Relative baseline points to verifier/native. Symlink once without overwriting.
 link=OUT/'native'
 if not link.exists():link.symlink_to(BASE/'native',target_is_directory=True)
 report=json.loads((BASE/'wasm/report.json').read_bytes());change(report);(scratch/'report.json').write_text(json.dumps(report))
 attempt('wasm-'+label,lambda:wasm_receipt.verify_recording(scratch,native),{'operation':label})
for label,change in [('clean',lambda r:None),('result-ok-int',lambda r:r['cases'][0]['result'].__setitem__('ok',int(r['cases'][0]['result']['ok'])))]:
 scratch=OUT/('receipt-consumer-'+label);scratch.mkdir(exist_ok=True)
 for path in (BASE/'consumer-regression/native').iterdir():
  target=scratch/path.name
  if path.name!='native-report.json' and not target.exists():target.symlink_to(path)
 report=json.loads((BASE/'consumer-regression/native/native-report.json').read_bytes());change(report);(scratch/'native-report.json').write_text(json.dumps(report))
 attempt('consumer-'+label,lambda:consumer_compat.verify_native(scratch,HEAD),{'operation':label})
(OUT/'receipt-extra-results.json').write_text(json.dumps({'head':HEAD,'results':results},indent=2)+'\n')
