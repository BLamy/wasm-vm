#!/usr/bin/env python3
"""Reconstruct complete APIs, original inputs, GPU source and every observation."""
import json,struct,subprocess,sys
from pathlib import Path
from shared import ROOT,MANIFEST,binding,head,inventory,pair_metadata,read,require,same,sha,source
from native import attacks
def physical_word(word):return struct.unpack('<f',struct.pack('<I',word))[0]
def distance(a,b):
 if physical_word(a)==physical_word(b):return 0
 key=lambda x:0x80000000-(x&0x7fffffff) if x>>31 else 0x80000000+x
 return abs(key(a)-key(b))
def ints(value,length,maximum=0xffffffff):
 require(type(value) is list and len(value)==length and all(type(x) is int and 0<=x<=maximum for x in value),'complete typed physical array')
def outcome(result):
 require(type(result) is dict and type(result.get('ok')) is bool,'typed actual API result')
 stages=[result['vertex'],result['fragment']] if 'vertex' in result else [result]
 if result['ok']:
  for stage in stages:require(type(stage['glsl']) is str and len(stage['glsl'].encode())<=65536 and stage['glsl'].startswith('#version 300 es'),'bounded actual GLSL')
 else:require(set(result)=={'ok','error'} and set(result['error'])=={'code','message'} and type(result['error']['message']) is str and 0<len(result['error']['message'])<=512,'bounded rejection without fallback')
def native(out,frozen):
 directory=out/'native';r=read(directory/'report.json');manifest,originals,pairs=inventory();negative=attacks(originals)
 require(r['schema']=='original-corpus-native-v1' and r['status']=='passed' and r['gitHead']==frozen,'frozen native identity')
 require(same(r['manifest'],binding(MANIFEST)),'exact corpus manifest')
 for item in r['sources']+[r['binary']]:source(item,frozen)
 for key in ('input','log','profile'):require(same(binding(directory/r[key]['path'],directory),r[key]),'native actual '+key)
 stream=bytearray(b'VGC6'+struct.pack('<I',19))
 for e in originals:raw=e['text'].encode();stream+=struct.pack('<II',int(e['stage']=='fragment'),len(raw))+raw
 stream+=struct.pack('<I',len(negative))
 for e in negative:raw=e['text'].encode();stream+=struct.pack('<II',int(e['stage']=='fragment'),len(raw))+raw
 require((directory/'input.bin').read_bytes()==stream,'entire bounded native input reconstructed')
 transcript={'ORIGINAL':[],'PAIR':[],'ATTACK':[]};recoveries=[];rounds=[];stats=[]
 for line in (directory/'native.log').read_text().splitlines():
  kind=line.split(' ',1)[0]
  require('AddressSanitizer' not in line and 'runtime error:' not in line,'sanitizers remain quiet')
  if kind in transcript:
   _,index,body=line.split(' ',2);require(int(index)==len(transcript[kind]),'ordered complete native results');transcript[kind].append(json.loads(body))
  elif kind=='RECOVERY':recoveries.append([int(x) for x in line.split()[1:]])
  elif kind=='ROUND':rounds.append(int(line.split()[1]))
  elif kind=='STATS':stats.append(json.loads(line.split(' ',1)[1]))
 require([len(transcript[k]) for k in transcript]==[19,88,len(negative)] and recoveries==[[i,i%19,i%88] for i in range(len(negative))] and rounds==list(range(8)),'complete native execution schedule')
 require(len(r['originals'])==19 and len(r['pairs'])==88 and len(r['attacks'])==len(negative),'complete recorded API input inventory')
 by_hash={e['sha256']:e for e in originals}
 for expected,record,result in zip(originals,r['originals'],transcript['ORIGINAL']):
  require(same(expected,{k:v for k,v in record.items() if k!='result'}) and same(result,record['result']),'original result source and transcript');outcome(result);require(result['ok'] and same(result['metadata'],expected['metadata']),'explicit original metadata')
 for expected,record,result in zip(pairs,r['pairs'],transcript['PAIR']):
  require(same(expected,{k:v for k,v in record.items() if k!='result'}) and same(result,record['result']),'pair input and transcript');outcome(result);require(result['ok']==expected['ok'],'literal interface partition')
  if result['ok']:
   v,f=by_hash[record['vertex']],by_hash[record['fragment']]
   require(same(result['vertex']['metadata'],pair_metadata(v,f)) and same(result['fragment']['metadata'],f['metadata']),'combined pair contracts and consumer interpolation')
   key='generic-interpolation-v1:'+';'.join(f'g{i["semanticIndex"]}/{i["componentMask"]}/{i["interpolation"]}' for i in f['metadata']['inputs'])
   require(result['interfaceKey']==key,'literal original interface key')
 for expected,record,result in zip(negative,r['attacks'],transcript['ATTACK']):
  require(same(expected,{k:v for k,v in record.items() if k!='result'}) and same(result,record['result']),'entire hostile input transcript');outcome(result)
  if expected['reject']:require(not result['ok'],'required rejection')
  if 'admittedMetadata' in expected:require(result['ok'] and same(result['metadata'],expected['admittedMetadata']),'explicit historical admission')
 expected_stats=dict(originals=19,pairs=88,attacks=len(negative),calls=107+3*len(negative)+8*107,recoveries=2*len(negative)+8*107,rounds=8)
 require(same(r['stats'],expected_stats) and stats==[expected_stats],'all native recovery calls')
 return r
