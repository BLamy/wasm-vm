#!/usr/bin/env python3
"""Read complete source-bound transcripts, every pixel and before-effect attacks."""
import json,struct,subprocess,sys
from pathlib import Path
from shared import ROOT,require,sha,read,binding,source,same,git
import native_receipt,wasm_receipt
BASE=native_receipt.load('raster_browser_primitives','tools/virgl-constants/receipt.py')
def integers(value,length=None,maximum=0xffffffff):
 require(type(value) is list and (length is None or len(value)==length) and all(type(x) is int and 0<=x<=maximum for x in value),'typed complete physical integer array')
def envelope(directory,head,task='E6-T12f4b',fault=None,fault_root=None):
 directory=Path(directory);r=read(directory/'report.json');require(r['task']==task and r['gitHead']==head and r['status']==('failed' if fault else 'passed'),'exact browser head/task/outcome')
 require(r['guestExecution'] is False and r['currentGuest3dAdvertisement'] is False and r['trackedChanges']==[],'isolated frozen source')
 require(same(r['browserErrors'],{'console':[],'page':[],'requests':[]}),'zero browser errors')
 allowed={str((fault_root/e['path']).relative_to(ROOT)):e for e in fault['served']} if fault else {}
 inventory={e['path']:e for e in r['sources']};require(len(inventory)==len(r['sources']),'unique complete source inventory')
 for e in r['sources']:
  if e['path'] in allowed:require(e['size']==allowed[e['path']]['bytes'] and e['sha256']==allowed[e['path']]['sha256'],'actual source fault served')
  else:BASE.verify_source(e,head)
 for e in r['servedFiles']:require(e['path'] in inventory and same(e,inventory[e['path']]),'served exact source/artifact')
 require(r['browser']['gpu']['featureStatus'][r['browser']['webglFeature']]=='enabled' and r['browser']['launch']['headless'] is False,'real hardware-enabled Chrome')
 a=r['acceptance'];require(a['guestExecution'] is False and a['status']==('failed' if fault else 'passed'),'actual suite outcome');require(not any(x in a['renderer']['renderer'].lower() for x in ['swiftshader','llvmpipe','softpipe','software','mock','fake']),'actual hardware identity')
 photo=r['failureScreenshot'] if fault else r['screenshot'];require(sha((directory/photo['path']).read_bytes())==photo['sha256'],'physical screenshot digest')
 cov=r['browserCoverage'];raw=(directory/cov['path']).read_bytes();require(sha(raw)==cov['sha256'],'real V8 counter digest')
 for e in json.loads(raw)['scripts']:require(e['source'] in inventory and e['sha256']==inventory[e['source']]['sha256'],'V8 counter source binding')
 return r
def geometry(rig):
 g=rig['geometry'];words=[];indices=[];rows=1 if rig['kernel']['stage']=='vertex' else None
 for bit in range(32 if rows else 1):
  first=len(words)//8
  for dx,dy in ((0,0),(1,0),(1,1),(0,1)):
   position=[-1+(bit+dx)/16,-1+dy/16] if rows else [-1+dx*2,-1+dy*2]
   words += [struct.unpack('<I',struct.pack('<f',x))[0] for x in position]+[(96+bit)*8388608+4194304,96*8388608+4194304,0x3e800000,0x3f400000,0x3f000017,0x3e000000]
  indices += [first,first+1,first+2,first,first+2,first+3]
 require(g['rows']==rows and g['width']==g['height']==64 and g['stride']==32 and same(g['vertexWords'],words) and same(g['indexWords'],indices),'literal bit carriers, positions and actual geometry')
 inputs=rig['resourceInputs'];require([e['id'] for e in inputs]==[101,102,103],'actual complete resource inventory')
 require(inputs[0]['bytes']==list(struct.pack('<'+str(len(words))+'I',*words)) and inputs[1]['bytes']==list(struct.pack('<'+str(len(indices))+'H',*indices)) and inputs[2]['bytes']==[0]*16384,'all actual uploaded geometry/zero target bytes')
 require(same([{'resourceId':e['id'],'bytes':e['bytes']} for e in inputs[:2]],[{'resourceId':e['resourceId'],'bytes':e['bytes']} for e in rig['bufferReadbacks']]),'independent GPU input buffer readbacks')
