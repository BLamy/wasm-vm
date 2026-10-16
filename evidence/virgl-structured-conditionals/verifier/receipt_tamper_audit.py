#!/usr/bin/env python3
"""Verifier-only mutations of copied native recordings; never touch worker data."""
import copy,hashlib,json,sys,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'tools/virgl-structured-conditionals'))
import native_receipt
HEAD='242ad5705dbdfd07b269c3e5850857c893af41e7'
BASE=ROOT/'evidence/virgl-structured-conditionals/worker/native'
original=json.loads((BASE/'native-report.json').read_bytes())
results=[]
def attack(name,change):
 scratch=OUT/('receipt-'+name);scratch.mkdir(exist_ok=True)
 for path in BASE.iterdir():
  target=scratch/path.name
  if path.name!='native-report.json' and not target.exists():target.symlink_to(path)
 report=copy.deepcopy(original);description=change(report);(scratch/'native-report.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
 try:native_receipt.verify(scratch,HEAD);outcome='ACCEPTED'
 except Exception as e:outcome='REJECTED';description['error']=str(e)
 results.append({'attack':name,'outcome':outcome,**description})
 print(json.dumps(results[-1]))
def slot(report):
 row=next(c for c in report['cases'] if c['ok'] and c['result']['metadata'].get('constantDomains'))
 row['result']['metadata']['constantDomains'][0]['slot']=False
 return {'case':row['name'],'field':'result.metadata.constantDomains[0].slot','before':0,'after':False}
def index(report):
 row=next(c for c in report['cases'] if c['ok'] and len(c['result']['metadata']['inputs'])>1)
 field=next(k for k,v in row['result']['metadata']['inputs'][1].items() if type(v)is int and v in (0,1))
 old=row['result']['metadata']['inputs'][1][field];row['result']['metadata']['inputs'][1][field]=bool(old)
 return {'case':row['name'],'field':'result.metadata.inputs[1].'+field,'before':old,'after':bool(old)}
def missing(report):
 del report['coverage']['sources'][0]
 return {'field':'coverage.sources[0]','operation':'deleted'}
def counter(report):
 report['stats']['calls']+=1
 return {'field':'stats.calls','operation':'incremented'}
for name,change in [('clean',lambda r:{'operation':'unchanged'}),('domain-slot-bool',slot),('input-index-bool',index),('omitted-coverage-source',missing),('counter-plus-one',counter)]:attack(name,change)
(OUT/'receipt-tamper-results.json').write_text(json.dumps({'head':HEAD,'nativeReportSha256':hashlib.sha256((BASE/'native-report.json').read_bytes()).hexdigest(),'results':results},indent=2)+'\n')
