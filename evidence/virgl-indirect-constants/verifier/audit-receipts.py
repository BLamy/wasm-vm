#!/usr/bin/env python3
"""Deliberately corrupt final proof copies; require exact-type rejection."""
import copy,hashlib,json,pathlib,shutil,sys
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'tools/virgl-indirect-constants'))
import consumer_receipt,native_receipt,profile_receipt,wasm_receipt

def read(p):return json.loads(p.read_bytes())
def write(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def binding(p):b=p.read_bytes();return {'path':p.name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def mutate_report(p,fn):r=read(p);fn(r);write(p,r)
def counter(fnname,value):
 def mutate(directory):
  p=directory/'coverage.json';data=read(p)
  target=next(f for s in data if s['url'].endswith('/constant-domain.mjs') for f in s['functions'] if f['functionName']==fnname)
  target['ranges'][0]['count']=value(target['ranges'][0]['count']);write(p,data)
  mutate_report(directory/'report.json',lambda r:r.update(coverage=binding(p)))
 return mutate

def main():
 source=pathlib.Path(sys.argv[1]).resolve();head=sys.argv[2];results=[]
 native=native_receipt.verify(source/'native',head)
 validators={'native':lambda p:native_receipt.verify(p,head),'consumer-unit':lambda p:consumer_receipt.verify(p,head),
             'profiles':lambda p:profile_receipt.verify(p,head),'wasm':lambda p:wasm_receipt.verify(p,head,native)}
 for kind,validate in validators.items():validate(source/kind);results.append({'name':kind+'-clean','result':'HELD'})
 cases=[]
 for field in ('maxSingleResultBytes','maxPairResultBytes'):
  def alter(d,field=field):
   p=d/'native-report.json';r=read(p);r['stats'][field]=float(r['stats'][field])
   lines=(d/'native.log').read_text().splitlines()
   for i,l in enumerate(lines):
    if l.startswith('STATS '):x=json.loads(l[6:]);x[field]=float(x[field]);lines[i]='STATS '+json.dumps(x,separators=(',',':'))
   (d/'native.log').write_text('\n'.join(lines)+'\n');r['logSha256']=hashlib.sha256((d/'native.log').read_bytes()).hexdigest();write(p,r)
  cases.append(('native','max-float-'+field,alter))
 cases.extend([('wasm','wasm-calls-float',lambda d:mutate_report(d/'report.json',lambda r:r['counts'].update(calls=float(r['counts']['calls'])))),
               ('wasm','wasm-schedule-bool',lambda d:mutate_report(d/'report.json',lambda r:r['allocationPressure']['releaseSchedule'].__setitem__(0,False))),
               ('wasm','wasm-capacity-float',lambda d:mutate_report(d/'report.json',lambda r:r['allocationPressure']['targets'][0]['capacityBefore'].update(availableRequestedBytes=float(r['allocationPressure']['targets'][0]['capacityBefore']['availableRequestedBytes'])))),
               ('consumer-unit','consumer-coverage-float',counter('checkIndirectBank',float)),
               ('consumer-unit','consumer-coverage-bool',counter('checkIndirectBank',lambda n:True)),
               ('profiles','profile-coverage-float',counter('parseConstantDomain',float)),
               ('consumer-unit','metadata-slot-bool',lambda d:mutate_report(d/'report.json',lambda r:r['schemas'][0]['result']['access'].update(slot=False))),
               ('consumer-unit','schema-result-ok-int',lambda d:mutate_report(d/'report.json',lambda r:r['schemas'][0]['result'].update(ok=1))),
               ('consumer-unit','omitted-source',lambda d:mutate_report(d/'report.json',lambda r:r['sources'].pop(0))),
               ('consumer-unit','source-bytes-float',lambda d:mutate_report(d/'report.json',lambda r:r['sources'][0].update(bytes=float(r['sources'][0]['bytes'])))),
               ('native','metadata-index-bool',lambda d:mutate_report(d/'native-report.json',lambda r:r['cases'][0]['result']['metadata']['constantAccesses'][0]['indices'].__setitem__(0,False)))])
 for kind,name,alter in cases:
  target=OUT/('final-receipt-'+name)
  if kind=='wasm':
   target.mkdir(exist_ok=True); sibling=target/'native'
   if not sibling.exists():sibling.symlink_to(source/'native',target_is_directory=True)
   target=target/'wasm'
  shutil.copytree(source/kind,target,dirs_exist_ok=True);validators[kind](target);alter(target)
  try:validators[kind](target)
  except Exception as error:
   if isinstance(error, (OSError, KeyError, IndexError, TypeError)):raise
   results.append({'name':name,'result':'HELD','rejection':str(error)})
  else:results.append({'name':name,'result':'FAILED','rejection':None})
 report={'schema':1,'head':head,'evidenceDirectory':str(source),'results':results};write(OUT/'final-receipt-attacks.json',report)
 print(json.dumps(report,indent=2));assert all(x['result']=='HELD' for x in results)
if __name__=='__main__':main()
