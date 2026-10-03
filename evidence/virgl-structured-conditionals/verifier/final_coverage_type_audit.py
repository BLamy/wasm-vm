#!/usr/bin/env python3
"""Actual envelope replay with typed coverage corruptions and resealed digests."""
import copy,hashlib,json,shutil,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT/'tools/virgl-structured-conditionals'))
import browser_receipt as br,consumer_compat as cr
BASE=ROOT/'evidence/virgl-structured-conditionals/worker';OLD='242ad5705dbdfd07b269c3e5850857c893af41e7';NEW='e0bdfe31f959547a1794de5027187ef29abe3d42'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==NEW
manifest=json.loads((BASE/'fault-artifacts/manifest.json').read_bytes());contract=json.loads((ROOT/'docs/gpu-3d-contract.json').read_bytes());results=[]
for family,relative in [('structured','hardware'),('consumer','consumer-regression/hardware')]:
 for attack in ['clean','count-bool','offset-float']:
  scratch=Path(tempfile.mkdtemp(prefix='e7-final-coverage-type-'));original=BASE/relative;r=json.loads((original/'report.json').read_bytes());entry=r['browserCoverage'];coverage=json.loads((original/entry['path']).read_bytes());target=coverage['scripts'][0]['coverage']['functions'][0]['ranges'][0]
  if attack=='count-bool':target['count']=bool(target['count'])
  if attack=='offset-float':target['startOffset']=float(target['startOffset'])
  raw=json.dumps(coverage).encode();(scratch/entry['path']).write_bytes(raw);entry['sha256']=hashlib.sha256(raw).hexdigest()
  if 'bytes' in entry:entry['bytes']=len(raw)
  if 'size' in entry:entry['size']=len(raw)
  for name in ['screenshot','failureScreenshot']:
   if name in r:shutil.copy2(original/r[name]['path'],scratch/r[name]['path'])
  (scratch/'report.json').write_text(json.dumps(r))
  try:
   if family=='structured':br.envelope(scratch,OLD,'normal',manifest,False)
   else:cr.envelope(scratch,OLD,contract,'normal')
   status='ACCEPTED';error=None
  except Exception as e:status='REJECTED';error=str(e)
  expected='ACCEPTED' if attack=='clean' else 'REJECTED';row={'family':family,'attack':attack,'outcome':status,'error':error};results.append(row);print(json.dumps(row),flush=True);assert status==expected,row;shutil.rmtree(scratch)
report={'status':'passed','sourceHead':NEW,'recordedRuntimeHead':OLD,'boundary':'Replay actual unmodified warm envelope/artifacts with final frozen receipt helpers; no relabeled worker run. Two copies reseal coverage digest after type corruption.','sources':[{ 'path':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [ROOT/'tools/virgl-structured-conditionals/browser_receipt.py',ROOT/'tools/virgl-structured-conditionals/consumer_compat.py']],'results':results}
for item in report['sources']:assert subprocess.check_output(['git','show',NEW+':'+item['path']],cwd=ROOT)==(ROOT/item['path']).read_bytes()
(OUT/'final-coverage-type-results.json').write_text(json.dumps(report,indent=2)+'\n')