def physical(directory,head,native,reference,fault=None,fault_root=None):
 r=envelope(directory,head,fault=fault,fault_root=fault_root);a=r['acceptance'];fixture=read(ROOT/'renderer/virgl-shader/tests/raster-bank-cases.json')
 require(a['seed']==reference['seed'] and same(a['domainProof'],reference['proof']) and same(a['fixture'],binding(ROOT/'renderer/virgl-shader/tests/raster-bank-cases.json')),'independent domain and literal fixture')
 predicted={e['kernel']['case']:e for e in reference['kernels']};cases={}
 for label,_,_,_ in native_receipt.producer.GROUPS:
  for e in native[label+'Cases']:cases[(e['stage'],e['text'])]=e
 for e in native['cases']:cases[(e['stage'],e['text'])]=e
 pair_results={e['name']:e['result'] for e in native['pairs']};draws=words=pixels=attacks=stops=failures=0
 require(len(a['rigs'])==(1 if fault else 40),'complete literal hardware schedule')
 for rig in a['rigs']:
  kernel=rig['kernel'];wanted=predicted[kernel['case']];require(same(kernel,wanted['kernel']),'literal shader schedule');geometry(rig)
  require(rig['glObjects']['live']==0 and all(type(v) is int and v==0 for v in rig['finalBudgets'].values()) and all(type(v) is int and v==0 for v in rig['finalResourceBudgets'].values()),'every object and owned budget released')
  if kernel['kind']=='original':require(same(rig['original'],binding(ROOT/kernel['originalPath'])) and rig['original']['sha256']==kernel['originalSha256'],'untouched original actually served')
  sources=[]
  for t in rig['translations']:
   if not fault:
    if t['kind']=='pair':require(same(t['result'],pair_results['gpu-'+kernel['case']+'-pair']),'complete native/Wasm pair translation')
    else:require(same(t['result'],cases[(t['request']['stage'],t['request']['text'])]['result']),'complete native/Wasm single translation')
   result=t['result'];require(result['ok'] is True,'actual shader accepted');sources += [s['glsl'] for s in ([result['vertex'],result['fragment']] if 'vertex' in result else [result])]
  for event in rig['glEvents']:
   if event['call']=='shaderSource':require(event['source'] in sources,'actual hardware shader exactly compiler output')
   if event['call'] in ('compileShader','linkProgram'):require(event['status'] is True,'actual shader/program compilation')
   if event['call']=='uniform4uiv':require(same(event['words'],event['observed']),'every actual raw uniform read back')
  schedule=list(wanted['draws'])
  if kernel['case'].startswith('copy-xyzw-direct-') or kernel['kind']=='original':schedule += [dict(wanted['draws'][1],vector=dict(wanted['draws'][1]['vector'],name='valid owned generation replacement')),dict(wanted['draws'][0],vector=dict(wanted['draws'][0]['vector'],name='restored immutable approval'))]
  require(len(rig['draws'])==len(schedule) if not fault else 1<=len(rig['draws'])<=len(schedule),'every scheduled or first-failure hardware draw')
  for draw,expected in zip(rig['draws'],schedule):
   require(same(draw['vector'],expected['vector']) and same(draw['bank'],expected['bank']) and same(draw['oracle'],expected['oracle']),'word prediction precedes physical pixels')
   raw=draw['rgbaBytes'];integers(raw,16384,255);require(sha(bytes(raw))==draw['rgbaSha256'] and type(draw['checkedPixels']) is int and draw['checkedPixels']==4096,'every actual pixel digest')
   reconstructed=[0,0,0,0];first=None
   for y in range(64):
    for x in range(64):
     observed=raw[(64*y+x)*4:(64*y+x+1)*4];wanted_pixel=([((w>>(x//2))&1)*255 for w in expected['oracle']['words']] if y<2 else [0,0,255,255]) if kernel['stage']=='vertex' else expected['oracle']['color']
     if observed!=wanted_pixel and first is None:first=dict(x=x,y=y,expectedPixel=wanted_pixel,observedPixel=observed)
     if kernel['stage']=='vertex' and y==0 and x%2==0:
      for lane,v in enumerate(observed):require(v in (0,255),'literal binary bit pixels');reconstructed[lane]|=(v//255)<<(x//2)
   if first:require(fault is not None and same(draw.get('failure'),first),'first physical source-fault mismatch');failures+=1
   else:
    if kernel['stage']=='vertex':require(same(reconstructed,expected['oracle']['words']) and same(draw['words'],reconstructed),'all exact flat copied words');words+=4
    else:require(draw['words'] is None,'RGBA8 color does not claim full word identity')
    draws+=1;pixels+=4096
  require(len([e for e in rig['glEvents'] if e['call']=='drawElements'])==len(rig['draws']),'one actual draw for each pixel record')
  if fault:
   for stop in rig['oracleStops']:
    value=struct.unpack('<f',struct.pack('<I',stop['word']))[0];require(stop['unsafeGpuCalled'] is False and stop['call'] in ('uniform4uiv','drawElements') and 0<abs(value)<2**-126,'independent pre-effect oracle catches a disallowed exact word');stops+=1
  else:
   require(rig['oracleStops']==[],'healthy runtime rejects before independent last guard')
   lifecycle=kernel['case'].startswith('copy-xyzw-direct-') or kernel['kind']=='original';require(len(rig['attacks'])==(8 if lifecycle else 0),'complete before-effect domain and wire attacks')
   for attack in rig['attacks']:
    require(attack['result']['ok'] is False and attack['result']['appliedCommands']==0 and same(attack['before'],attack['after']) and same(attack['pixelsBefore'],attack['pixelsAfter']),'every rejected operation preserves state and full framebuffer')
    require(attack['result']['error']['code']==('invalid-value' if attack['name']=='nonfinite wire word' else 'constant-raster-domain-error'),'exact domain/wire rejection')
    require(not any(e['call'] in ('uniform4uiv','drawElements','compileShader','linkProgram','useProgram') for e in attack['events']),'rejection precedes GPU effects');attacks+=1
   if lifecycle:
    require(len(rig['lifecycle'])==5 and rig['lifecycle'][-1]['name']=='explicit restoration' and rig['lifecycle'][-1]['result']['ok'] is True,'all four invalid owned replacements and explicit restoration')
    for entry in rig['lifecycle'][:-1]:require(entry['stored']['contexts'][0]['subContexts'][0]['bindings']['constants'][entry['stage']][entry['register']*4+entry['lane']]==entry['word'],'invalid word retained exactly on CPU')
    if rig['asynchronous']:
     require(len(rig['yieldAttacks'])==1,'real waiting-index interference');attack=rig['yieldAttacks'][0];require(same(attack['before'],attack['after']) and all(e['result']['ok'] is False and e['result']['error']['code']=='busy' for e in attack['attempts']),'replacement/restoration/destruction cannot change held generation')
    else:require(any(e.get('inputAfter') and all(x==255 for x in e['inputAfter']) for e in rig['submissions']),'caller bytes mutated after actual decode')
 if fault:require((stops>0) != (failures>0),'actual omitted-domain or wrong-copy fault contradicted by independent oracle')
 else:require((draws,words,pixels,attacks)==(192,400,786432,96) and (a['drawCount'],a['checkedWords'],a['checkedPixels'])==(draws,words,pixels),'complete physical and rejection accounting')
 return dict(status='refuted-source-fault' if fault else 'passed',draws=draws,words=words,pixels=pixels,attacks=attacks,preEffectStops=stops,physicalFailures=failures)
def main():
 out=Path(sys.argv[1]).resolve();head=git('rev-parse','HEAD').decode().strip();native=native_receipt.verify(out/'native',head);wasm=wasm_receipt.verify(out/'wasm',head,native)
 reference=read(out/'reference.json');fresh=json.loads(subprocess.check_output(['node','tools/virgl-raster-bank/reference.mjs'],cwd=ROOT));require(same(reference,fresh),'literal reference recomputed independently')
 consumer=read(out/'consumer.json');require(consumer['status']=='passed' and same(consumer,json.loads(subprocess.check_output(['node','tools/virgl-raster-bank/consumer.mjs'],cwd=ROOT))),'consumer predicates and closed contracts replayed')
 gpu=physical(out/'gpu',head,native,reference);chaos={}
 for seed in (2872938129,967105429):
  prediction=read(out/f'reference-{seed}.json');require(same(prediction,json.loads(subprocess.check_output(['node','tools/virgl-raster-bank/reference.mjs',str(seed)],cwd=ROOT))),'varied independent seed prediction');chaos[str(seed)]=physical(out/f'gpu-{seed}',head,native,prediction)
 faults=read(out/'faults/manifest.json');require(faults['status']=='passed' and set(faults['modes'])=={'drop-component','missing-guard','unapproved-decode'},'actual boundary faults')
 sabotage={}
 for mode,f in faults['modes'].items():
  source(f['original'],head);before=(ROOT/f['original']['path']).read_text();require(before.count(f['before'])==1 and (out/'faults'/f['fault']['path']).read_text()==before.replace(f['before'],f['after']),'unique actual runtime fault')
  for adaptation in f['adaptations']:
   source(adaptation['original'],head);text=(ROOT/adaptation['original']['path']).read_text()
   for old,new in adaptation['edits']:require(text.count(old)==1,'single resolver adaptation');text=text.replace(old,new)
   require((out/'faults'/adaptation['fault']['path']).read_text()==text,'faulted state changes only import resolution')
  for key in ('fault','wasm','buildLog','browserReport'):
   if key in f:require(same(binding(out/'faults'/f[key]['path'],out/'faults'),f[key]),'exact source-fault artifact digest')
  sabotage[mode]=physical(out/'faults'/mode/'gpu',head,native,reference,f,out/'faults')
 retained={}
 for label,task in [('mask','E6-T12f4a'),('precise','E6-T12f4'),('equality','E6-T12f1'),('selected','E6-T12f2'),('radial','E6-T12f3')]:
  r=envelope(out/('retained-'+label),head,task=task);retained[label]=dict(status=r['status'],checkedWords=r['acceptance'].get('checkedWords'),checkedPixels=r['acceptance'].get('checkedPixels'))
 require(len(native['migrationInventory'])==31 and {kind:sum(e['kind']==kind for e in native['migrationInventory']) for kind in ('single','pair','original')}==dict(single=24,pair=3,original=4),'explicit complete admission ledger')
 for entry in native['originals']:require(sha((ROOT/entry['path']).read_bytes())==entry['sha256'],'all19 original shader bodies unchanged')
 for name in ('retained-mask-regressions.log','retained-precise-regressions.log','retained-upstream-allocations.log','retained-radial-regressions.log'):require((out/name).is_file() and (out/name).stat().st_size>0,'recorded promoted regression output')
 records=[binding(p,out) for p in sorted(out.rglob('*')) if p.is_file() and p.name not in ('receipt.json','acceptance.log') and '__pycache__' not in p.parts and not any(x in ('source','build') for x in p.relative_to(out).parts)]
 receipt=dict(schema='raster-bank-receipt-v1',task='E6-T12f4b',status='passed',gitHead=head,guestExecution=False,currentGuest3dAdvertisement=False,nativeStats=native['stats'],wasm=wasm,gpu=gpu,chaos=chaos,sabotage=sabotage,retained=retained,migrationInventory=native['migrationInventory'],consumer={key:len(consumer[key]) for key in ('domain','contracts','banks','hostile')},records=records)
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'status':'passed','task':receipt['task'],'gpu':gpu,'nativeCalls':native['stats']['calls'],'wasmCalls':wasm['counts']['calls']}))
if __name__=='__main__':main()
