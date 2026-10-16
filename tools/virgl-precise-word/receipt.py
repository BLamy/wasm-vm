#!/usr/bin/env python3
"""Interrogate exact-head native/Wasm transcripts and independently predicted GPU words."""
import json,struct,subprocess,sys
from pathlib import Path
from shared import ROOT,require,sha,read,binding,source,same,git
import native_receipt,wasm_receipt
BASE=native_receipt.load('precise_browser_envelope','tools/virgl-constants/receipt.py')
COVERAGE=['renderer/virgl-command/tests/precise-words.mjs','tools/virgl-precise-word/oracle.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs']
def integers(value,length=None,maximum=0xffffffff):
 require(type(value) is list and (length is None or len(value)==length) and all(type(x) is int and 0<=x<=maximum for x in value),'typed physical integer array')
def browser(directory,head,task='E6-T12f4',fault=None):
 directory=Path(directory);r=read(directory/'report.json');require(r['task']==task and r['gitHead']==head and r['status']==('failed' if fault else 'passed'),'exact browser head/task/outcome')
 require(r['guestExecution'] is False and r['currentGuest3dAdvertisement'] is False and r['trackedChanges']==[],'isolated frozen browser source')
 require(same(r['browserErrors'],{'console':[],'page':[],'requests':[]}),'no browser errors')
 inventory={e['path']:e for e in r['sources']};require(len(inventory)==len(r['sources']),'unique full browser source inventory')
 for e in r['sources']:BASE.verify_source(e,head)
 for e in r['servedFiles']:
  if fault and e['path'].endswith('fault.wasm'):require(e['sha256']==fault['wasm']['sha256'],'actual compiled source-fault Wasm served')
  else:require(e['path'] in inventory and same(e,inventory[e['path']]),'served artifact equals bound source')
 require(r['browser']['gpu']['featureStatus'][r['browser']['webglFeature']]=='enabled' and r['browser']['launch']['headless'] is False,'actual hardware-enabled Chrome')
 actual=r['acceptance'];require(actual['guestExecution'] is False and actual['status']==('failed' if fault else 'passed'),'actual browser suite status')
 require(not any(x in actual['renderer']['renderer'].lower() for x in ['swiftshader','llvmpipe','softpipe','software','mock','fake']),'actual hardware renderer identity')
 photo=r['failureScreenshot'] if fault else r['screenshot'];require(sha((directory/photo['path']).read_bytes())==photo['sha256'],'physical screenshot digest')
 cov=r['browserCoverage'];raw=(directory/cov['path']).read_bytes();require(sha(raw)==cov['sha256'],'actual V8 counter digest')
 for e in json.loads(raw)['scripts']:require(e['source'] in inventory and e['sha256']==inventory[e['source']]['sha256'],'V8 counter source identity')
 return r

