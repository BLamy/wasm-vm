#!/usr/bin/env python3
"""Bind exact frozen sources, original profiles and full hardware recordings."""
from pathlib import Path
import hashlib,json,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
SEEDS=[1779033703,3144134277,1013904242]
def sha(b):return hashlib.sha256(b).hexdigest()
def require(v,label):
 if not v:raise ValueError(label)
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
  r=json.loads(artifact(name));require(r['gitHead']==head and r['task']=='E6-T12g6m1'and r['status']==('passed'if passed else'failed'),'exact report '+name)
  for s in r.get('sources',[]):source(s['path'],s['sha256'])
  return r
 n=report('native/report.json');w=report('wasm/report.json');c=report('consumer.json');old=report('legacy.json')
 wanted=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{getCases}from'./tools/virgl-known-arithmetic/cases.mjs';process.stdout.write(JSON.stringify(getCases()));"],cwd=ROOT))
 require(n['seeds']==SEEDS and len(n['cases'])==len(wanted)==len(w['cases']),'whole native/Wasm schedule')
 for case,prediction,other in zip(n['cases'],wanted,w['cases']):
  require(all(case[k]==v for k,v in prediction.items())and case['textSha256']==sha(case['text'].encode()),'literal source')
  require(other['result']==case['result']and other['pair']==case['pairResult'],'full native/Wasm parity')
 require(w['nativeSha256']==c['nativeSha256']==sha((directory/'native/report.json').read_bytes()),'native lineage')
 require(n['hostRoundingModes']==4 and n['arithmeticPredictions']==11608 and n['layout'][:2]==[111744,112],'integer/environment/storage proof')
 artifact('native/cases.bin',n['fixtureSha256']);artifact('native/native.log',n['logSha256']);require(not artifact('native/native.stderr',n['stderrSha256']),'zero sanitizer errors');artifact('native/coverage.json',n['coverageSha256']);source(n['binary']['path'],n['binary']['sha256'])
 require(c['getterInvocations']==0 and len(c['attacks'])>=100 and len(c['banks'])==1,'inert owned policies')
 require(len(old['cases'])==10041 and len(old['extensions'])==5,'closed predecessor inventory')
 for p in old['predecessors']:
  for name in ['manifest.json','records.json']:source(p['path']+'/'+name)
  source(p['path']+'/'+p['manifest']['archive']['path'],p['manifest']['archive']['sha256'])
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
 for fault in ['word','shadow']:
  b=report('fault-'+fault+'/report.json',False);check=report('capture-fault-'+fault+'.json');require(check['sourceReportSha256']==records['fault-'+fault+'/report.json']['sha256']and check['physicalFaults'],'actual physical source fault');faults.append(dict(fault=fault,contradictions=check['physicalFaults']))
  require(b['browserErrors']==dict(console=[],page=[],requests=[])and b['acceptance']['objects']['live']==0,'clean failed physical capture');artifact('fault-'+fault+'/'+b['failureScreenshot']['path'],b['failureScreenshot']['sha256']);artifact('fault-'+fault+'/'+b['browserCoverage']['path'],b['browserCoverage']['sha256'])
 paths=subprocess.check_output(['git','ls-files','renderer/virgl-shader','renderer/virgl-command','tools/virgl-known-arithmetic','tools/virgl-precise-arithmetic/oracle.mjs','tools/lib/virgl-browser-runner.mjs','tools/verify-virgl-known-arithmetic.sh','tools/setup-virgl-emsdk.sh','Makefile','web/package-lock.json'],cwd=ROOT,text=True).splitlines()
 for name in paths:source(name)
 for name in ['native/virgl-shader','wasm/virgl-shader.mjs','wasm/virgl-shader.wasm']:source('renderer/virgl-shader/build/'+name)
 for f in sorted(directory.rglob('*')):
  if f.is_file()and f.name not in ['receipt.json','acceptance.log']:artifact(str(f.relative_to(directory)))
 result=dict(schema='virgl-known-arithmetic-receipt-v1',task='E6-T12g6m1',status='passed',gitHead=head,nativeCases=len(wanted),arithmeticPredictions=n['arithmeticPredictions'],seeds=SEEDS,legacyCases=10041,legacyExtensions=5,metadataAttacks=len(c['attacks']),checkedWords=words,checkedPixels=pixels,physicalOutputFaults=faults,guestExecution=False,productionNegotiation=False,sources=list(sources.values()),records=list(records.values()))
 (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(f'E6-T12g6m1 receipt passed: {words} words, {pixels} pixels')
if __name__=='__main__':main()
