#!/usr/bin/env python3
"""Read complete source-bound transcripts, every pixel and before-effect attacks."""
import json,struct,subprocess,sys
from pathlib import Path
from shared import ROOT,require,sha,read,binding,source,same,git
import native_receipt,wasm_receipt
BASE=native_receipt.load('raster_browser_primitives','tools/virgl-constants/receipt.py')
def integers(value,length=None,maximum=0xffffffff):
 require(type(value) is list and (length is None or len(value)==length) and all(type(x) is int and 0<=x<=maximum for x in value),'typed complete physical integer array')
def envelope(directory,head,task='E6-T12f5',fault=None,fault_root=None):
 directory=Path(directory);r=read(directory/'report.json');require(r['task']==task and r['gitHead']==head and r['status']==('failed' if fault else 'passed'),'exact browser head/task/outcome')
 require(r['guestExecution'] is False and r['currentGuest3dAdvertisement'] is False and r['trackedChanges']==[],'isolated frozen source')
 require(same(r['browserErrors'],{'console':[],'page':[],'requests':[]}),'zero browser errors')
 allowed={str((fault_root/e['path']).relative_to(ROOT)):e for e in fault['served']} if fault else {}
 inventory={}
 for e in r['sources']:
  if e['path'] in inventory:require(same(e,inventory[e['path']]),'duplicate pin agrees with complete source inventory')
  else:inventory[e['path']]=e
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
 g=rig['geometry'];words=[];indices=[]
 for bit in range(32):
  first=len(words)//8
  for dx,dy in ((0,0),(1,0),(1,1),(0,1)):
   words += [struct.unpack('<I',struct.pack('<f',x))[0] for x in [-1+(bit+dx)/16,-1+dy*2]]+[(96+bit)*8388608+4194304,96*8388608+4194304,0x3e800000,0x3f400000,0x3f000017,0x3e000000]
  indices += [first,first+1,first+2,first,first+2,first+3]
 require(same(g,dict(width=64,height=2,stride=32,vertexWords=words,indexWords=indices)),'literal two-row bit-plane geometry')
 inputs=rig['resourceInputs'];require([e['id'] for e in inputs]==[101,102,103],'actual complete resource inventory')
 require(inputs[0]['bytes']==list(struct.pack('<'+str(len(words))+'I',*words)) and inputs[1]['bytes']==list(struct.pack('<'+str(len(indices))+'H',*indices)) and inputs[2]['bytes']==[0]*512,'actual geometry and zero target bytes')
 require(same([dict(resourceId=e['id'],bytes=e['bytes']) for e in inputs[:2]],rig['bufferReadbacks']),'actual GPU input buffer readbacks')
def recorded_compilers(native):
 cases={};singles={};pairs={}
 groups=[(label+'::',native[label+'Cases'],native[label+'Pairs']) for label,*_ in native_receipt.producer.GROUPS]+[('',native['cases'],native['pairs'])]
 for prefix,entries,_ in groups:
  for entry in entries:
   cases[prefix+entry['name']]=entry
   key=(entry['stage'],entry['text'])
   if key in singles:require(same(singles[key],entry['result']),'duplicate input has identical native result')
   singles[key]=entry['result']
 for prefix,_,entries in groups:
  for entry in entries:
   ref=lambda name:name if '::' in name else prefix+name
   key=tuple(cases[ref(entry[k])]['text'] for k in ('vertexCaseName','fragmentCaseName'))
   if key in pairs:require(same(pairs[key],entry['result']),'duplicate pair has identical native result')
   pairs[key]=entry['result']
 return singles,pairs
def counted_source(text,markers):
 if 'uint raw_exact_jam(' not in text:return text
 import re
 anchor=' raw_rhs = uvec4((raw_temp[117].x >>';require(text.count(anchor)==1,'one source-bound physical flag observer')
 text=text.replace('uint raw_exact_jam(','uvec2 raw_exact_hits = uvec2(0u);\nuint raw_exact_jam(')
 def hit(match):
  name=match[1];require(name in markers,'source-bound marker');i=markers.index(name)
  return match[0]+' raw_exact_hits.'+('x' if i<32 else 'y')+' |= '+str(2**(i%32))+'u;'
 text=re.sub(r'/\* exact:([a-z-]+) \*/',hit,text)
 return text.replace(anchor,' raw_temp[117] = uvec4(raw_exact_hits, 0u, 0u);\n'+anchor)
