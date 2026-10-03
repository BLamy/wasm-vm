#!/usr/bin/env python3
"""Exact-source recorded native/Wasm/GPU submission; predecessors stay immutable."""
import json
from pathlib import Path
import struct
import subprocess
import sys
from shared import ROOT,require,sha,read,binding,source,same,git
import native_receipt
import wasm_receipt
import faults

def browser_envelope(directory,head,base,fault):
 directory=Path(directory);r=read(directory/'report.json')
 require(r['task']=='E6-T12f1' and r['gitHead']==head and r['status']=='failed' and r['guestExecution'] is False and r['currentGuest3dAdvertisement'] is False,'exact isolated fault browser identity')
 require(r['trackedChanges']==[] and same(r['browserErrors'],{'console':[],'page':[],'requests':[]}),'frozen fault source and error-free browser')
 sources={e['path']:e for e in r['sources']};served={e['path']:e for e in r['servedFiles']}
 for item in sources.values():base.verify_source(item,head)
 matches=[]
 for name,item in served.items():
  require(type(item['size']) is int and item['size']>=0,'typed actual browser bytes')
  if name in sources:require(same(item,sources[name]),'fault browser unchanged support source')
  else:
   require(item['sha256']==fault['wasm']['sha256'] and item['size']==fault['wasm']['bytes'] and name.endswith('/'+fault['wasm']['path']),'only sealed actual compiler fault bytes may differ');matches.append(name)
 require(len(matches)==1 and r['acceptance']['faultWasmSha256']==fault['wasm']['sha256'],'browser consumed one actual source-fault Wasm artifact')
 require(r['browser']['gpu']['featureStatus'][r['browser']['webglFeature']]=='enabled','actual hardware WebGL')
 qualified={'browserVersion':r['browser']['version'],**{k:r['host'][k] for k in ('platform','architecture','release')},'renderer':r['acceptance']['renderer']['renderer']}
 require(qualified in read(ROOT/'docs/gpu-3d-contract.json')['browserMatrix']['qualified'],'qualified real browser/driver')
 photo=r['failureScreenshot'];raw=(directory/photo['path']).read_bytes();require(raw.startswith(b'\x89PNG') and sha(raw)==photo['sha256'],'actual recorded fault screenshot')
 coverage=r['browserCoverage'];raw=(directory/coverage['path']).read_bytes();require(sha(raw)==coverage['sha256'],'exact actual fault V8 coverage')
 exported=json.loads(raw);require(set(exported)=={'schema','scripts'} and type(exported['schema']) is int and exported['schema']==1 and type(exported['scripts']) is list,'closed fault V8 coverage inventory')
 for script in exported['scripts']:
  require(set(script)=={'source','sha256','coverage'} and type(script['coverage']) is dict and set(script['coverage'])=={'scriptId','url','functions'},'closed recorded script coverage')
  require(script['source'] in served and script['sha256']==served[script['source']]['sha256'],'coverage describes actual served runtime')
  require(type(script['coverage']['functions']) is list and script['coverage']['functions'],'recorded fault V8 function counters')
  for function in script['coverage']['functions']:
   require(set(function)=={'functionName','ranges','isBlockCoverage'} and type(function['functionName']) is str and type(function['isBlockCoverage']) is bool and type(function['ranges']) is list and function['ranges'],'closed recorded function coverage')
   for region in function['ranges']:require(set(region)=={'startOffset','endOffset','count'} and all(type(region[k]) is int and region[k]>=0 for k in ('startOffset','endOffset','count')) and region['endOffset']>=region['startOffset'],'typed V8 offsets and actual counters')
 return r