def wasm(out,frozen,native):
 directory=out/'wasm';r=read(directory/'report.json');require(r['schema']=='original-corpus-wasm-v1' and r['status']=='passed' and r['gitHead']==frozen and r['nativeSha256']==sha((out/'native/report.json').read_bytes()),'frozen linked Wasm recording')
 for item in r['sources']:source(item,frozen)
 require(same(binding(directory/r['log']['path'],directory),r['log']),'full Wasm log digest');records=[json.loads(x) for x in (directory/'calls.jsonl').read_text().splitlines()]
 schedule=[]
 single=lambda e,kind:schedule.append((kind,e['sha256'],e['result']))
 pair=lambda e,kind:schedule.append((kind,e['vertex']+'/'+e['fragment'],e['result']))
 for e in native['originals']:single(e,'original')
 for e in native['pairs']:pair(e,'pair')
 for i,e in enumerate(native['attacks']):schedule.append(('attack',e['name'],e['result']));single(native['originals'][i%19],'recovery-single');pair(native['pairs'][i%88],'recovery-pair')
 for _ in range(8):
  for e in native['originals']:single(e,'repeat-single')
  for e in native['pairs']:pair(e,'repeat-pair')
 for e in native['originals']:single(e,'owned-single');single(native['originals'][0],'overwrite')
 for e in native['pairs']:
  if e['ok']:pair(e,'owned-pair');pair(native['pairs'][0],'overwrite-pair')
 require(type(r['calls']) is int and len(records)==len(schedule)==r['calls'],'every Wasm call recorded')
 for i,(record,(kind,name,result)) in enumerate(zip(records,schedule)):require(same(record,dict(index=i,kind=kind,name=name,result=result)),'full native/Wasm API equality at call '+str(i))
 require(same(r['memory'],dict(initialBytes=16777216,finalBytes=16777216,sameBuffer=True)) and len(r['ownership'])==76,'fixed-memory owned responses')
 return r
