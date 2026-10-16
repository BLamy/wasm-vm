#!/usr/bin/env python3
"""Authenticate frozen recordings against independently executed TGSI/geometry."""
import hashlib,json,struct,subprocess,sys
from pathlib import Path
from fractions import Fraction as F
from reference import coordinates,execute,value
ROOT=Path(__file__).resolve().parents[2]
TASK='E6-T12g6k'
SEEDS=[2654435769,608135816,2242054355]
def sha(raw):return hashlib.sha256(raw).hexdigest()
def require(v,label):
 if not v:raise ValueError(label)
def main():
 directory=Path(sys.argv[1]).resolve();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
 require(not subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT),'freeze tracked sources')
 sources,records={},{}
 def source(name,digest=None,size=None):
  raw=(ROOT/name).read_bytes();require(digest is None or sha(raw)==digest,'source digest '+name);require(size is None or len(raw)==size,'source size '+name)
  if not name.startswith('renderer/virgl-shader/build/'):
   require(raw==subprocess.check_output(['git','show',f'{head}:{name}'],cwd=ROOT),'committed source '+name)
  row=dict(path=name,bytes=len(raw),sha256=sha(raw));require(name not in sources or sources[name]==row,'consistent source '+name);sources[name]=row
 def artifact(name,digest=None):
  raw=(directory/name).read_bytes();require(digest is None or sha(raw)==digest,'artifact digest '+name);records[name]=dict(path=name,bytes=len(raw),sha256=sha(raw));return raw
 def report(name,task=TASK,passed=True):
  result=json.loads(artifact(name));require(result['gitHead']==head,'exact recording head '+name);require(result['task']==task,'record task '+name);require(result['status']==('passed'if passed else'failed'),'record outcome '+name)
  for row in result.get('sources',[]):source(row['path'],row['sha256'],row.get('size',row.get('bytes')))
  return result
 def browser(name,passed=True):
  r=report(name+'/report.json',passed=passed);require(not r['trackedChanges'],'frozen browser sources');require(r['browserErrors']==dict(console=[],page=[],requests=[]),'zero browser errors')
  require(not r['browser']['launch']['headless'] and r['browser']['gpu']['featureStatus'][r['browser']['webglFeature']]=='enabled','headed physical GPU')
  capture=r.get('screenshot')or r.get('failureScreenshot');artifact(name+'/'+capture['path'],capture['sha256'])
  for row in json.loads(artifact(name+'/'+r['browserCoverage']['path'],r['browserCoverage']['sha256']))['scripts']:require(sources[row['source']]['sha256']==row['sha256'],'V8 source binding')
  for row in r['servedFiles']:require(sources[row['path']]['sha256']==row['sha256'],'served source binding')
  a=r['acceptance'];require(a['guestExecution'] is False and a['productionNegotiation'] is False and a['objects']['live']==0,'isolated disposed GPU')
  require(a['primaryFile']['sha256']==native['primaryFile']['sha256'],'pinned primary table');return a
 native=report('native/report.json')
 expected=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {getCases}from'./tools/virgl-fragment-coordinates/cases.mjs';import{getCombinedCases}from'./tools/virgl-fragment-coordinates/combined.mjs';process.stdout.write(JSON.stringify([...getCases(),...getCombinedCases()]));"],cwd=ROOT))
 require(len(expected)==len(native['cases']) and native['seeds']==SEEDS,'complete predetermined native cases')
 for wanted,c in zip(expected,native['cases']):
  require(all(c[k]==v for k,v in wanted.items()) and c['textSha256']==sha(c['text'].encode()),'literal native source');require(c['result']['ok'] is c['ok'] and c['pairResult']['ok'] is c['pairOk'],'native admission')
  if c['ok']:require(c['consumerDomain']['ok'] and 'coordinates'in c['consumerDomain'],'approved coordinate policy')
  else:require(not any(k in c['result']for k in ['glsl','metadata']),'closed native result')
  if not c['pairOk']:require(not any(k in c['pairResult']for k in ['vertex','fragment','metadata']),'closed pair result')
  if c['primary']:
   p=c['primaryResult'];require(dict(index=0,last=0,semantic=0,semanticIndex=0,mask=15,interpolation=1)in p['declarations'],'pinned POSITION tokens')
   require(dict(name=3,value=1)in p['properties'] and dict(name=4,value=0)in p['properties'],'literal coordinate properties');require(p['lowerLeftKey']==1 and p['hasNoperspective']==p['hasSampleInput']==0 and 'gl_FragCoord'in p['glsl'],'pinned physical convention')
 artifact('native/cases.bin',native['fixtureSha256']);artifact('native/native.log',native['logSha256']);require(not artifact('native/native.stderr',native['stderrSha256']),'zero sanitizer diagnostics')
 coverage=json.loads(artifact('native/coverage.json',native['coverageSha256']))
 for name in ['coordinate_contract','input_float','validate_body','match_interface','interface_key','checked_fragment_interface','raw_record','raw_emit']:
  require(any((f['name']==name or f['name'].endswith(':'+name))and f['count']>0 for d in coverage['data']for f in d['functions']),'covered coordinate runtime '+name)
 source(native['binary']['path'],native['binary']['sha256'],native['binary']['bytes']);source(native['primaryFile']['path'],native['primaryFile']['sha256'],native['primaryFile']['bytes']);source(native['original']['path'],native['original']['sha256'])
 primary=json.loads((ROOT/native['primaryFile']['path']).read_bytes());require(primary==[dict(name=c['name'],text=c['text'],primary=c['primaryResult'])for c in native['cases']if c['primary']],'complete original primary table');primary_by_text={p['text']:p['primary']for p in primary}
 wasm=report('wasm/report.json');require(wasm['nativeSha256']==records['native/report.json']['sha256'] and len(wasm['cases'])==len(expected),'whole wasm table')
 for c,w in zip(native['cases'],wasm['cases']):require(w['name']==c['name'] and w['result']==c['result'] and w['pair']==c['pairResult'],'complete native/Wasm singles/pairs')
 independent=report('independent-coordinate-guards.json');source('tools/virgl-fragment-coordinates/independent-guards.mjs',independent['sourceSha256'])
 require(independent['cases']==len(independent['native'])==len(independent['wasm'])==len(independent['predictions'])==380 and independent['metadataAttacks']==len(independent['metadataRecords'])==32 and independent['bankAttacks']==len(independent['banks'])==480 and independent['getterInvocations']==0,'complete independent boundary guards')
 require(all(a['result']==b['result'] and a['result']['ok']is p['ok'] and b['pair']['ok']is p['pairOk'] for a,b,p in zip(independent['native'],independent['wasm'],independent['predictions'])),'independent complete native/Wasm parity and predetermined admission')
 require(all(c['result']['ok']is c['expected']for c in independent['banks'])and all(c['result']['ok']is False for c in independent['metadataRecords']),'independent copied-bank and inert metadata restrictions')
 require(independent['sanitizedBinarySha256']==native['binary']['sha256'],'independent actual sanitizer source binding');artifact('independent-cases.bin',independent['fixtureSha256']);artifact('independent-native.log',independent['logSha256']);artifact('independent-native.profraw',independent['originalProfileSha256']);require(not artifact('independent-native.stderr'),'independent sanitizer diagnostics')
 source('tools/virgl-fragment-coordinates/capture-check.py')
 consumer=report('consumer.json');require(consumer['nativeSha256']==records['native/report.json']['sha256'] and len(consumer['contracts'])==sum(c['ok']for c in expected) and len(consumer['forgeries'])>=500 and consumer['accessorInvocations']==0,'owned metadata and inert attacks')
 require(len(consumer['combined'])==len(consumer['banks'])==4,'all simultaneous underlying policies/banks')
 for row in consumer['combined']:require(row['restored']==dict(row['base'],inputs=[i for i in row['base']['inputs']if i['index']!=0]),'whole previous obligations')
 require(all(c['result']['ok']is False for c in consumer['forgeries']),'all metadata forgeries reject')
 for bank in consumer['banks']:require(all(c['result']['ok']is c['wanted']for c in bank['checks']),'inherited numerical restrictions')
 legacy=report('legacy.json');require(len(legacy['cases'])==8034,'all authenticated predecessor results');source('evidence/virgl-power/worker/manifest.json');source('evidence/virgl-power/worker/records.json');source('evidence/virgl-power/worker/recording.tar.gz',legacy['archiveSha256'])
 retained=report('retained/report.json',task='E6-T12g6b');require(len(retained['originals'])==25 and sum(c['native']['ok']for c in retained['originals'])==23 and len(retained['historical'])==112 and sum(c['native']['ok']for c in retained['historical'])==5,'unchanged original complete bodies remain gated')
 for name,count in [('joins',402),('hex',49),('signed',108),('conversion',1575),('scalar',1427),('minimum',4524),('fraction',4469),('saturation',1160),('exponent',1022),('sine',520),('power',1914)]:
  guard=json.loads(artifact('independent-'+name+'-guards.json'));require(guard['status']=='passed' and guard['cases']==len(guard['native'])==len(guard['wasm'])==count,'promoted '+name)
  for a,b in zip(guard['native'],guard['wasm']):require(a['result']==b['result'] or a['result'].get('error',{}).get('code')==b['result'].get('error',{}).get('code')=='invalid-input','promoted parity')
 direct_pixels=consumer_pixels=0;maximum={backend:dict(error=F(0),point=None)for backend in ['owned','mesa']};references={}
 for seed in SEEDS:
  filename=f'renderer/virgl-shader/build/coordinate-reference-{seed}.json';raw=(ROOT/filename).read_bytes();source(filename);reference=json.loads(raw);source('tools/virgl-fragment-coordinates/reference.py',reference['sourceSha256']);references[seed]=(reference,sha(raw))
  planned=subprocess.check_output(['node','--input-type=module','-e',f"import{{physicalPlan}}from'./tools/virgl-fragment-coordinates/cases.mjs';process.stdout.write(JSON.stringify(physicalPlan({seed})));"],cwd=ROOT);plan=json.loads(planned)
  require(sha(planned)==reference['planSha256'] and len(plan)==len(reference['rows']),'literal planned rational predictions')
  gpu=browser('gpu-'+str(seed));require(gpu['seed']==seed and gpu['fault']is None and gpu['referenceFile']['sha256']==sha(raw) and gpu['planSha256']==sha(planned),'pre-observation reference binding');require(len(gpu['probes'])==len(plan),'complete GPU schedule')
  critic=json.loads(artifact('independent-capture-'+str(seed)+'.json'));require(critic['status']=='passed'and critic['seed']==seed and critic['fault']is None and critic['sourceReportSha256']==records['gpu-'+str(seed)+'/report.json']['sha256']and critic['totalPixels']==gpu['checkedPixels']and critic['rejections']==48,'independent source/geometry capture proof binding')
  for index,(p,r,probe)in enumerate(zip(plan,reference['rows'],gpu['probes'])):
   require(all(probe[k]==v for k,v in p.items()) and probe['textSha256']==r['textSha256']==sha(p['text'].encode()) and r['geometry']==p['geometry'],'GPU input schedule')
   require(probe['primary']==primary_by_text[p['text']] and probe['mutation']is None,'unmodified pinned comparison');require(probe['policy']['coordinates']['source']=='gl_FragCoord' and 'reciprocal-w'in probe['pair']['interfaceKey'],'checked builtin selector')
   pixels=bytes(probe['rgbaBytes']);require(sha(pixels)==probe['sha256'] and len(pixels)==p['geometry']['width']*p['geometry']['height']*4,'physical complete pixel bytes');words=list(struct.unpack('<'+'I'*(len(pixels)//4),pixels));require(words==probe['words'],'whole evaluated component words')
   g=p['geometry'];x0,y0,w,h=g['viewport'];require(len(r['points'])==len(words) and probe['checkedPixels']==len(words),'all framebuffer pixels')
   for point,observed in zip(r['points'],words):
    x,y=point['x'],point['y'];inside=x0<=x<x0+w and y0<=y<y0+h;require(point['written']is inside,'rational viewport coverage')
    if not inside:require(point['rgba']==[17,34,51,68] and observed==0x44332211,'outside viewport sentinel');continue
    coord=coordinates(g,x,y);predicted,tainted=execute(p['text'],coord,p['generic']);budget=F(0)if g['exactZW']or not tainted else F(1,1<<20)
    require(point['coordinates']==list(map(str,coord)) and point['word']==predicted and F(point['budget'])==budget,'independent geometry and literal TGSI result')
    if not budget:require(observed==predicted,'exact physical coordinate component')
    else:
     require(point['value']==str(value(predicted)),'numeric reference');error=abs(value(observed)-value(predicted));require(error<=budget,'measured physical component budget')
     if error>maximum[p['backend']]['error']:maximum[p['backend']]=dict(error=error,point=dict(seed=seed,probe=index,x=x,y=y,word=observed,expectedWord=predicted,rawSha256=probe['sha256']))
   direct_pixels+=len(words)
  require(len(gpu['consumers'])==2,'both indexed execution modes')
  for c in gpu['consumers']:
   require(len(c['captures'])==32 and len(c['rejections'])==24 and c['commandsPerStep']==1+seed%3,'varied owned command schedules')
   require(all(v==0 for v in c['finalBudgets'].values()) and all(v==0 for v in c['finalResourceBudgets'].values()),'zero indexed budgets')
   for s in c['submissions']:require(all(b==255 for b in s['after']),'caller wire snapshot ownership')
   for rejection in c['rejections']:
    require(rejection['result']['ok']is False,'closed indexed rejection')
    if 'before'in rejection:require(rejection['before']==rejection['after'] and rejection['result']['appliedCommands']==0,'atomic indexed rejection')
    require(all(c['asynchronous']and e['call']in ['fenceSync','deleteSync']for e in rejection.get('nativeEvents',[])),'only bounded async completion synchronization after rejection')
   for capture in c['captures']:
    require(capture['program']['interfaceKey'].endswith('|tgsi-fragment-position-v1:in0/linear/lower-left/half-integer/window-z/reciprocal-w'),'actual consumer key')
    pixels=bytes(capture['rgbaBytes']);require(len(pixels)==4096 and sha(pixels)==capture['sha256'],'indexed actual bytes');words=list(struct.unpack('<1024I',pixels));require(words==capture['words'] and capture['checkedPixels']==1024,'all indexed pixels')
    g=capture['geometry'];x0,y0,w,h=g['viewport']
    for i,observed in enumerate(words):
     x,y=i%32,i//32
     if x0<=x<x0+w and y0<=y<y0+h:
      expected_word,_=execute(capture['fragmentText'],coordinates(g,x,y),[F(1,4),F(1,2),F(3,4),F(1)]);require(observed==expected_word,'independent indexed coordinate pixels')
     else:require(observed==0x44332211,'indexed sentinel')
    consumer_pixels+=1024
  require(gpu['directPixels']==sum(p['geometry']['width']*p['geometry']['height']for p in plan) and gpu['consumerPixels']==65536 and gpu['checkedPixels']==gpu['directPixels']+gpu['consumerPixels'],'complete physical count')
 faults=[]
 for fault in ['x','y','z','w']:
  gpu=browser('fault-'+fault,passed=False);require(gpu['fault']==fault and 'independent coordinate pixel mismatch'in gpu['failure']['message'],'actual coordinate equation fault caught')
  critic=json.loads(artifact('independent-fault-'+fault+'.json'));require(critic['status']=='passed'and critic['fault']==fault and critic['sourceReportSha256']==records['fault-'+fault+'/report.json']['sha256']and any(p['failureCount']for p in critic['transcript']),'independent original-source fault sensitivity binding')
  changed=[p for p in gpu['probes']if p['mutation']];require(len(changed)==1,'one physical coordinate source fault');p=changed[0];m=p['mutation'];require(m['original']==p['pair']['fragment']['glsl'] and m['served']==m['original'].replace(m['needle'],m['replacement']),'actual emitted source mutation')
  point=p['failure'];require(point['point']['budget']=='0' and point['actual']!=point['point']['word'],'exact independent fault contradiction');faults.append(dict(kind=fault,sourceSha256=sha(m['served'].encode()),point=point,rawSha256=p['sha256']))
 paths=subprocess.check_output(['git','ls-files','renderer/virgl-shader','renderer/virgl-command','tools/virgl-fragment-coordinates','tools/virgl-power','tools/virgl-sine','tools/virgl-exponent-logarithm','tools/virgl-saturation','tools/virgl-precise-fraction','tools/virgl-compiler-bounds/retained.mjs','tools/lib/virgl-browser-runner.mjs','tools/verify-virgl-fragment-coordinates.sh','tools/setup-virgl-emsdk.sh','Makefile','web/package-lock.json'],cwd=ROOT,text=True).splitlines()
 for name in paths:source(name)
 for name in ['native/virgl-shader','wasm/virgl-shader.mjs','wasm/virgl-shader.wasm']:source('renderer/virgl-shader/build/'+name)
 for f in sorted(directory.rglob('*')):
  if f.is_file()and f.name not in ['receipt.json','acceptance.log']:artifact(str(f.relative_to(directory)))
 result=dict(schema='virgl-fragment-coordinate-receipt-v1',task=TASK,status='passed',gitHead=head,guestExecution=False,productionNegotiation=False,nativeCases=len(expected),wasmCases=len(expected),wasmPairs=len(expected),primaryComparisons=len(primary),legacyCases=len(legacy['cases']),metadataAttacks=len(consumer['forgeries']),ownedBanks=4,combinedBases=4,seeds=SEEDS,directPixels=direct_pixels,consumerPixels=consumer_pixels,checkedPixels=direct_pixels+consumer_pixels,maximumObservedError={k:dict(upperAbsoluteError=str(v['error']),displayApproximation=float(v['error']),point=v['point'])for k,v in maximum.items()},physicalOutputFaults=faults,sources=list(sources.values()),records=list(records.values()))
 (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(f'{TASK} receipt passed: {result["checkedPixels"]} independently predicted pixels')
if __name__=='__main__':main()
