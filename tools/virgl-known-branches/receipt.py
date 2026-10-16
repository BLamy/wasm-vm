#!/usr/bin/env python3
"""Bind exact frozen sources, original profiles and full hardware recordings."""
from pathlib import Path
import hashlib,json,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
SEEDS=[608135816,2242054355,320440878]
def sha(b):return hashlib.sha256(b).hexdigest()
def require(v,label):
 if not v:raise ValueError(label)
def check_supplement(s,n):
 require(s['arithmeticPredictions']==2 and s['hostRoundingModes']==4 and s['publicSinglesPairs']==4 and len(s['nativeRegions'])==5 and len(s['v8Regions'])==2,'targeted original-source coverage')
 require(s['binary']['sha256']==n['binary']['sha256'] and all(r['region'][4]>0 for r in s['nativeRegions']) and all(r['count']>0 for r in s['v8Regions']),'matching executable and positive nested coverage')
def main():
 directory=Path(sys.argv[1]).resolve();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
 require(not subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT),'freeze tracked sources');sources={};records={}
 def source(name,digest=None):
  b=(ROOT/name).read_bytes();require(digest is None or sha(b)==digest,'source '+name)
  if not name.startswith('renderer/virgl-shader/build/'):require(b==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),'committed source '+name)
  row=dict(path=name,bytes=len(b),sha256=sha(b));require(name not in sources or sources[name]==row,'consistent source '+name);sources[name]=row
 def artifact(name,digest=None):
  b=(directory/name).read_bytes();require(digest is None or sha(b)==digest,'artifact '+name);records[name]=dict(path=name,bytes=len(b),sha256=sha(b));return b
 def report(name,passed=True):
  r=json.loads(artifact(name));require(r['gitHead']==head and r['task']=='E6-T12g6m2'and r['status']==('passed'if passed else'failed'),'exact report '+name)
  for s in r.get('sources',[]):source(s['path'],s['sha256'])
  return r
 n=report('native/report.json');w=report('wasm/report.json');c=report('consumer.json');old=report('legacy.json')
 wanted=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{getCases}from'./tools/virgl-known-branches/cases.mjs';process.stdout.write(JSON.stringify(getCases()));"],cwd=ROOT))
 require(n['seeds']==SEEDS and len(n['cases'])==len(wanted)==len(w['cases']),'whole native/Wasm schedule')
 for case,prediction,other in zip(n['cases'],wanted,w['cases']):
  require(all(case[k]==v for k,v in prediction.items())and case['textSha256']==sha(case['text'].encode()),'literal source')
  require(other['result']==case['result']and other['pair']==case['pairResult'],'full native/Wasm parity')
 require(w['nativeSha256']==c['nativeSha256']==sha((directory/'native/report.json').read_bytes()),'native lineage')
 require(n['hostRoundingModes']==4 and n['arithmeticPredictions']==2 and n['predicateStates']==8 and n['layout']==[111744,112,32448],'integer/environment/storage proof')
 artifact('native/cases.bin',n['fixtureSha256']);artifact('native/native.log',n['logSha256']);require(not artifact('native/native.stderr',n['stderrSha256']),'zero sanitizer errors');artifact('native/coverage.json',n['coverageSha256']);source(n['binary']['path'],n['binary']['sha256']);coverage=report('coverage-audit.json');require(coverage['status']=='passed' and coverage['nativeSha256']==n['coverageSha256'],'changed source coverage audit')
 require(c['getterInvocations']==0 and len(c['attacks'])>=600 and len(c['banks'])==len(c['raster'])==1,'inert owned policies')
 supplement=json.loads(artifact('inherited-supplement/report.json'));require(supplement['task']=='E6-T12g6m1' and supplement['gitHead']==head and supplement['status']=='passed','touched inherited guard')
 check_supplement(supplement,json.loads(artifact('inherited-supplement/binary.json')))
 require(len(old['cases'])==10464+len(wanted) and len(old['extensions'])==len(json.loads((ROOT/'tools/virgl-known-branches/extensions.json').read_bytes())) and old['oldPairs']==2430+len(wanted),'closed predecessor inventory')
 for p in old['predecessors']:
  for name in ['manifest.json','records.json']:source(p['path']+'/'+name)
  source(p['path']+'/'+p['manifest']['archive']['path'],p['manifest']['archive']['sha256'])
 for original in old['originalArtifacts']:artifact(original['path'],original['sha256'])
 for o in n['originals']:source(o['path'],o['sha256']);require(o['result']['ok']is False,'larger original remains gated')
 words=pixels=0;faults=[]
 for seed in SEEDS:
  b=report(f'gpu-{seed}/report.json');a=b['acceptance'];check=report(f'capture-{seed}.json')
  require(not b['trackedChanges']and not b['browser']['launch']['headless']and b['browser']['gpu']['featureStatus'][b['browser']['webglFeature']]=='enabled','frozen physical browser')
  require(b['browserErrors']==dict(console=[],page=[],requests=[])and a['objects']['live']==0 and len(a['consumers'])==2,'zero errors/disposal')
  for consumer in a['consumers']:require(all(x==0 for x in consumer['finalBudgets'].values())and all(x==0 for x in consumer['finalResourceBudgets'].values())and len(consumer['deferredBanks'])==2 and consumer['rejection']['result']['ok']is False,'owned consumer bank custody')
  require(check['sourceReportSha256']==records[f'gpu-{seed}/report.json']['sha256']and check['checkedWords']==a['checkedWords']and check['checkedPixels']==a['checkedPixels']and not check['physicalFaults'],'complete capture checker')
  artifact(f'gpu-{seed}/'+b['screenshot']['path'],b['screenshot']['sha256']);artifact(f'gpu-{seed}/'+b['browserCoverage']['path'],b['browserCoverage']['sha256'])
  for s in b['servedFiles']:source(s['path'],s['sha256'])
  words+=a['checkedWords'];pixels+=a['checkedPixels']
 for fault in ['word','control']:
  b=report('fault-'+fault+'/report.json',False);check=report('capture-fault-'+fault+'.json');require(check['sourceReportSha256']==records['fault-'+fault+'/report.json']['sha256']and check['physicalFaults'],'actual physical source fault');faults.append(dict(fault=fault,contradictions=check['physicalFaults']))
  require(b['browserErrors']==dict(console=[],page=[],requests=[])and b['acceptance']['objects']['live']==0,'clean failed physical capture');artifact('fault-'+fault+'/'+b['failureScreenshot']['path'],b['failureScreenshot']['sha256']);artifact('fault-'+fault+'/'+b['browserCoverage']['path'],b['browserCoverage']['sha256'])
 paths=subprocess.check_output(['git','ls-files','renderer/virgl-shader','renderer/virgl-command','tools/virgl-known-branches','tools/virgl-known-arithmetic/supplement.mjs','tools/virgl-known-arithmetic/supplement-cases.json','tools/lib/virgl-browser-runner.mjs','tools/verify-virgl-known-branches.sh','tools/setup-virgl-emsdk.sh','Makefile','web/package-lock.json'],cwd=ROOT,text=True).splitlines()
 for name in paths:source(name)
 for name in ['native/virgl-shader','wasm/virgl-shader.mjs','wasm/virgl-shader.wasm']:source('renderer/virgl-shader/build/'+name)
 for f in sorted(directory.rglob('*')):
  if f.is_file()and f.name not in ['receipt.json','acceptance.log']:artifact(str(f.relative_to(directory)))
 result=dict(schema='virgl-known-branches-receipt-v1',task='E6-T12g6m2',status='passed',gitHead=head,nativeCases=len(wanted),arithmeticPredictions=n['arithmeticPredictions'],seeds=SEEDS,legacyCases=len(old['cases']),legacyExtensions=len(old['extensions']),metadataAttacks=len(c['attacks']),checkedWords=words,checkedPixels=pixels,physicalOutputFaults=faults,guestExecution=False,productionNegotiation=False,sources=list(sources.values()),records=list(records.values()))
 (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(f'E6-T12g6m2 receipt passed: {words} words, {pixels} pixels')
if __name__=='__main__':main()