def envelope(directory,frozen,task='E6-T12f6',fault=None):
 r=read(directory/'report.json');require(r['task']==task and r['gitHead']==frozen and r['status']==('failed' if fault else 'passed'),'exact browser task/source/outcome')
 require(r['guestExecution'] is False and r['trackedChanges']==[],'isolated frozen browser')
 if task!='E6-T10a':require(r['currentGuest3dAdvertisement'] is False,'guest GPU remains disabled')
 require(same(r['browserErrors'],dict(console=[],page=[],requests=[])),'zero browser errors')
 seen={};allowed=str((directory.parent/'fault.wasm').relative_to(ROOT)) if fault else None
 for e in r['sources']:
  if e['path'] in seen:require(same(e,seen[e['path']]),'duplicate browser source agrees')
  seen[e['path']]=e
  if e['path']==allowed:require(e['size']==fault['wasm']['bytes'] and e['sha256']==fault['wasm']['sha256'],'compiled fault actually served')
  else:source(dict(path=e['path'],bytes=e['size'],sha256=e['sha256']),frozen)
 for e in r['servedFiles']:require(e['path'] in seen and same(e,seen[e['path']]),'served actual recorded source')
 require(r['browser']['launch']['headless'] is False and r['browser']['gpu']['featureStatus'][r['browser']['webglFeature']]=='enabled','physical hardware Chrome')
 a=r['acceptance'];require(a['guestExecution'] is False and not any(x in a['renderer']['renderer'].lower() for x in ('swiftshader','llvmpipe','softpipe','software','mock','fake')),'actual hardware renderer')
 photo=r['failureScreenshot'] if fault else r['screenshot'];require(sha((directory/photo['path']).read_bytes())==photo['sha256'],'actual screenshot')
 if 'browserCoverage' in r:
  cov=r['browserCoverage'];raw=(directory/cov['path']).read_bytes();require(sha(raw)==cov['sha256'],'V8 counter digest')
  for e in json.loads(raw)['scripts']:require(e['source'] in seen and e['sha256']==seen[e['source']]['sha256'],'V8 source binding')
 return r
def reference(out,seed=None):
 name='reference.json' if seed is None else f'reference-{seed}.json';r=read(out/name);fresh=json.loads(subprocess.check_output(['node','tools/virgl-original-corpus/reference.mjs',*([str(seed)] if seed is not None else [])],cwd=ROOT));require(same(r,fresh),'independent literal/equation predictions reconstructed');return r
