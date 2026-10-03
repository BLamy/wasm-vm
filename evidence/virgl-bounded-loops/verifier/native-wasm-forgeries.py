import tempfile, shutil
import copy,json,pathlib,sys,hashlib,os
root=pathlib.Path(__file__).resolve().parents[3];sys.path.insert(0,str(root/'tools/virgl-bounded-loops'))
import native_receipt as n,wasm_receipt as w
head='bfcd3a4076a163648c67bf7674e94d616c42c1e1';worker=root/'evidence/virgl-bounded-loops/worker';native=json.loads((worker/'native/native-report.json').read_text());wasm=json.loads((worker/'wasm/report.json').read_text());results=[]
def trial(name,mode,path,value,coverage=False):
 d=pathlib.Path(tempfile.mkdtemp(prefix='e9-forgery-'))/name;d.mkdir(parents=True,exist_ok=True)
 for source in (worker/mode).iterdir():
  if source.name==('native-report.json' if mode=='native' else 'report.json') or (coverage and source.name=='coverage.json'):continue
  (d/source.name).symlink_to(source)
 report=copy.deepcopy(native if mode=='native' else wasm)
 if mode=='wasm':
  # Retain the expected ../native identity for the independently checked baseline.
  parent=d.parent/'native'
  if not parent.exists():parent.symlink_to(worker/'native')
 if coverage:
  c=json.loads((worker/'native/coverage.json').read_text());obj=c
 else:obj=report
 for key in path[:-1]:obj=obj[key]
 obj[path[-1]]=value
 if coverage:
  raw=(json.dumps(c,separators=(',',':'))+'\n').encode();(d/'coverage.json').write_bytes(raw)
  for r in report['coverage']['records']:
   if r['path']=='coverage.json':r['bytes']=len(raw);r['sha256']=hashlib.sha256(raw).hexdigest()
 (d/('native-report.json' if mode=='native' else 'report.json')).write_text(json.dumps(report,separators=(',',':'))+'\n')
 try:
  (n.verify(d,head) if mode=='native' else w.verify(d,head,native))
 except Exception as e:results.append({'name':name,'rejected':True,'message':str(e)})
 else:results.append({'name':name,'rejected':False})
 print(json.dumps(results[-1]),flush=True)
 shutil.rmtree(d.parent)
for name,path,value in [
 ('calls-float',['stats','calls'],743022.0),('maxsingle-float',['stats','maxSingleResultBytes'],63369.0),
 ('maxpair-float',['stats','maxPairResultBytes'],109235.0),('flow-float',['flow','arenaBytes'],52644.0),
 ('count-bool',['cases',0,'result','metadata','constantConstraints',0,'component'],False),
 ('extent-float',['cases',0,'result','metadata','constantConstraints',0,'count'],46.0),
 ('source-bytes-float',['sources',0,'bytes'],float(native['sources'][0]['bytes'])),
 ('allocation-counter-bool',['allocationFaults',0,'attempts'],True),
]:trial('native-'+name,'native',path,value)
for value,name in [(0.0,'float'),(False,'bool')]:trial('native-llvm-region-'+name,'native',['data',0,'functions',0,'regions',0,4],value,True)
for name,path,value in [
 ('calls-float',['counts','calls'],15151.0),('memory-float',['memory','initialBytes'],16777216.0),
 ('schedule-bool',['allocationPressure','releaseSchedule',1],True),
 ('capacity-float',['allocationPressure','targets',0,'capacityBefore','availableRequestedBytes'],float(wasm['allocationPressure']['targets'][0]['capacityBefore']['availableRequestedBytes'])),
 ('source-bytes-float',['sources',0,'bytes'],float(wasm['sources'][0]['bytes'])),
 ('ownership-ok-int',['ownership',0,'result','ok'],1),
]:trial('wasm-'+name,'wasm',path,value)
(pathlib.Path(__file__).resolve().parent / 'native-wasm-forgeries.json').write_text(json.dumps(results,indent=2)+'\n');assert all(r['rejected'] for r in results)
