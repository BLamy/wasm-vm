"""Read-only frozen receipt binding, GPU oracle and evidence-tamper audit."""
import copy,hashlib,importlib.util,json,pathlib,struct,subprocess
V=pathlib.Path(__file__).resolve().parent;ROOT=V.parents[2];E=ROOT/'evidence/virgl-dot-reciprocals/worker';HEAD='72a8695ba92d734a6bead0c42ead3089d8611806'
def digest(raw):return hashlib.sha256(raw).hexdigest()
def read(p):return json.loads(p.read_bytes())
def module(n,p):
 s=importlib.util.spec_from_file_location(n,ROOT/p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
main=module('fresh_scalar_worker_gpu','tools/virgl-dot-reciprocals/receipt.py');recip=module('fresh_scalar_worker_recip','tools/virgl-dot-reciprocals/reciprocal_receipt.py');extra=module('fresh_scalar_worker_extra','tools/virgl-dot-reciprocals/browser_receipt.py');h=vars(main)
receipt=read(E/'receipt.json');assert receipt['gitHead']==HEAD and receipt['status']=='passed'
source_map={r['path']:r for r in receipt['sources']};assert len(source_map)==len(receipt['sources'])
# One batch reads exact committed blobs, without trusting the worker's own receipt checker.
blobs={};current_deltas=[];paths=list(source_map);query=''.join(HEAD+':'+p+'\n' for p in paths).encode();p=subprocess.run(['git','cat-file','--batch'],input=query,stdout=subprocess.PIPE,check=True,cwd=ROOT);buf=p.stdout;cursor=0
for path in paths:
 end=buf.index(b'\n',cursor);header=buf[cursor:end].split();assert header[1]==b'blob';size=int(header[2]);raw=buf[end+1:end+1+size];cursor=end+size+2
 r=source_map[path];assert digest(raw)==r['sha256'] and len(raw)==r.get('bytes',r.get('size')),('unfrozen source',path)
 blobs[path]=raw
 if raw!=(ROOT/path).read_bytes():
  assert path=='renderer/virgl-shader/tests/dot-reciprocals.mjs' and raw.count(b'const fraction=(n,d=1n)=>SCALE*n/d;\n')==1 and raw.replace(b'const fraction=(n,d=1n)=>SCALE*n/d;\n',b'')==(ROOT/path).read_bytes()
  current_deltas.append({'path':path,'kind':'only the identified unused fraction helper deleted; old recording remains bound to old head'})
assert cursor==len(buf)
for r in receipt['records']:
 raw=(E/r['path']).read_bytes();assert digest(raw)==r['sha256'] and len(raw)==r['bytes'],('record mismatch',r['path'])
native=read(E/'native/native-report.json');fixtures=read(ROOT/'renderer/virgl-shader/tests/dot-reciprocal-cases.json');hardware=read(ROOT/'renderer/virgl-shader/tests/dot-reciprocal-hardware.json');cases={e['name']:e for e in native['cases']};pairs={e['name']:e for e in native['pairs']};originals={e['sha256']:e for e in native['originals']}
reports={name:read(E/name/'report.json') for name in ['hardware','sabotage-dp3-lane','sabotage-rcp-source','sabotage-rsq-operation','sabotage-numeric-negate']}
coverage={};contract=read(ROOT/'docs/gpu-3d-contract.json')
for label,r in reports.items():
 assert r['gitHead']==HEAD and r['task']=='E6-T12e6' and r['status']==('passed' if label=='hardware' else 'failed')
 assert r['trackedChanges']==[] and r['browserErrors']=={'console':[],'page':[],'requests':[]}
 assert r['guestExecution'] is False and r['currentGuest3dAdvertisement'] is False and r['hostUniformInjectionOnly'] is True
 bound={x['path']:x for x in r['sources']};served={x['path']:x for x in r['servedFiles']}
 for path,x in bound.items():
  raw=blobs[path] if path in blobs else (ROOT/path).read_bytes();assert digest(raw)==x['sha256'] and len(raw)==x['size']
  if '/build/' not in path:assert x['sha256']==source_map[path]['sha256']
 for path,x in served.items():assert x==bound[path]
 assert 'renderer/virgl-shader/build/wasm/virgl-shader.wasm' in served
 observed={'browserVersion':r['browser']['version'],**{k:r['host'][k] for k in ['platform','architecture','release']},'renderer':r['acceptance']['renderer']['renderer']};assert observed in contract['browserMatrix']['qualified']
 assert r['browser']['gpu']['featureStatus'][r['browser']['webglFeature']]=='enabled'
 photo=r['screenshot' if label=='hardware' else 'failureScreenshot'];assert digest((E/label/photo['path']).read_bytes())==photo['sha256']
 c=r['browserCoverage'];raw=(E/label/c['path']).read_bytes();assert digest(raw)==c['sha256']
 for s in json.loads(raw)['scripts']:
  assert s['sha256']==served[s['source']]['sha256']
  if s['source'].endswith('/dot-reciprocals.mjs'):
   for f in s['coverage']['functions']:
    z=f['ranges'][0];key=(f['functionName'],z['startOffset'],z['endOffset']);coverage[key]=coverage.get(key,0)+z['count']
 main.translations(r['acceptance'],fixtures,hardware,cases,pairs,originals)
 extra.verify_orientation(r['acceptance'],cases,helpers=h)
good=reports['hardware'];proof=good['acceptance'];main.verify_sequences(proof,hardware);main.verify_source_contracts(proof,hardware,cases)
numeric=main.verify_numeric(proof,hardware,cases);textures=main.verify_textures(proof,hardware,cases);reciprocals=recip.verify_reciprocals(proof,hardware,cases,helpers=h);observations=recip.verify_observations(proof,hardware,cases,helpers=h);pixels=main.verify_pairs(proof,hardware,pairs)
faults=[]
for mode in ['dp3-lane','rcp-source','rsq-operation','numeric-negate']:faults.append(extra.verify_sabotage(E/('sabotage-'+mode),mode,good,cases,hardware,helpers=h))
assert numeric==(248,30) and textures==receipt['textures'] and reciprocals==receipt['reciprocals'] and observations==receipt['specialObservations'] and pixels==receipt['interpolationPixels']
assert all(proof['memory'][k]==v for k,v in {'initialBytes':16777216,'finalBytes':16777216,'bufferIdentityStable':True}.items()) and proof['memory']['observations']>=len(fixtures)
assert proof['objects']['live']==0 and proof['objects']['created']==proof['objects']['deleted']
# Tamper only in detached Python data. Coherent raw-word changes challenge actual math/replication.
def rewrite_fragment(entry,words):
 entry['observedWords']=words;pixels=bytearray()
 for bit,d in enumerate(entry['draws']):d['observedBytes']=[255*((w>>bit)&1) for w in words];pixels.extend(d['observedBytes'])
 entry['bitPlaneBytesSha256']=digest(pixels)
 entry['rawObservations']=[recip.reciprocal_observation(l,w,helpers=h) for l,w in zip(entry['oracle']['lanes'],words)]
attacks=[]
for name in ['change-upload','widen-claimed-enclosure','out-of-range-coherent-word','within-bound-nonbroadcast','missing-program','invent-exact-root','change-bitplane-digest','weaken-zero-class']:
 p=copy.deepcopy(proof)
 if name=='change-upload':p['reciprocalVertexProbes'][0]['vectors'][0]['attributes'][1]['uploadedWords'][1]^=1
 elif name=='widen-claimed-enclosure':p['reciprocalVertexProbes'][0]['vectors'][0]['oracle']['lanes'][0]['upper']['numerator']='999999999999999'
 elif name in ['out-of-range-coherent-word','within-bound-nonbroadcast']:
  e=p['reciprocalFragmentProbes'][0]['vectors'][0];words=list(e['observedWords'])
  if name=='out-of-range-coherent-word':words=[0x3f800000]*4
  else:
   chosen=None
   for delta in [-1,1]:
    if recip.reciprocal_observation(e['oracle']['lanes'][0],words[0]+delta,helpers=h)['withinEnclosure']:chosen=words[0]+delta;break
   assert chosen is not None;words[1]=chosen
  rewrite_fragment(e,words)
 elif name=='missing-program':p['reciprocalVertexProbes'].pop()
 elif name=='invent-exact-root':p['reciprocalVertexProbes'][3]['vectors'][1]['oracle']['lanes'][0]={'kind':'exact','value':{'numerator':'1','denominator':'4'},'word':0x3e800000}
 elif name=='change-bitplane-digest':p['reciprocalFragmentProbes'][0]['vectors'][0]['bitPlaneBytesSha256']='0'*64
 else:p['observationProbes'][2]['vectors'][0]['requiredClasses']=[None]*4
 try:
  if name=='weaken-zero-class':recip.verify_observations(p,hardware,cases,helpers=h)
  else:recip.verify_reciprocals(p,hardware,cases,helpers=h)
 except (ValueError,AssertionError,KeyError,IndexError) as e:attacks.append({'attack':name,'status':'rejected','reason':str(e)})
 else:raise AssertionError('GPU evidence mutation escaped:'+name)
report={'status':'passed-with-dead-harness-helper-finding','head':HEAD,'receiptSha256':digest((E/'receipt.json').read_bytes()),'currentSourceDeltas':current_deltas,'sourcesBound':len(paths),'recordsBound':len(receipt['records']),'browserReports':{n:digest((E/n/'report.json').read_bytes()) for n in reports},'numeric':numeric,'textures':textures,'reciprocals':reciprocals,'observations':observations,'interpolationPixels':pixels,'faults':faults,'tamperChecks':attacks,'memory':proof['memory'],'objects':proof['objects'],'unenteredHarnessFunctions':[{'name':k[0],'startOffset':k[1],'endOffset':k[2],'count':v} for k,v in coverage.items() if not v]}
(V/'worker-browser-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ['browserReports','tamperChecks','objects']}))
