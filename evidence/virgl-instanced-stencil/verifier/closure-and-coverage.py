#!/usr/bin/env python3
import hashlib,json,pathlib,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent;U=OUT/'unpacked'
BASE='a19b49441e932e64446f756cefe0c18e6b5b71b3';HEAD='3cbb041b43928701026b5ca2ddfb3dcf9a799c2b'
sha=lambda x:hashlib.sha256(x).hexdigest();git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT)
added={};name=None;line=0
for row in git('diff','--unified=0',BASE,HEAD,'--','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs').decode().splitlines():
 if row.startswith('+++ b/'):name=row[6:]
 elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
 elif row.startswith('+') and name:added.setdefault(name,[]).append(line);line+=1
 elif row.startswith(' '):line+=1
waivers=json.loads((ROOT/'tools/virgl-instanced-stencil/coverage-waivers.json').read_text())['waivers']
waiverkeys={(r['source'],r['startOffset'],r['endOffset']):r for r in waivers}
result={'schema':'fresh-instanced-stencil-closure-coverage-v1','status':'passed','sourceHead':HEAD,'runs':[]}
for prefix in ['hot','cold']:
 base=U/prefix;receipt=json.loads((base/'receipt.json').read_text());assert receipt['gitHead']==HEAD
 for name,digest in receipt['files'].items():assert sha((base/name).read_bytes())==digest,(prefix,name)
 for name,digest in receipt['sources'].items():assert sha(git('show',HEAD+':'+name))==digest
 for name,digest in receipt['generated'].items():
  assert sha((U/(prefix+'-generated')/name).read_bytes())==digest
  assert sha((ROOT/name).read_bytes())==digest
 scripts=[];native=[]
 for mode in receipt['reports']:
  folder=base/mode;report=json.loads((folder/'report.json').read_text());fault=mode.startswith('fault-')
  assert report['status']==('failed' if fault else 'passed') and report['gitHead']==HEAD
  served={r['path']:r for r in report['servedFiles']}
  for source in report['sources']:
   raw=(folder/'source'/source['path']).read_bytes();assert sha(raw)==source['sha256'] and len(raw)==source['bytes']
   original=(ROOT/source['path']).read_bytes() if '/build/wasm/' in source['path'] else git('show',HEAD+':'+source['path']);assert raw==original
  coverageRaw=(folder/report['browserCoverage']['path']).read_bytes();assert sha(coverageRaw)==report['browserCoverage']['sha256']
  for script in json.loads(coverageRaw)['scripts']:
   assert sha(script['sourceBody'].encode())==script['sha256']==served['/'+script['source']]['sha256']
   if script['source'] in added and not fault:scripts.append({'name':script['source'],'record':mode+'/'+report['browserCoverage']['path'],'coverage':script['coverage']})
  for k in ['browserCoverage','screenshot']:assert sha((folder/report[k]['path']).read_bytes())==report[k]['sha256']
  native.append({'mode':mode,'reportSha256':sha((folder/'report.json').read_bytes()),'passed':not fault,'browserExecutableSha256':report['browser']['sha256'],'servedNativeCompiler':served.get('/renderer/virgl-shader/build/wasm/virgl-shader.wasm',{}).get('sha256')})
 for file in sorted((base/'node-coverage').glob('coverage-*.json')):
  for script in json.loads(file.read_text())['result']:
   for name in added:
    if script['url'].endswith('/'+name):scripts.append({'name':name,'record':file.relative_to(base).as_posix(),'coverage':script})
 partitions=[]
 for name,lines in added.items():
  text=git('show',HEAD+':'+name).decode();offsets=[0]
  for row in text.splitlines(keepends=True):offsets.append(offsets[-1]+len(row.encode('utf-16-le'))//2)
  observations=[s for s in scripts if s['name']==name]
  for line in lines:
   start,end=offsets[line-1],offsets[line];bounds={start,end}
   for s in observations:
    for fn in s['coverage']['functions']:
     for r in fn['ranges']:
      bounds.update(t for t in [r['startOffset'],r['endOffset']] if start<t<end)
   bounds=sorted(bounds)
   for lo,hi in zip(bounds,bounds[1:]):
    counts=[]
    for s in observations:
     ranges=[r for fn in s['coverage']['functions'] for r in fn['ranges'] if r['startOffset']<=lo and r['endOffset']>=hi]
     if ranges:
      nearest=min(ranges,key=lambda r:r['endOffset']-r['startOffset']);counts.append({'record':s['record'],'count':nearest['count'],'governingStart':nearest['startOffset'],'governingEnd':nearest['endOffset']})
    partition={'source':name,'line':line,'startOffset':lo,'endOffset':hi,'count':max((r['count'] for r in counts),default=0),'counters':counts}
    if not partition['count']:
     w=waiverkeys.get((name,lo,hi));assert w,(prefix,partition,'unexplained zero')
     operand=text.encode('utf-16-le')[lo*2:hi*2].decode('utf-16-le');assert operand==w['text'] and sha(operand.encode())==w['sha256']
     assert w['classification']=='unchanged-operand';old=git('show',BASE+':'+name);assert sha(old)==w['predecessorSourceSha256']
     assert old.decode().encode('utf-16-le')[w['predecessorStartOffset']*2:w['predecessorEndOffset']*2].decode('utf-16-le')==operand
     assert 'instanceBase' not in operand and 'wv_instance_base' not in operand and 'applyInstance' not in operand
     partition['classification']='waived-exact-unchanged-fallback';partition['reason']=w['reason']
    else:partition['classification']='executed'
    partitions.append(partition)
 worker=json.loads((base/'coverage-audit.json').read_text());assert worker['positive']==sum(p['count']>0 for p in partitions)==344
 assert len(worker['waived'])==sum(p['count']==0 for p in partitions)==16 and worker['zero']==[]
 assert [(p['source'],p['startOffset'],p['endOffset'],p['maxCount']) for p in worker['partitions']]==[(p['source'],p['startOffset'],p['endOffset'],p['count']) for p in partitions]
 metadata=json.loads((base/'metadata/metadata.json').read_text());assert metadata['status']=='passed' and metadata['gitHead']==HEAD and len(metadata['rows'])==84
 assert all(row.get('getters',0)==0 for row in metadata['rows'])
 result['runs'].append({'prefix':prefix,'receiptSha256':sha((base/'receipt.json').read_bytes()),'sourceCount':len(receipt['sources']),'nativeReportClosures':native,'metadataCases':84,'partitions':partitions,'positive':344,'waived':16,'unexplained':0})
cold=json.loads((U/'cold/report.json').read_text());assert cold['command']==['make','verify-E6-T11d47'] and cold['exitCode']==0 and cold['statusBefore']==cold['statusAfter']=='' and cold['cloneHead']==HEAD
assert sha((U/'cold/cold.log').read_bytes())==cold['logSha256'];log=(U/'cold/cold.log').read_text()
assert 'Cloning into' in log and 'npm ci' not in log or 'added ' in log
assert 'INSTANCED_STENCIL_RECORDING_COMPLETE' in log and 'Frozen original instanced draws, bindings and native planes authenticated.' in log
result['cold']={'reportSha256':sha((U/'cold/report.json').read_bytes()),'logSha256':cold['logSha256'],'removedEnvironmentNames':cold['removedEnvironmentNames'],'command':cold['command'],'pristineBeforeAfter':True,'generatedCompilerWasReconstructed':True}
(OUT/'closure-and-coverage.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','hotPositive':344,'coldPositive':344,'eachWaived':16,'unexplained':0,'metadataCases':168,'coldPristine':True}))