def verify(output,head):
 output=Path(output).resolve();n=native_receipt.verify(output/'native',head);w=wasm_receipt.verify(output/'wasm',head,n)
 fixtures=read(ROOT/'renderer/virgl-shader/tests/raw-equality-cases.json');migrations=read(ROOT/'renderer/virgl-shader/tests/raw-equality-migrations.json')
 current={prefix+e['name']:e for label,_,_,_ in native_receipt.producer.GROUPS for prefix in (label+'::',) for e in n[label+'Cases']};current.update({e['name']:e for e in n['cases']})
 current_pairs={prefix+e['name']:e for label,_,_,_ in native_receipt.producer.GROUPS for prefix in (label+'::',) for e in n[label+'Pairs']};current_pairs.update({e['name']:e for e in n['pairs']})
 # Invoke the unchanged historical GPU word/finite-selection/pixel validators;
 # never invoke their obsolete negative translation expectations.
 base=native_receipt.load('equality_browser_envelope','tools/virgl-constants/receipt.py')
 retained=[]
 for label,slug,stem in [('integer','integer-masks','integer-mask'),('float','float-masks','float-mask')]:
  directory=output/label;r=base.verify_browser(directory,head,read(ROOT/'docs/gpu-3d-contract.json'),task='E6-T12f1');p=r['acceptance'];h=read(ROOT/f'renderer/virgl-shader/tests/{stem}-hardware.json');gate=native_receipt.load('equality_'+label+'_gpu',f'tools/virgl-{slug}/receipt.py')
  cases={e['name']:e for e in n[label+'Cases']};pairs={e['name']:e for e in n[label+'Pairs']}
  for e in p['cases']+p['anchors']:require(same(e['result'],cases[e['name']]['result']),'full current successor Wasm result')
  for e in p['pairs']:require(same(e['result'],pairs[e['name']]['result']),'unchanged retained current pair result')
  require(len(p['cases'])==len(read(ROOT/f'renderer/virgl-shader/tests/{stem}-cases.json')) and len(p['corpus'])==19 and sum(e['result']['ok'] for e in p['corpus'])==12,'whole authored and original corpus')
  for e in p['corpus']:require(same(e['result'],next(old['result'] for old in n['originals'] if old['sha256']==e['sha256'])),'full original Wasm results')
  require(same(p['expectationMigrations']['entries'],[e for e in migrations['entries'] if e['group']==label+'Cases']) and p['expectationMigrations']['predecessorFullGateClaimed'] is False,'explicit exact four leaf expectation migrations')
  # The copied hardware probe region precedes the wrapper and pressure harness.
  original=(ROOT/f'renderer/virgl-shader/tests/{slug}.mjs').read_text();successor=(ROOT/f'renderer/virgl-shader/tests/{slug}-equality-successor.mjs').read_text()
  require(original[:original.index('function pressureProof(')]==successor[:successor.index('async function sabotageOperation')],'retained GPU probes and independent oracles byte-exact')
  gate.verify_finite(p,h,cases);pixels=gate.verify_gpu(p,h,cases,pairs);retained.append(dict(suite=slug,words=p['checkedWords'],interpolationPixels=pixels,report=binding(directory/'report.json',output)))
 primary=base.verify_browser(output/'gpu',head,read(ROOT/'docs/gpu-3d-contract.json'),task='E6-T12f1');p=primary['acceptance'];require(p['schema']=='raw-equality-gpu-v1' and p['status']=='passed' and p['fault'] is None and p['predecessorFullGateClaimed'] is False,'current positive GPU run')
 for e in p['translations']:require(same(e['result'],(current_pairs if e['name'].endswith('-pair') else current)[e['name'] if e['name'] in current or e['name'] in current_pairs else 'float::'+e['name']]['result']),'all actual GPU compiler results equal native stages/pairs')
 reference_raw=subprocess.check_output(['node','tools/virgl-raw-equality/oracle.mjs'],cwd=ROOT);reference=json.loads(reference_raw);require((output/'oracle.json').read_bytes()==reference_raw,'literal TGSI reference independent of GPU report')
 kernels={e['case']:e for e in fixtures['kernels']};checked=0
 for stage,key in [('vertex','vertexProbes'),('fragment','fragmentProbes')]:
  expected_names=[e['case'] for e in fixtures['kernels'] if e['stage']==stage];require([e['oracle'] for e in p[key]]==expected_names,'every current kernel in both hardware stages')
  for probe in p[key]:
   kernel=kernels[probe['oracle']];vectors=fixtures['finiteVectors'] if kernel['vectorSet']=='finite' else fixtures['vectors'];require([v['name'] for v in probe['vectors']]==[v['name'] for v in vectors],'all independent literal vectors')
   for observed,literal in zip(probe['vectors'],vectors):
    expected=reference[kernel['case']][literal['name']];require(all(same(observed[k],literal[k]) for k in ('a','b','c')) and same(observed['expectedWords'],expected) and same(observed['observedWords'],expected),'whole independently classified GPU words')
    words=observed['upload']['words'];require(type(words) is list and all(type(x) is int and 0<=x<=0xffffffff for x in words),'typed actual raw upload')
    require(same(words[:4],literal['a']) and same(words[172:176],literal['c']),'actual owned full-word upload')
    if len(words)==184:require(same(words[180:184],literal['b']),'actual high-bank operand')
    reconstructed=[0]*4
    if stage=='vertex':
     require([d['selector'] for d in observed['captures']]==[0,8,16,24],'four captured bytes per word')
     for d in observed['captures']:
      raw=bytes(d['rawBytes']);physical=list(struct.unpack('<8I',raw));wanted=[0,0,0,0x3f800000]+[0x3f000000+(((x>>d['selector'])&255)<<15) for x in expected]
      require(same(physical,wanted) and same(d['observedBits'],physical) and sha(raw)==d['bytesSha256'],'exact physical transform feedback bits')
      for i,value in enumerate(physical[4:]):reconstructed[i]|=((value-0x3f000000)>>15)<<d['selector']
    else:
     require([d['selector'] for d in observed['draws']]==list(range(32)),'all32 independent rendered bit planes')
     for d in observed['draws']:
      wanted=[((x>>d['selector'])&1)*255 for x in expected];require(same(d['observedBytes'],wanted) and all(type(v) is int for v in d['observedBytes']),'actual physical fragment pixels')
      for i,value in enumerate(d['observedBytes']):reconstructed[i]|=(value//255)<<d['selector']
    require(same(reconstructed,expected),'full reconstructed uint words');checked+=4
 require(checked==p['checkedWords']==640 and len(p['migratedProbes'])==8,'complete current equality hardware word matrix and eight migrated bodies')
 for record,entry in zip(p['migratedProbes'],migrations['entries']):
  require(all(same(record[k],entry[k]) for k in entry) and record['textSha256']==entry['inputSha256'] and same(record['result'],current[entry['group'].replace('Cases','')+'::'+entry['name']]['result']),'exact unchanged historical migrated body and full current result')
  require(len(record['draws'])==len(fixtures['vectors']),'all migrations actually rendered')
  for d in record['draws']:
   # Independently classify encodings without converting any NaN/subnormal.
   a,b=d['words'][:4],d['words'][180:184];mask=[]
   for x,y in zip(a,b):
    xe,ye=(x>>23)&255,(y>>23)&255;xf,yf=x&0x7fffff,y&0x7fffff
    unordered=(xe==255 and xf!=0) or (ye==255 and yf!=0);zero=xe==ye==xf==yf==0;equal=(not unordered) and (zero or x==y);mask.append(0xffffffff if (equal if 'FSEQ' in entry['name'] else not equal) else 0)
   require(same(d['masks'],mask),'independent migration IEEE classification')
   if entry['stage']=='vertex':
    wanted=[0x3f000000 if x==0 else (0x3f7f8000 if entry['group']=='integerCases' else 0x3f7fffff) for x in mask];require(same(d['observedBits'],wanted) and same(list(struct.unpack('<8I',bytes(d['rawBytes'])))[4:],wanted),'migration physical exact carriers')
   else:require(same(d['observedBytes'],[128 if x==0 else 255 for x in mask]),'migration physical literal pixels')
 fm=read(output/'fault-artifacts/manifest.json');require(fm['status']=='passed' and fm['gitHead']==head and set(fm['modes'])==set(faults.MUTATIONS),'all actual exact-source fault builds')
 fault_reports=[]
 for mode,(before,after) in faults.MUTATIONS.items():
  rec=fm['modes'][mode];original=(ROOT/'renderer/virgl-shader/raw_bits.c').read_bytes();require(original.count(before.encode())==1 and rec['originalSha256']==sha(original) and rec['mutatedSha256']==sha(original.replace(before.encode(),after.encode())),'unique actual compiler source sabotage')
  for field in ('source','native','wasm','translations','wasmParity','buildLog'):require(same(binding(output/'fault-artifacts'/rec[field]['path'],output/'fault-artifacts'),rec[field]),'fault artifact bytes and digest')
  require((output/'fault-artifacts'/rec['source']['path']).read_bytes()==original.replace(before.encode(),after.encode()),'recorded mutated compiler source')
  parity=read(output/'fault-artifacts'/rec['wasmParity']['path']);translations=read(output/'fault-artifacts'/rec['translations']['path']);require(parity['status']=='passed' and parity['wasmSha256']==rec['wasm']['sha256'] and len(parity['results'])==len(translations)==len(fixtures['cases']),'all native/Wasm actual fault outputs')
  for a,b,e in zip(parity['results'],translations,fixtures['cases']):require(a['name']==b['name']==e['name'] and a['inputSha256']==b['inputSha256']==sha(e['text'].encode()) and same(a['result'],b['result']) and same(json.loads(b['stdout']),a['result']),'full source-fault native/Wasm parity')
  if mode=='known-nan':require(all(not e['result']['ok'] for e in translations if e['name'].startswith('known-nan-')),'bad compile-time knowledge refuted before unsafe GPU submission');continue
  r=browser_envelope(output/('fault-'+mode),head,base,rec)
  proof=r['acceptance'];require(proof['fault']==mode and proof['faultWasmSha256']==rec['wasm']['sha256'] and 'independent' in proof['failure']['message'] and 'actual compile' not in proof['failure']['message'] and 'actual link' not in proof['failure']['message'],'each actual compiler fault reaches independent GPU oracle failure')
  require(all(r['browser'][k]==primary['browser'][k] for k in ('version','executableSha256')) and same(r['browser']['gpu']['devices'],primary['browser']['gpu']['devices']),'same actual fault/positive hardware dependencies');fault_reports.append(dict(mode=mode,report=binding(output/('fault-'+mode)/'report.json',output)))
 consumer=read(output/'consumer/report.json');require(consumer['status']=='passed' and consumer['getters']==0,'current strict profile/metadata parser and zero invoked getters')
 for e in consumer['checks']:require(type(e['result']['ok']) is bool and (e['result']['ok'] is False if e['name'].startswith(('forbidden13-','unknown14')) else e['result']['ok'] is True),'typed consumer result')
 coverage_files=list((output/'consumer/v8').glob('*.json'));require(coverage_files,'actual consumer V8 counters')
 scripts=[script for path in coverage_files for script in read(path)['result'] if script['url'].endswith('/renderer/virgl-command/constant-domain.mjs')]
 require(len(scripts)==1,'one recorded consumer module')
 for function in scripts[0]['functions']:
  for region in function['ranges']:require(all(type(region[k]) is int and region[k]>=0 for k in ('startOffset','endOffset','count')) and region['endOffset']>=region['startOffset'],'typed consumer V8 counters')
 require(any(f['functionName']=='parseConstantDomain' and f['ranges'][0]['count']>=len(consumer['checks']) for f in scripts[0]['functions']),'all actual current compiler metadata exercised in consumer')
 # Close the exact committed source inventory before a recorded claim.
 paths={str(p.relative_to(ROOT)) for directory in (ROOT/'tools/virgl-raw-equality',ROOT/'renderer/virgl-shader') for p in directory.rglob('*') if p.is_file() and not any(part in ('build','__pycache__') or part.startswith('.') for part in p.relative_to(directory).parts)}
 paths.update(['renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/tests/bounded-loops-oracle.mjs','tools/lib/virgl-browser-runner.mjs','Makefile','docs/gpu-3d-contract.json','docs/gpu-3d-decision.md','tools/verify-virgl-raw-equality.sh','tools/virgl-bounded-loops/native_receipt.py','tools/virgl-bounded-loops/compat_common.py','tools/virgl-bounded-loops/shader_compat.py'])
 # Bind the historical validators actually loaded for their retained primitives.
 # Importing them is distinct from claiming their obsolete complete gates passed.
 paths.update(['tools/virgl-constants/receipt.py','tools/virgl-raw-bits/receipt.py','tools/virgl-integer-masks/receipt.py','tools/virgl-float-masks/receipt.py','tools/virgl-component-floats/native_receipt.py','tools/virgl-dot-reciprocals/native_receipt.py'])
 sources=[binding(ROOT/p) for p in sorted(paths)]
 for item in sources:source(item,head)
 for item in fm['sources']:source(item,head)
 records=[binding(p,output) for p in sorted(output.rglob('*')) if p.is_file() and p.name not in ('receipt.json','acceptance.log')]
 production=read(ROOT/'docs/gpu-3d-contract.json')['production'];require(same(production,json.loads(git('show','80813f4e45202cec3769d51b4f7d2b421034df01:docs/gpu-3d-contract.json'))['production']),'production advertisement unchanged')
 return dict(schema='raw-equality-submission-v1',task='E6-T12f1',status='passed',gitHead=head,heldHead='80813f4e45202cec3769d51b4f7d2b421034df01',guestExecution=False,production=production,predecessorFullGateClaimed=False,native={k:n[k] for k in ('stats','layout','flow','recordedMaxima','compatibility')},wasm=w,gpu=dict(words=checked,migrations=8,retained=retained),faults=fault_reports,consumer=dict(checks=len(consumer['checks']),getters=0),sources=sources,records=records)
if __name__=='__main__':
 output=Path(sys.argv[1]).resolve();report=verify(output,git('rev-parse','HEAD').decode().strip());(output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('E6-T12f1 recorded native/Wasm/GPU equality proof passed.')