def physical(directory,head,native,reference,fault=None):
 r=browser(directory,head,fault=fault);a=r['acceptance'];fixture=read(ROOT/'renderer/virgl-shader/tests/precise-word-cases.json');by_name={e['name']:e for e in native['cases']}
 require(a['seed']==reference['seed'] and same(a['proof'],reference['proof']),'independent rational word proof')
 require(same(a['fixture'],binding(ROOT/'renderer/virgl-shader/tests/precise-word-cases.json')),'literal GPU fixture identity')
 draws=words=pixels=0;mismatches=[]
 require(len(a['rigs'])==50 if not fault else 1<=len(a['rigs'])<=50,'complete or first-failure hardware rig schedule')
 for rig,predicted in zip(a['rigs'],reference['kernels']):
  require(same(rig['kernel'],predicted['kernel']) and rig['input']==predicted['kernel']['case'],'actual literal kernel order')
  require(rig['objects']['live']==0 and all(type(v) is int and v==0 for v in rig['finalBudgets'].values()) and all(type(v) is int and v==0 for v in rig['finalResourceBudgets'].values()),'release every owned GPU object/budget')
  require(rig['bufferReadbacks']==[{'resourceId':e['id'],'bytes':e['bytes']} for e in rig['resourceInputs'] if e['id'] in (101,102)],'independent uploaded geometry buffer bytes')
  sources=[];expected_pair=native['pairs'][next(i for i,e in enumerate(native['pairs']) if e['name']=='gpu-'+rig['input']+'-pair')]['result']
  for t in rig['translations']:
   require(same(t['actual'],t['result']),'actual compiler output unchanged in shared renderer')
   if not fault:
    if t['kind']=='pair':require(same(t['result'],expected_pair),'full actual native/Wasm paired translation')
    else:
     entry=by_name[rig['input']] if t['request']['stage']==rig['kernel']['stage'] else by_name['pass-'+t['request']['stage']]
     require(t['request']['text']==entry['text'] and same(t['result'],entry['result']),'full exact source single translation')
   result=t['result'];sources += [x['glsl'] for x in ([result['vertex'],result['fragment']] if t['kind']=='pair' else [result])]
  for event in rig['glEvents']:
   if event['call']=='shaderSource':require(event['source'] in sources,'actual hardware shader equals compiler output')
   if event['call'] in ('compileShader','linkProgram'):require(event['status'] is True,'actual successful native shader/program compilation')
   if event['call']=='uniform4uiv':require(same(event['words'],event['observed']),'all actual uploaded uniform words read back')
  require(len(rig['draws'])==len(predicted['draws']) if not fault else 1<=len(rig['draws'])<=len(predicted['draws']),'literal complete or first-failure draw schedule')
  for draw,wanted in zip(rig['draws'],predicted['draws']):
   require(same(draw['vector'],wanted['vector']) and same(draw['bank'],wanted['bank']) and same(draw['oracle'],wanted['oracle']),'GPU bank and word oracle recomputed independently')
   raw=draw['rgbaBytes'];integers(raw,16384,255);require(sha(bytes(raw))==draw['rgbaSha256'] and type(draw['checkedPixels']) is int and draw['checkedPixels']==4096,'every physical pixel and digest')
   reconstructed=[0,0,0,0];first=None
   for y in range(64):
    for x in range(64):
     pixel=raw[(64*y+x)*4:(64*y+x+1)*4];expected=[0,0,255,255] if y>=2 else [((w>>(x//2))&1)*255 for w in wanted['oracle']['words']]
     if pixel!=expected and first is None:first=dict(x=x,y=y,expectedPixel=expected,observedPixel=pixel)
     if y==0 and x%2==0:
      for lane,v in enumerate(pixel):require(v in (0,255),'binary observer pixel');reconstructed[lane]|=(v//255)<<(x//2)
   if first:
    require(fault is not None and same(draw.get('failure'),first),'first actual source-fault pixel mismatch');mismatches.append(dict(kernel=rig['input'],vector=draw['vector']['name'],failure=first))
   else:
    integers(draw['words'],4);require(same(draw['words'],reconstructed) and same(reconstructed,wanted['oracle']['words']),'all reconstructed physical words equal independent literal prediction');draws+=1;words+=4;pixels+=4096
   require(draw['draw']['count']==192,'actual indexed geometry draw')
  draw_events=[e for e in rig['glEvents'] if e['call']=='drawElements'];require(len(draw_events)==len(rig['draws']),'every pixel record has one actual hardware draw')
 if fault:require(mismatches and 'independent exact word pixel mismatch' in a['failure']['message'] and a['faultWasmSha256']==fault['wasm']['sha256'],'source faults refuted by physical word oracle')
 else:require((draws,words,pixels)==(830,3320,3399680) and (a['drawCount'],a['checkedWords'],a['checkedPixels'])==(draws,words,pixels),'exact independent physical accounting')
 return dict(status='refuted-source-fault' if fault else 'passed',draws=draws,words=words,pixels=pixels,mismatches=mismatches)

def main():
 out=Path(sys.argv[1]).resolve();head=git('rev-parse','HEAD').decode().strip();native=native_receipt.verify(out/'native',head);wasm=wasm_receipt.verify(out/'wasm',head,native)
 semantic=read(out/'semantic/report.json');require(semantic['status']=='passed' and semantic['schema']=='precise-tgsi-semantic-audit-v1','pinned semantic audit')
 for e in semantic['sources']:source(e,head)
 require(binding(ROOT/semantic['binary']['path'])==semantic['binary'],'actual pinned token-audit binary');tokens=semantic['tokens'];require(binding(out/'semantic'/tokens['path'],out/'semantic')==tokens,'actual token-parser transcript')
 expected_tokens=[dict(stage=s,instructions=[dict(opcode=op,precise=i<4) for i,op in enumerate([1,89,92,13,1,89,92,13,98])]) for s in ('vertex','fragment')];require(same(semantic['actual'],expected_tokens) and same([json.loads(line) for line in (out/'semantic/tokens.jsonl').read_bytes().splitlines()],expected_tokens),'actual instruction-local flag values')
 reference=read(out/'reference.json');fresh=subprocess.check_output(['node','tools/virgl-precise-word/reference.mjs'],cwd=ROOT);require(same(reference,json.loads(fresh)),'literal predictions recomputed without GPU evidence')
 domain=read(out/'domain/report.json');require(domain['status']=='passed' and len(domain['results'])==20 and len(domain['forgeries'])==334 and len(domain['ownership'])==20 and len(domain['combined'])==24,'full closed consumer profile matrix')
 for e in domain['sources']:source(e,head)
 for e in domain['forgeries']:require(e['result']['ok'] is False and e['result']['error']['code']=='shader-domain-error','malformed or erased obligation rejected')
 for e in domain['ownership']:require(e['owned']['operations']!=e['caller']['operations'] and e['owned']['stage'] in ('vertex','fragment'),'owned precision survives caller mutation')
 gpu=physical(out/'gpu',head,native,reference);faults=read(out/'faults/manifest.json');require(faults['status']=='passed' and set(faults['modes'])=={'max-source-order','zero-equality','ne-unordered'},'actual isolated compiler faults')
 sabotage={}
 for mode,f in faults['modes'].items():
  source(f['original'],head);before=(ROOT/f['original']['path']).read_text();require(before.count(f['before'])==1 and (out/'faults'/f['fault']['path']).read_text()==before.replace(f['before'],f['after']),'actual unique source mutation')
  for k in ('fault','wasm','buildLog','browserReport'):require(same(binding(out/'faults'/f[k]['path'],out/'faults'),f[k]),'source-fault artifacts unchanged')
  sabotage[mode]=physical(out/'faults'/mode/'gpu',head,native,reference,f)
 retained={}
 for label,task in [('equality','E6-T12f1'),('selected','E6-T12f2'),('radial','E6-T12f3')]:
  r=browser(out/('retained-'+label),head,task=task);retained[label]=dict(status=r['status'],checkedWords=r['acceptance'].get('checkedWords'),checkedPixels=r['acceptance'].get('checkedPixels'));require(r['status']=='passed','retained independent leaf')
 require(len(native['migrationInventory'])==24 and sum(e['kind']=='single' for e in native['migrationInventory'])==20 and sum(e['kind']=='rejection' for e in native['migrationInventory'])==2 and sum(e['kind']=='pair' for e in native['migrationInventory'])==2,'explicit complete predecessor migration inventory')
 records=[binding(p,out) for p in sorted(out.rglob('*')) if p.is_file() and p.name not in ('receipt.json','acceptance.log') and '__pycache__' not in p.parts and not any(x in ('source','build') for x in p.relative_to(out).parts)]
 receipt=dict(schema='precise-word-receipt-v1',task='E6-T12f4',status='passed',gitHead=head,guestExecution=False,currentGuest3dAdvertisement=False,nativeStats=native['stats'],wasm=wasm,gpu=gpu,sabotage=sabotage,retained=retained,semantic=semantic['tokens'],domain=dict(profiles=20,forgeries=334,combined=24),migrationInventory=native['migrationInventory'],records=records)
 (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'status':'passed','task':receipt['task'],'gpu':gpu,'nativeCalls':native['stats']['calls'],'wasmCalls':wasm['counts']['calls']}))
if __name__=='__main__':main()
