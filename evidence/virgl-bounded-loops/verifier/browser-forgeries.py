import tempfile, shutil
import json,copy,pathlib,sys,hashlib
root=pathlib.Path(__file__).resolve().parents[3];sys.path.insert(0,str(root/'tools/virgl-bounded-loops'));import browser_receipt as b
worker=root/'evidence/virgl-bounded-loops/worker';n=json.load(open(worker/'native/native-report.json'));r=json.load(open(worker/'hardware/report.json'));fixture=json.load(open(root/'renderer/virgl-command/tests/bounded-loops-shaders.json'));cases={e['name']:e['result'] for e in n['cases']};pairs={e['name']:e['result'] for e in n['pairs']};originals={e['sha256']:e['result'] for e in n['originals']};head='bfcd3a4076a163648c67bf7674e94d616c42c1e1';results=[]
for name,path,value in [('draws-float',['drawCount'],39.0),('pixels-float',['checkedPixels'],159744.0),('word-bool',['rigs',0,'atlases',0,'pages',0,'observedWords',0],True),('pixel-float',['rigs',0,'atlases',0,'rgbaBytes',0],0.0),('fence-seed-float',['rigs',3,'schedule','seed'],float(r['acceptance']['rigs'][3]['schedule']['seed'])),('shader-ok-int',['shaderFixtures',0,'result','ok'],1)]:
 proof=copy.deepcopy(r['acceptance']);obj=proof
 for key in path[:-1]:obj=obj[key]
 obj[path[-1]]=value
 try:b.verify_proof(proof,fixture,cases,pairs,originals)
 except Exception as e:results.append({'name':name,'rejected':True,'message':str(e)})
 else:results.append({'name':name,'rejected':False})
for value,name in [(1.0,'float'),(True,'bool')]:
 d=pathlib.Path(tempfile.mkdtemp(prefix='e9-browser-forgery-'));d.mkdir(exist_ok=True)
 for f in (worker/'hardware').iterdir():
  if f.name not in ['report.json','browser-coverage.json']:(d/f.name).symlink_to(f)
 report=copy.deepcopy(r);coverage=json.load(open(worker/'hardware/browser-coverage.json'));coverage['scripts'][0]['coverage']['functions'][0]['ranges'][0]['count']=value
 raw=(json.dumps(coverage)+'\n').encode();(d/'browser-coverage.json').write_bytes(raw);report['browserCoverage']['sha256']=hashlib.sha256(raw).hexdigest();(d/'report.json').write_text(json.dumps(report)+'\n')
 try:b.envelope(d,head,'normal',None,False)
 except Exception as e:results.append({'name':'coverage-count-'+name,'rejected':True,'message':str(e)})
 else:results.append({'name':'coverage-count-'+name,'rejected':False})
 shutil.rmtree(d)
(pathlib.Path(__file__).resolve().parent / 'browser-forgeries.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2));assert all(x['rejected'] for x in results)