def physical(out,frozen,native,reference,fault=None):
 r=envelope(out,frozen,fault=fault);a=r['acceptance'];require(a['schema']=='original-corpus-gpu-v1' and a['seed']==reference['seed'] and same(a['manifest'],binding(MANIFEST)),'actual original GPU fixture and seed')
 healthy={e['sha256']:e for e in native['originals']};pairs={(e['vertex'],e['fragment']):e for e in native['pairs']}
 require({e['sha256'] for e in a['originals']}==set(healthy) and [(e['vertex'],e['fragment']) for e in a['pairs']]==list(pairs),'no original or pairing omission/substitution')
 def faulted(result):
  result=json.loads(json.dumps(result))
  if fault and result['ok']:
   for stage in ([result['vertex'],result['fragment']] if 'vertex' in result else [result]):stage['glsl']=stage['glsl'].replace(fault['before'],fault['after'])
  return result
 require(len(a['originals'])==19 and len(a['pairs'])==88,'all original GPU API inputs')
 for e in a['originals']:require(same(e,dict(healthy[e['sha256']],result=faulted(healthy[e['sha256']]['result']))),'entire native/Wasm original GPU equality')
 for e in a['pairs']:
  expected=pairs[(e['vertex'],e['fragment'])];require(same({k:v for k,v in e.items() if k!='logs'},dict(expected,result=faulted(expected['result']))),'entire native/Wasm GPU pair equality')
 sources=[stage['glsl'] for e in a['pairs'] if e['ok'] for stage in (e['result']['vertex'],e['result']['fragment'])]
 migrations=read(ROOT/'renderer/virgl-shader/tests/captured-grammar-migrations.json')['migrations']
 if not fault:
  require(len(a['migrations'])==4,'all explicit historical admissions physically executed')
  for m,expected in zip(a['migrations'],migrations):
   require(same(m['entry'],expected) and sha(m['text'].encode())==expected['inputSha256'],'exact migration bytes and contract');sources += [m['result'][key]['glsl'] for key in ('vertex','fragment')]
   prediction=next(e for e in reference['migrations'] if e['inputSha256']==expected['inputSha256']);require(len(m['probe']['vectors'])==32,'all historical identity probes')
   for x,p in zip(m['probe']['vectors'],prediction['vectors']):
    require(same(x['vector'],p['vector']) and same(x['expected'],p['expected']),'literal historical identity prediction');ints(x['observed'],4);ints(x['bytes'],16,255)
    require(bytes(x['bytes'])==struct.pack('<4I',*x['observed']) and sha(bytes(x['bytes']))==x['sha256'],'historical actual feedback bytes')
    require(all(distance(observed,wanted)==0 for observed,wanted in zip(x['observed'],p['expected']['position'])),'historical visible position identity')
 for event in a['events']:
  if event['call']=='shaderSource':require(event['source'] in sources,'only exact original emitted GLSL used on GPU')
  if event['call'] in ('compileShader','linkProgram'):require(event['status'] is True,'actual original shader compile/link')
 predicted={e['sha256']:e for e in reference['originals']};words=pixels=0
 require(len(a['vertices'])==(1 if fault else 8) and len(a['fragments'])==(0 if fault else 11),'complete original physical paths')
 for v in a['vertices']:
  vectors=predicted[v['sha256']]['vectors'];require(len(v['vectors'])==(1 if fault else len(vectors)),'all original vertex equations')
  for x,p in zip(v['vectors'],vectors):
   require(same(x['vector'],p['vector']) and same(x['expected'],p['expected']),'independent vertex prediction precedes GPU');expected=p['expected'];length=8 if expected.get('generic') is not None else 4;ints(x['observed'],length);ints(x['bytes'],length*4,255)
   require(bytes(x['bytes'])==struct.pack('<'+'I'*length,*x['observed']) and sha(bytes(x['bytes']))==x['sha256'],'actual full vertex feedback bytes')
   checks=[]
   for lane,observed in enumerate(x['observed']):
    if lane>=4 and not expected['definedGenericMask']&(1<<(lane-4)):continue
    wanted=expected['position'][lane] if lane<4 else expected['generic'][lane-4];budget=expected['positionUlpBudget'] if lane<4 else expected['genericUlpBudget'];check=dict(lane=lane,expected=wanted,actual=observed,ulp=distance(observed,wanted),budget=budget);checks.append(check)
    if fault and check['ulp']>budget:require(same(x['failure'],check) and lane==4 and same(fault['point'],check),'literal actual source-fault contradiction');break
    require(check['ulp']<=budget,'independent original written lane');words+=1
   require(same(x['checks'],checks),'every defined vertex word checked')
 for f in a['fragments']:
  vectors=predicted[f['sha256']]['vectors'];require(len(f['draws'])==len(vectors),'all original fragment input paths')
  for x,p in zip(f['draws'],vectors):
   require(same(x['vector'],p),'independent original fragment inputs/reference');raw=x['rgbaBytes'];ints(raw,4096,255);require(sha(bytes(raw))==x['rgbaSha256'] and type(x['checkedPixels']) is int and x['checkedPixels']==1024,'all actual original pixels retained')
   require(all(abs(value-p['expected'][i%4])<=p['pixelBudget'] for i,value in enumerate(raw)),'every independent original pixel');pixels+=1024
   for upload in x['uploads']:require(upload['approved']['ok'] is True and upload['observed']==upload['approved']['words'][:upload['activeCount']*4],'actual approved original uniform readback')
 require(a['objects']['live']==0,'all actual GPU objects disposed')
 if fault:require(a['status']=='failed' and 'independent original vertex mismatch' in a['failure']['message'] and a['faultWasmSha256']==fault['wasm']['sha256'],'compiled semantic fault independently refuted')
 else:require((words,pixels)==(1536,155648) and (a['checkedVertexWords'],a['checkedPixels'])==(words,pixels),'complete physical original accounting')
 return dict(status='refuted-source-fault' if fault else 'passed',vertexWords=words,pixels=pixels,linkedPairs=57)