def counted_result(result,markers):
 if 'vertex' in result:return dict(result,vertex=counted_result(result['vertex'],markers),fragment=counted_result(result['fragment'],markers))
 return dict(result,glsl=counted_source(result['glsl'],markers))
def packet(op,kind,words):return list(struct.pack('<'+str(len(words)+1)+'I',op+kind*256+len(words)*65536,*words))
def physical(directory,head,native,reference,fault=None,fault_root=None):
 r=envelope(directory,head,fault=fault,fault_root=fault_root);a=r['acceptance'];fixture=read(ROOT/'renderer/virgl-shader/tests/precise-arithmetic-cases.json')
 require(a['schema']=='precise-arithmetic-gpu-v1' and a['seed']==reference['seed'] and same(a['proof'],reference['proof']) and same(a['fixture'],binding(ROOT/'renderer/virgl-shader/tests/precise-arithmetic-cases.json')),'independent rational predictions and exact fixture')
 predicted={e['kernel']['case']:e for e in reference['kernels']};singles,pairs=recorded_compilers(native)
 require(len(a['rigs'])==(1 if fault else len(fixture['kernels'])),'complete physical arithmetic schedule')
 import re
 markers=re.findall(r'/\* exact:([a-z-]+) \*/',(ROOT/'renderer/virgl-shader/raw_binary32.h').read_text());require(len(markers)<=64 and len(set(markers))==len(markers),'bounded literal helper marker inventory')
 if not fault:
  require(same(a['helperHeader'],dict(binding(ROOT/'renderer/virgl-shader/raw_binary32.h'),markers=markers)),'actual served helper source binding')
  coverage=[k for k in fixture['kernels'] if k['variant']=='direct' and k['op'] in ('ADD','CHAIN') and k['mask']=='xyzw']
  require(len(a['helperCoverage'])==4 and same([x['kernel'] for x in a['helperCoverage']],coverage),'both-stage helper counter schedule')
 else:require(a['helperCoverage']==[] and a['faultWasmSha256']==fault['wasm']['sha256'],'actual source-fault Wasm is consumed')
 counts=dict(draws=0,words=0,pixels=0,counterDraws=0,counterPixels=0,physicalFailures=0)
 hits={'vertex':set(),'fragment':set()}
 for rig in a['rigs']+a['helperCoverage']:
  kernel=rig['kernel'];prediction=predicted[kernel['case']];counted='instrumentation' in rig
  require(same(kernel,prediction['kernel']) and (not counted or rig['instrumentation']=='helper-branch-flags-v1'),'literal kernel and instrumentation schedule');geometry(rig)
  require(rig['objects']['live']==0 and all(type(v) is int and v==0 for v in rig['finalBudgets'].values()) and all(type(v) is int and v==0 for v in rig['finalResourceBudgets'].values()),'all actual GPU objects and owned budgets released')
  if kernel['op']=='ORIGINAL':require(same(rig['original'],binding(ROOT/kernel['originalPath'])) and rig['original']['sha256']==kernel['originalSha256'],'unchanged last original actually served')
  sources=[]
  for translation in rig['translations']:
   request=translation['request'];actual=translation['actual']
   if not fault:
    wanted=singles[(request['stage'],request['text'])] if translation['kind']=='single' else pairs[(request['vertexText'],request['fragmentText'])]
    require(same(actual,wanted),'entire actual native/Wasm single or pair result')
   result=translation['result'];require(actual['ok'] is True and same(result,counted_result(actual,markers) if counted else actual),'only explicit independent GPU counter edits')
   sources += [stage['glsl'] for stage in ([result['vertex'],result['fragment']] if 'vertex' in result else [result])]
  require(len(rig['translations'])>=2,'actual compiler inputs recorded')
  for event in rig['glEvents']:
   if event['call']=='shaderSource':require(event['source'] in sources,'actual GPU source exactly the recorded compiler output or explicit counters')
   if event['call'] in ('compileShader','linkProgram'):require(event['status'] is True,'actual hardware compile/link success')
   if event['call']=='uniform4uiv':require(same(event['words'],event['observed']) and event['programId']==event['currentProgramId'],'actual owned raw bank uniforms independently read back')
  schedules=prediction['vectors']
  if fault:schedules=[e for e in schedules if e['vector']['name']==fault['vector']];require(kernel['case']==fault['kernel'] and len(schedules)==1,'literal fault schedule')
  require(len(rig['draws'])==len(schedules),'every exact or counter physical draw')
  executed=set()
  for draw,wanted in zip(rig['draws'],schedules):
   require(same((draw['vector'],draw['bank'],draw['oracle']),(wanted['vector'],wanted['bank'],wanted['oracle'])),'oracle inputs, raw carriers and word prediction precede physical result')
   raw=draw['rgbaBytes'];integers(raw,512,255);require(sha(bytes(raw))==draw['rgbaSha256'] and type(draw['checkedPixels']) is int and draw['checkedPixels']==128,'all actual physical pixel bytes and digest')
   index=draw['submission'];require(type(index) is int and index>=2,'actual draw submission index')
   submission=rig['submissions'][index];require(submission['result']['ok'] is True and same(draw['draw'],submission['result']['draws'][0]) and submission['bytes']==packet(8,0,[0,192,4,1,1,0,0,0,0,0,4095,0]),'actual shared renderer draw packet and result')
   require(rig['submissions'][index-2]['bytes']==packet(12,0,[0,0,*draw['bank']])+packet(12,0,[1,0,*draw['bank']]),'actual immutable bank wire inputs for each draw')
   events=rig['glEvents'][submission['eventsStart']:submission['eventsEnd']];require(sum(e['call']=='drawElements' for e in events)==1,'one actual hardware draw per recording')
   reconstructed=[0,0,0,0];first=None
   for y in range(2):
    for x in range(64):
     observed=raw[(64*y+x)*4:(64*y+x+1)*4]
     wanted_pixel=raw[(x//2)*8:(x//2)*8+4] if counted else wanted['oracle']['color'] if wanted['oracle']['words'] is None else [((word>>(x//2))&1)*255 for word in wanted['oracle']['words']]
     if observed!=wanted_pixel and first is None:first=dict(x=x,y=y,expectedPixel=wanted_pixel,observedPixel=observed)
     if wanted['oracle']['words'] is not None and y==0 and x%2==0:
      for lane,value in enumerate(observed):require(value in (0,255),'physical exact-word or branch bit');reconstructed[lane]|=(value//255)<<(x//2)
   if first:require(fault is not None and same(draw.get('failure'),first),'first independent physical source-fault contradiction');counts['physicalFailures']+=1;continue
   require(not fault,'source fault must produce an actual word mismatch')
   if counted:
    require(same(draw['counterWords'],reconstructed) and reconstructed[2:]==[0,0] and draw['words'] is None,'full reconstructed branch flag words')
    observed=[name for i,name in enumerate(markers) if (reconstructed[0 if i<32 else 1]>>(i%32))&1]
    require(same(draw['helperBranches'],observed),'actual bit flags map to source branch points');executed.update(observed)
    counts['counterDraws']+=1;counts['counterPixels']+=128
   else:
    if wanted['oracle']['words'] is not None:require(same(reconstructed,wanted['oracle']['words']) and same(draw['words'],reconstructed),'all exact binary32 words');counts['words']+=4
    else:require(draw['words'] is None,'ordinary RGBA8 output makes no raw-word preservation claim')
    counts['draws']+=1;counts['pixels']+=128
  if counted:
   require(same(rig['executed'],[m for m in markers if m in executed]),'recorded branch union equals actual physical flags');hits[kernel['stage']].update(executed)
  require(sum(e['call']=='drawElements' for e in rig['glEvents'])==len(rig['draws']),'every actual hardware draw is recorded')
 if fault:require(counts['physicalFailures']==1 and 'independent exact word pixel mismatch' in a['failure']['message'],'independent source-fault word refutation')
 else:
  draws=sum(len(x['vectors']) for x in reference['kernels']);words=sum(4*len(x['vectors']) for x in reference['kernels'] if x['kernel']['op'] not in ('ORIGINAL','RASTER'))
  require((a['drawCount'],a['checkedWords'],a['checkedPixels'])==(draws,words,draws*128) and (counts['draws'],counts['words'],counts['pixels'])==(draws,words,draws*128),'complete independent hardware accounting')
  require(counts['counterDraws']==4*len(reference['proof']['cases']) and counts['counterPixels']==counts['counterDraws']*128,'every source-bound helper coverage draw')
  require(all(hits[stage]==set(markers) for stage in hits) and same(a['helperCoverageByStage'],{stage:markers for stage in hits}),'every helper marker executes in each actual GPU stage')
 return dict(status='refuted-source-fault' if fault else 'passed',**counts,helperBranches=len(markers) if not fault else 0)
def main():
 out=Path(sys.argv[1]).resolve();head=git('rev-parse','HEAD').decode().strip();native=native_receipt.verify(out/'native',head);wasm=wasm_receipt.verify(out/'wasm',head,native)
 def reference(seed=None):
  filename='reference.json' if seed is None else f'reference-{seed}.json';record=read(out/filename)
  fresh=json.loads(subprocess.check_output(['node','tools/virgl-precise-arithmetic/reference.mjs',*([] if seed is None else [str(seed)])],cwd=ROOT))
  require(same(record,fresh),'independent rational reference recomputed');return record
 predicted=reference();consumer=read(out/'consumer.json')
 require(consumer['status']=='passed' and consumer['accessorInvocations']==0 and same(consumer,json.loads(subprocess.check_output(['node','tools/virgl-precise-arithmetic/consumer.mjs'],cwd=ROOT))),'closed combined contracts and owned policy replayed')
 gpu=physical(out/'gpu',head,native,predicted);chaos={}
 for seed in (2872938129,967105429):chaos[str(seed)]=physical(out/f'gpu-{seed}',head,native,reference(seed))
 faults=read(out/'faults/manifest.json');require(faults['status']=='passed' and set(faults['modes'])=={'sticky','round-even','limb-carry','normalize','zero-sign','intermediate-rounding'},'all actual arithmetic source faults')
 sabotage={}
 for mode,fault in faults['modes'].items():
  source(fault['original'],head);text=(ROOT/fault['original']['path']).read_text();require(text.count(fault['before'])==1 and (out/'faults'/fault['fault']['path']).read_text()==text.replace(fault['before'],fault['after']),'unique isolated actual arithmetic mutation')
  for key in ('fault','wasm','buildLog','browserReport'):require(same(binding(out/'faults'/fault[key]['path'],out/'faults'),fault[key]),'actual source-fault artifact digest')
  sabotage[mode]=physical(out/'faults'/mode/'gpu',head,native,predicted,fault,out/'faults')
 retained={}
 for label,task in [('mask','E6-T12f4a'),('precise','E6-T12f4'),('equality','E6-T12f1'),('selected','E6-T12f2'),('radial','E6-T12f3'),('raster','E6-T12f4b')]:
  report=envelope(out/('retained-'+label),head,task=task);retained[label]=dict(status=report['status'],checkedWords=report['acceptance'].get('checkedWords'),checkedPixels=report['acceptance'].get('checkedPixels'))
 require(len(native['migrationInventory'])==15 and {kind:sum(e['kind']==kind for e in native['migrationInventory']) for kind in ('single','pair','original')}==dict(single=10,pair=4,original=1),'complete literal arithmetic admission ledger')
 for entry in native['originals']:require(sha((ROOT/entry['path']).read_bytes())==entry['sha256'],'all19 original shader bodies unchanged')
 for name in ('retained-mask-regressions.log','retained-precise-regressions.log','retained-upstream-allocations.log','retained-radial-regressions.log','retained-raster-regressions.log'):require((out/name).is_file() and (out/name).stat().st_size>0,'recorded promoted regression output')
 records=[binding(path,out) for path in sorted(out.rglob('*')) if path.is_file() and path.name not in ('receipt.json','acceptance.log') and '__pycache__' not in path.parts and not any(x in ('source','build') for x in path.relative_to(out).parts)]
 receipt=dict(schema='precise-arithmetic-receipt-v1',task='E6-T12f5',status='passed',gitHead=head,guestExecution=False,currentGuest3dAdvertisement=False,nativeStats=native['stats'],wasm=wasm,gpu=gpu,chaos=chaos,sabotage=sabotage,retained=retained,migrationInventory=native['migrationInventory'],consumer={key:len(consumer[key]) for key in ('contracts','forgeries','ownership','combined')},records=records)
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'status':'passed','task':receipt['task'],'gpu':gpu,'nativeCalls':native['stats']['calls'],'wasmCalls':wasm['counts']['calls']}))
if __name__=='__main__':main()
