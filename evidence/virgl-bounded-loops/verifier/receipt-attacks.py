import tempfile, shutil
import copy,json,pathlib,shutil,sys,hashlib
root=pathlib.Path(__file__).resolve().parents[3];sys.path.insert(0,str(root/'tools/virgl-bounded-loops'))
import consumer_receipt, profile_receipt
head='bfcd3a4076a163648c67bf7674e94d616c42c1e1'
results=[]
for name,module in [('consumer-unit',consumer_receipt),('profiles',profile_receipt)]:
 source=root/'evidence/virgl-bounded-loops/worker'/name
 result=module.verify(source,head);results.append({'name':name+'-control','passed':True})
 for field in ['count','startOffset','endOffset']:
  for kind in ['float','bool']:
   dest=pathlib.Path(tempfile.mkdtemp(prefix='e9-v8-forgery-'))/(name+'-'+field+'-'+kind);shutil.copytree(source,dest,dirs_exist_ok=True)
   coverage=json.loads((dest/'coverage.json').read_text());span=coverage[0]['functions'][0]['ranges'][0]
   span[field]=float(span[field]) if kind=='float' else bool(span[field])
   raw=(json.dumps(coverage,indent=2)+'\n').encode();(dest/'coverage.json').write_bytes(raw)
   report=json.loads((dest/'report.json').read_text());report['coverage']['bytes']=len(raw);report['coverage']['sha256']=hashlib.sha256(raw).hexdigest();(dest/'report.json').write_text(json.dumps(report,indent=2)+'\n')
   try:module.verify(dest,head)
   except Exception as e:results.append({'name':dest.name,'rejected':True,'message':str(e)})
   else:results.append({'name':dest.name,'rejected':False})
   shutil.rmtree(dest.parent)
(pathlib.Path(__file__).resolve().parent / 'receipt-attacks.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2));assert all(r.get('rejected',True) for r in results)