def main():
 out=Path(sys.argv[1]).resolve();frozen=head();toolchain=read(out/'toolchain.json');require('4.0.22' in toolchain['emccVersion'] and len(toolchain['tools'])==6,'pinned recorded Emscripten/native toolchain')
 for item in toolchain['tools']:require(same(binding(Path('/')/item['path'],Path('/')),item),'actual compiler/linker tool bytes')
 n=native(out,frozen);w=wasm(out,frozen,n);ref=reference(out);gpu=physical(out/'gpu',frozen,n,ref);chaos={str(seed):physical(out/f'gpu-{seed}',frozen,n,reference(out,seed)) for seed in (0x19ab8371,0x93d6fe01)}
 consumer=read(out/'consumer.json');fresh=json.loads(subprocess.check_output(['node','tools/virgl-original-corpus/consumer.mjs'],cwd=ROOT));require(same(consumer,fresh) and consumer['status']=='passed' and consumer['getters']==0 and len(consumer['contracts'])==19,'closed original admission checks and ownership')
 fault=read(out/'fault/manifest.json');source(fault['original'],frozen);text=(ROOT/fault['original']['path']).read_text();require(text.count(fault['before'])==1 and (out/'fault'/fault['fault']['path']).read_text()==text.replace(fault['before'],fault['after']),'actual isolated exercised source mutation')
 for key in ('fault','wasm','buildLog','browserReport'):require(same(binding(out/'fault'/fault[key]['path'],out/'fault'),fault[key]),'actual compiled fault artifact')
 sabotage=physical(out/'fault/gpu',frozen,n,ref,fault)
 retained={}
 for name,task in [('literal','E6-T10a'),('scene','E6-T10d'),('mask','E6-T12f4a'),('precise','E6-T12f4'),('equality','E6-T12f1'),('selected','E6-T12f2'),('radial','E6-T12f3'),('raster','E6-T12f4b'),('arithmetic','E6-T12f5')]:
  r=envelope(out/('retained-'+name),frozen,task);a=r['acceptance'];retained[name]=dict(status=r['status'],pixels=a.get('checkedPixels'),words=a.get('checkedWords'))
  if name=='literal':require(a['checkedPixels']==4336 and len(a['draws'])==9,'retained literal leaf')
  if name=='scene':
   require(a['checkedPixels']==768 and len(a['draws'])==3 and a['grammarAttacks']['rejections']==972 and a['grammarAttacks']['admissions']==36 and a['grammarAttacks']['recoveries']==1792,'original scene and explicit grammar migration accounting')
   migration=ROOT/'renderer/virgl-shader/tests/captured-grammar-migrations.json';require(a['grammarAttacks']['migrationSha256']==sha(migration.read_bytes()),'scene migration ledger')
 records=[binding(p,out) for p in sorted(out.rglob('*')) if p.is_file() and p.name not in ('receipt.json','acceptance.log') and '__pycache__' not in p.parts]
 receipt=dict(schema='original-corpus-receipt-v1',task='E6-T12f6',status='passed',gitHead=frozen,guestExecution=False,currentGuest3dAdvertisement=False,originals=19,compatiblePairs=57,incompatiblePairs=31,nativeStats=n['stats'],wasmCalls=w['calls'],gpu=gpu,chaos=chaos,sabotage=sabotage,consumer={k:len(consumer[k]) for k in ('contracts','forgeries','banks','ownership')},retained=retained,records=records)
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({k:receipt[k] for k in ('status','task','originals','compatiblePairs','gpu','nativeStats','wasmCalls')}))
if __name__=='__main__':main()
