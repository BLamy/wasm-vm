#!/usr/bin/env python3
"""Authenticate frozen compiler, strict consumer and physical discard recordings."""
from pathlib import Path
import hashlib,json,subprocess,sys
from reference import prediction
ROOT=Path(__file__).resolve().parents[2]
TASK='E6-T12g6l'
SEEDS=[2654435769,608135816,2242054355]
def sha(raw):return hashlib.sha256(raw).hexdigest()
def require(value,label):
 if not value:raise ValueError(label)
def main():
 directory=Path(sys.argv[1]).resolve();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
 require(not subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT),'freeze tracked sources')
 sources,records={},{}
 def source(name,digest=None,size=None):
  raw=(ROOT/name).read_bytes();require(digest is None or sha(raw)==digest,'source digest '+name);require(size is None or len(raw)==size,'source size '+name)
  if not name.startswith('renderer/virgl-shader/build/'):require(raw==subprocess.check_output(['git','show',f'{head}:{name}'],cwd=ROOT),'committed source '+name)
  row=dict(path=name,bytes=len(raw),sha256=sha(raw));require(name not in sources or sources[name]==row,'consistent source '+name);sources[name]=row
 def artifact(name,digest=None):
  raw=(directory/name).read_bytes();require(digest is None or sha(raw)==digest,'artifact digest '+name);records[name]=dict(path=name,bytes=len(raw),sha256=sha(raw));return raw
 def report(name,task=TASK,passed=True):
  r=json.loads(artifact(name));require(r['gitHead']==head and r['task']==task and r['status']==('passed'if passed else'failed'),'exact recording head/task/outcome '+name)
  for row in r.get('sources',[]):source(row['path'],row['sha256'],row.get('size',row.get('bytes')))
  return r
 native=report('native/report.json')
 expected=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{getCases}from'./tools/virgl-fragment-discard/cases.mjs';import{getCombinedCases}from'./tools/virgl-fragment-discard/combined.mjs';process.stdout.write(JSON.stringify([...getCases(),...getCombinedCases()]));"],cwd=ROOT))
 require(native['seeds']==SEEDS and len(native['cases'])==len(expected),'whole literal native schedule')
 for wanted,c in zip(expected,native['cases']):
  require(all(c[k]==v for k,v in wanted.items())and c['textSha256']==sha(c['text'].encode()),'native literal source')
  require(c['result']['ok']is c['ok']and c['pairResult']['ok']is c['pairOk'],'native predetermined admissions')
  if c['ok']:
   require(c['result']['metadata']['profile']=='virgl-webgl2-raw-bits-v39'and c['consumerDomain']['ok']and 'discard'in c['consumerDomain'],'checked discard policy')
   if 'always'in c:require(c['consumerDomain']['discard']['alwaysDiscards']is c['always'],'predicted survivor liveness')
  else:require(not any(k in c['result']for k in ['glsl','metadata']),'closed rejection')
  if not c['pairOk']:require(not any(k in c['pairResult']for k in ['vertex','fragment','metadata']),'closed pair rejection')
  require(('primaryResult'in c)is c['primary'],'complete primary witnesses')
  if c['primary']:require('discard;'in c['primaryResult']['glsl']and len(c['primaryResult']['discardInstructions'])>0,'pinned discard emitted')
 artifact('native/cases.bin',native['fixtureSha256']);artifact('native/native.log',native['logSha256']);require(not artifact('native/native.stderr',native['stderrSha256']),'zero sanitizer diagnostics')
 coverage=json.loads(artifact('native/coverage.json',native['coverageSha256']))
 for name in ['discard_instruction','discard_contract','validate_body','interface_key','raw_discard_guaranteed','raw_record','raw_emit','raster_graph']:
  require(any((f['name']==name or f['name'].endswith(':'+name))and f['count']>0 for d in coverage['data']for f in d['functions']),'executed runtime '+name)
 source(native['binary']['path'],native['binary']['sha256'],native['binary']['bytes']);source(native['primaryFile']['path'],native['primaryFile']['sha256'],native['primaryFile']['bytes'])
 for original in native['originals']:source(original['path'],original['sha256'])
 primary=json.loads((ROOT/native['primaryFile']['path']).read_bytes());require(primary==[dict(name=c['name'],text=c['text'],primary=c['primaryResult'])for c in native['cases']if c['primary']],'whole primary table')
 wasm=report('wasm/report.json');require(wasm['nativeSha256']==records['native/report.json']['sha256']and len(wasm['cases'])==len(expected),'native/Wasm evidence binding')
 for c,w in zip(native['cases'],wasm['cases']):require(w['name']==c['name']and w['result']==c['result']and w['pair']==c['pairResult'],'complete Wasm singles/pairs')
 consumer=report('consumer.json');require(consumer['nativeSha256']==records['native/report.json']['sha256']and len(consumer['contracts'])==sum(c['ok']for c in expected)and consumer['accessorInvocations']==0,'strict owned policy table')
 require(len(consumer['forgeries'])>=800 and all(c['result']['ok']is False for c in consumer['forgeries']),'closed inert forgeries')
 require(len(consumer['combined'])==4 and len(consumer['banks'])==5,'all simultaneous obligations and copied bank')
 for c in consumer['combined']:require(c['base']==c['restored'],'whole previous metadata restored')
 for bank in consumer['banks']:require(all(c['result']['ok']is c['wanted']for c in bank['checks']),'inherited numeric bank restrictions')
 legacy=report('legacy.json');require(len(legacy['cases'])==8349 and len(legacy['extensions'])==2 and sum(c['extension']for c in legacy['cases'])==2,'authenticated predecessor count')
 for predecessor in legacy['predecessors']:
  for name in ['manifest.json','records.json']:source(predecessor['path']+'/'+name)
  source(predecessor['path']+'/recording.tar.gz',predecessor['archiveSha256'])
 retained=report('retained/report.json',task='E6-T12g6b');require(len(retained['originals'])==25 and sum(c['native']['ok']for c in retained['originals'])==23 and len(retained['historical'])==112 and sum(c['native']['ok']for c in retained['historical'])==5,'unchanged full captured programs remain gated')
 for name,count in [('joins',402),('hex',49),('signed',108),('conversion',1575),('scalar',1427),('minimum',4524),('fraction',4469),('saturation',1160),('exponent',1022),('sine',520),('power',1914),('coordinate',380)]:
  g=json.loads(artifact('independent-'+name+'-guards.json'));require(g['status']=='passed'and g['cases']==len(g['native'])==len(g['wasm'])==count,'promoted '+name)
  for a,b in zip(g['native'],g['wasm']):require(a['result']==b['result']or a['result'].get('error',{}).get('code')==b['result'].get('error',{}).get('code')=='invalid-input','promoted parity '+name)
 direct_pixels=consumer_pixels=qualifications=0;faults=[]
 def browser(name,passed=True):
  r=report(name+'/report.json',passed=passed);require(not r['trackedChanges']and r['browserErrors']==dict(console=[],page=[],requests=[]),'frozen error-free browser')
  require(not r['browser']['launch']['headless']and r['browser']['gpu']['featureStatus'][r['browser']['webglFeature']]=='enabled','physical headed GPU')
  capture=r.get('screenshot')or r.get('failureScreenshot');artifact(name+'/'+capture['path'],capture['sha256'])
  for s in json.loads(artifact(name+'/'+r['browserCoverage']['path'],r['browserCoverage']['sha256']))['scripts']:require(sources[s['source']]['sha256']==s['sha256'],'V8 coverage source binding')
  for s in r['servedFiles']:require(sources[s['path']]['sha256']==s['sha256'],'served source binding')
  a=r['acceptance'];require(a['guestExecution']is False and a['productionNegotiation']is False and a['objects']['live']==0,'isolated disposed hardware')
  require(a['primaryFile']['sha256']==native['primaryFile']['sha256'],'pinned primary digest');return a
 for seed in SEEDS:
  filename=f'renderer/virgl-shader/build/discard-reference-{seed}.json';source(filename);raw=(ROOT/filename).read_bytes();reference=json.loads(raw);source('tools/virgl-fragment-discard/reference.py',reference['sourceSha256'])
  planned=subprocess.check_output(['node','--input-type=module','-e',f"import{{physicalPlan}}from'./tools/virgl-fragment-discard/cases.mjs';process.stdout.write(JSON.stringify(physicalPlan({seed})));"],cwd=ROOT);plan=json.loads(planned)
  require(sha(planned)==reference['planSha256']and len(plan)==len(reference['rows']),'predetermined physical schedule')
  require(reference['rows']==[prediction(p)for p in plan],'reexecuted literal pre-observation predictions')
  a=browser('gpu-'+str(seed));require(a['seed']==seed and a['fault']is None and a['referenceFile']['sha256']==sha(raw)and a['planSha256']==sha(planned)and len(a['probes'])==len(plan),'exact browser input schedule')
  checker=report('capture-'+str(seed)+'.json');require(checker['sourceReportSha256']==records['gpu-'+str(seed)+'/report.json']['sha256']and checker['seed']==seed and checker['fault']is None and checker['checkedPixels']==a['checkedPixels'],'complete pixel-check binding');source('tools/virgl-fragment-discard/capture-check.py',checker['sourceSha256'])
  require(all(row['failureCount']==0 for row in checker['rows']),'all normative pixels')
  direct_pixels+=a['directPixels'];consumer_pixels+=a['consumerPixels'];qualifications+=checker['qualifications']
  for p,wanted in zip(a['probes'],plan):
   require(all(p[k]==v for k,v in wanted.items())and p['mutation']is None,'unchanged literal source and geometry')
   witness=next(c['primary']for c in primary if c['text']==wanted['text']);require(p['primary']==witness,'unmodified pinned comparison shader')
  require(len(a['consumers'])==2,'both execution modes')
  for c in a['consumers']:require(c['commandsPerStep']==1+seed%3 and len(c['captures'])==18 and len(c['rejections'])==10,'varied complete consumer schedule')
 for fault in ['inhibit','invert','x-only','unconditional']:
  a=browser('fault-'+fault,passed=False);checker=report('capture-fault-'+fault+'.json');require(checker['sourceReportSha256']==records['fault-'+fault+'/report.json']['sha256']and checker['fault']==fault and len(checker['faults'])==1,'fault checker binding')
  require('independent discard pixel mismatch'in a['failure']['message']and len([p for p in a['probes']if p['mutation']])==1 and any(row['failureCount']for row in checker['rows']),'actual source fault contradicted physical pixels');faults.extend(checker['faults'])
 paths=subprocess.check_output(['git','ls-files','renderer/virgl-shader','renderer/virgl-command','tools/virgl-fragment-discard','tools/virgl-fragment-coordinates','tools/virgl-power','tools/virgl-sine','tools/virgl-exponent-logarithm','tools/virgl-saturation','tools/virgl-precise-fraction','tools/virgl-compiler-bounds/retained.mjs','tools/lib/virgl-browser-runner.mjs','tools/verify-virgl-fragment-discard.sh','tools/setup-virgl-emsdk.sh','Makefile','web/package-lock.json'],cwd=ROOT,text=True).splitlines()
 for name in paths:source(name)
 for name in ['native/virgl-shader','wasm/virgl-shader.mjs','wasm/virgl-shader.wasm']:source('renderer/virgl-shader/build/'+name)
 for f in sorted(directory.rglob('*')):
  if f.is_file()and f.name not in ['receipt.json','acceptance.log']:artifact(str(f.relative_to(directory)))
 result=dict(schema='virgl-fragment-discard-receipt-v1',task=TASK,status='passed',gitHead=head,guestExecution=False,productionNegotiation=False,nativeCases=len(expected),wasmCases=len(expected),wasmPairs=len(expected),primaryComparisons=len(primary),legacyCases=len(legacy['cases']),legacyExtensions=2,metadataAttacks=len(consumer['forgeries']),ownedBanks=5,combinedBases=4,seeds=SEEDS,directPixels=direct_pixels,consumerPixels=consumer_pixels,checkedPixels=direct_pixels+consumer_pixels,qualifiedPrimaryPixels=qualifications,physicalOutputFaults=faults,sources=list(sources.values()),records=list(records.values()))
 (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(f'{TASK} receipt passed: {result["checkedPixels"]} literal physical pixels')
if __name__=='__main__':main()
