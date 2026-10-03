#!/usr/bin/env python3
"""Interrogate restricted radial native/Wasm, physical GPU and actual source sabotage."""
import json
from pathlib import Path
import struct
import subprocess
import sys
from shared import ROOT, require, sha, read, binding, source, same, git
import native_receipt
import wasm_receipt
BASE = native_receipt.load('radial_browser_envelope','tools/virgl-constants/receipt.py')
COVERAGE = ['renderer/virgl-command/tests/radial-domain.mjs','tools/virgl-radial-domain/oracle.mjs',
            'renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs']
def integers(values,length=None,maximum=0xffffffff):
 require(type(values) is list and (length is None or len(values)==length) and all(type(x) is int and 0<=x<=maximum for x in values),'typed full physical integers')

def browser_envelope(directory, head, fault=None):
    directory = Path(directory)
    r = read(directory / 'report.json')
    require(r['task'] == 'E6-T12f3' and type(r['gitHead']) is str and len(r['gitHead']) == 40
            and r['status'] == ('failed' if fault else 'passed') and r['guestExecution'] is False
            and r['currentGuest3dAdvertisement'] is False, 'exact isolated browser identity')
    require(r['trackedChanges'] == [] and same(r['browserErrors'], {'console': [], 'page': [], 'requests': []}),
            'frozen error-free browser sources')
    sources = {e['path']: e for e in r['sources']}
    served = {e['path']: e for e in r['servedFiles']}
    require(len(sources) == len(r['sources']) and len(served) == len(r['servedFiles']), 'unique complete source inventory')
    subprocess.run(['git','merge-base','--is-ancestor',r['gitHead'],head],cwd=ROOT,check=True,capture_output=True)
    for item in sources.values(): BASE.verify_source(item, r['gitHead']); BASE.verify_source(item, head)
    matches = []
    for name, item in served.items():
        require(type(item['size']) is int and item['size'] >= 0, 'typed served browser bytes')
        if name in sources: require(same(item, sources[name]), 'unchanged served support source')
        else:
            require(fault is not None and item['sha256'] == fault['wasm']['sha256']
                    and item['size'] == fault['wasm']['bytes'] and name.endswith('/' + fault['wasm']['path']),
                    'only sealed actual compiler fault bytes may differ')
            matches.append(name)
    wasm = 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'
    if fault:
        require(len(matches) == 1 and r['acceptance']['faultWasmSha256'] == fault['wasm']['sha256'],
                'browser consumed exactly the real source-fault compiler')
    else: require(wasm in served and same(served[wasm], sources[wasm]), 'browser consumed current fixed-memory compiler')
    browser = r['browser']
    require(browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled', 'actual hardware WebGL')
    qualified = {'browserVersion': browser['version'], **{k: r['host'][k] for k in ('platform', 'architecture', 'release')},
                 'renderer': r['acceptance']['renderer']['renderer']}
    require(qualified in read(ROOT / 'docs/gpu-3d-contract.json')['browserMatrix']['qualified'], 'qualified real hardware/browser')
    require(not any('--disable-gpu' in a or 'swiftshader' in a.lower() for a in browser['actualCommandLine']), 'real GPU launch')
    photo = r['failureScreenshot'] if fault else r['screenshot']
    raw = (directory / photo['path']).read_bytes()
    require(raw.startswith(b'\x89PNG') and sha(raw) == photo['sha256'], 'recorded physical browser screenshot')
    coverage = r['browserCoverage']; raw = (directory / coverage['path']).read_bytes()
    require(sha(raw) == coverage['sha256'], 'actual V8 coverage digest')
    exported = json.loads(raw)
    require(same(list(exported), ['schema', 'scripts']) and type(exported['schema']) is int and exported['schema'] == 1
            and [e['source'] for e in exported['scripts']] == COVERAGE, 'complete bounded runtime coverage inventory')
    for script in exported['scripts']:
        require(script['source'] in served and script['sha256'] == served[script['source']]['sha256'], 'served runtime counters')
        c = script['coverage']; require(set(c) == {'scriptId', 'url', 'functions'} and c['functions'], 'actual script coverage')
        for f in c['functions']:
            require(set(f) == {'functionName', 'ranges', 'isBlockCoverage'} and type(f['functionName']) is str
                    and type(f['isBlockCoverage']) is bool and f['ranges'], 'closed actual function coverage')
            for reg in f['ranges']:
                require(set(reg) == {'startOffset', 'endOffset', 'count'}
                        and all(type(reg[k]) is int and reg[k] >= 0 for k in reg) and reg['endOffset'] >= reg['startOffset'],
                        'typed real V8 counters')
        require(any(reg['count'] > 0 for f in c['functions'] for reg in f['ranges']), 'runtime path actually executed')
    return r


def verify_gpu(p,n,fixture,reference):
 require(p['schema']=='radial-domain-gpu-v1' and p['status']=='passed' and p['guestExecution'] is False and p['currentGuest3dAdvertisement'] is False,'isolated restricted hardware claim')
 require(same(p['fixture'],binding(ROOT/'renderer/virgl-shader/tests/radial-domain-cases.json')) and same(p['partners'],binding(ROOT/'renderer/virgl-command/tests/bounded-loops-shaders.json')),'literal fixture bytes')
 require(same(p['domainProof'],reference['proof']),'independent coefficient predicate')
 cases={e['name']:e for e in n['cases']};by_text={(e['stage'],e['text']):e for e in n['cases']}
 pair_text={(cases[e['vertexCaseName']]['text'],cases[e['fragmentCaseName']]['text']):e['result'] for e in n['pairs'] if e['vertexCaseName'] in cases and e['fragmentCaseName'] in cases}
 predictions=[(r['kernel']['case'],r['draws'],None) for r in reference['kernels']]
 for item in reference['lifecycle']:
  for schedule in [None,{'seed':0x6a194fb3,'commandsPerStep':1},{'seed':0xb35280d7,'commandsPerStep':3}]:
   predictions.append(('lifecycle-'+item['kind']+('-'+hex(schedule['seed'])[2:] if schedule else '-sync'),item['draws'],schedule))
 require(type(p['rigs']) is list and len(p['rigs'])==len(predictions)==21,'complete hardware and schedule matrix')
 total=0
 for rig,(name,draws,schedule) in zip(p['rigs'],predictions):
  require(rig['name']==name and same(rig.get('schedule'),schedule),'literal actual rig identity')
  require(len(rig['draws'])==len(draws),'every independent hardware path captured')
  require(type(rig['glObjects']['created']) is int and rig['glObjects']['created']>0 and type(rig['glObjects']['live']) is int and rig['glObjects']['live']==0,'all actual objects collected')
  require(all(type(v) is int and v==0 for v in list(rig['finalBudgets'].values())+list(rig['finalResourceBudgets'].values())),'all owned resource budgets released')
  native_sources=set()
  for t in rig['translations']:
   if t['kind']=='single':wanted=by_text[(t['request']['stage'],t['request']['text'])]['result'];native_sources.add(wanted['glsl'])
   else:wanted=pair_text[(t['request']['vertexText'],t['request']['fragmentText'])];native_sources.update(wanted[s]['glsl'] for s in ('vertex','fragment'))
   require(same(t['result'],wanted),'actual shared-bridge result equals complete native result')
  require([t['kind'] for t in rig['translations']]==(['single','single','pair'] if name.startswith('lifecycle-') else ['single','single'] if 'structural-port' in name else ['single','single','pair'])+(['single','pair','single','pair'] if name.startswith('lifecycle-') else []),'full normal single/pair calls')
  events=rig['glEvents'];creates=[e['id'] for e in events if e['call'].startswith('create') or e['call']=='fenceSync'];deletes=[e['id'] for e in events if e['call'].startswith('delete')]
  require(len(creates)==len(set(creates)) and len(deletes)==len(set(deletes)) and set(creates)==set(deletes) and rig['glObjects']['created']==len(creates),'actual object creation/deletion coverage')
  for e in events:
   if e['call']=='shaderSource':require(e['source'] in native_sources,'only exact actual compiler ESSL reaches hardware')
   if e['call'] in ('compileShader','linkProgram'):require(e['status'] is True,'real compile/link succeeded')
   if e['call']=='uniform4uiv':integers(e['words']);require(same(e['words'],e['observed']) and e['programId']==e['currentProgramId'],'actual uploaded uint bank read back on correct native program')
  require(len([e for e in events if e['call']=='drawElements'])==len(draws),'every actual draw is captured')
  mesh=rig['geometry'];require(mesh['rows'] is None and mesh['width']==mesh['height']==64 and mesh['stride']==32 and same(mesh['indexWords'],[0,1,2,0,2,3]),'actual full quad geometry')
  position=lambda f:struct.unpack('<I',struct.pack('<f',f))[0]
  wanted_vertices=[]
  for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:wanted_vertices += [position(x),position(y),0x30400000,0x30400000,0x3e800000,0x3f400000,0x3f000017,0x3e000000]
  integers(mesh['vertexWords'],32);integers(mesh['indexWords'],6);require(same(mesh['vertexWords'],wanted_vertices),'independent full-quad attributes')
  for item,capture,fmt,words in zip(rig['resourceInputs'][:2],rig['bufferReadbacks'],('I','H'),(mesh['vertexWords'],mesh['indexWords'])):
   physical=list(struct.pack('<'+fmt*len(words),*words));require(same(item['bytes'],physical) and same(capture['bytes'],physical) and capture['resourceId']==item['id'],'native immutable geometry bytes')
  for d,wanted in zip(rig['draws'],draws):
   require(type(d['coefficient']) is int and same({k:d[k] for k in ('coefficient','bank','oracle')},wanted),'independently recomputed literal predecessor, bank and numeric result')
   require(type(d['checkedPixels']) is int and d['checkedPixels']==4096,'typed whole framebuffer count')
   color=wanted['oracle']['color'];integers(d['rgbaBytes'],16384,255)
   require(d['rgbaBytes']==color*4096 and sha(bytes(d['rgbaBytes']))==d['rgbaSha256'],'all actual pixels equal independent admitted prediction')
   require(type(d['submissionIndex']) is int and 0<=d['submissionIndex']<len(rig['submissions']),'actual draw submission')
   submission=rig['submissions'][d['submissionIndex']];require(submission['result']['ok'] is True and same(submission['result']['draws'],[d['draw']]) and d['draw']['count']==6 and d['draw']['actualMinIndex']==0 and d['draw']['actualMaxIndex']==3 and d['draw']['framebuffer']['resourceId']==103,'actual indexed shared-renderer draw')
   uploads=[e for e in events[submission['eventsStart']:submission['eventsEnd']] if e['call']=='uniform4uiv'];require(uploads and all(same(e['words'],wanted['bank']) for e in uploads),'dispatch uploaded exactly the approved complete owned generation')
   require(all(same(u['words'],wanted['bank']) for u in d['uniforms']),'physical uniforms equal approved prefix')
   stages=[0,1] if name.startswith('lifecycle-') else [0 if d['kernel']['stage']=='vertex' else 1]
   for stage in stages:
    require(same(d['bindings']['constants'][stage],wanted['bank']),'draw retained exact bank identity and words')
    shader=d['bindings']['vertexShader' if stage==0 else 'fragmentShader'];require(d['program']['vertexGeneration' if stage==0 else 'fragmentGeneration']==shader['generation'],'approval belongs to selected shader generation')
   total+=4096
  if not name.startswith('lifecycle-'):require(not rig['attacks'] and not rig['lifecycle'] and not rig['yieldAttacks'],'kernel claim only admitted draws');continue
  kind=rig['kind'];require(len(rig['attacks'])==(30 if kind=='loop' else 28),'all finite, radial, complete-bank and combined-count failures')
  for a in rig['attacks']:
   integers(a['pixelsBefore'],16384,255);require(same(a['pixelsBefore'],a['pixelsAfter']) and same(a['before'],a['after']),'full before-effect rejection leaves state and framebuffer')
   r=a['result'];require(r['ok'] is False and type(r['appliedCommands']) is int and r['appliedCommands']==0,'no rejected draw command applied')
   expected='invalid-value' if a['name']=='nonfinite wire bank' else 'incomplete-draw' if a['name'].startswith('missing complete prefix') else 'constant-constraint-error' if a['name'].startswith('combined count') else 'constant-radial-domain-error'
   require(r['error']['code']==expected,'exact consumer boundary rejection')
   require(all(schedule is not None and e['call'] in ('fenceSync','fenceSchedule','clientWaitSync','deleteSync') for e in a['events']),'no allocation/link/index/uniform/draw effects before approval')
  stored=[x for x in rig['lifecycle'] if x['name']=='unsafe coefficient stored'];require(len(stored)==18,'both-stage raw coefficient replacements')
  for x in stored:
   require(x['result']['ok'] is True and x['after']['contexts'][0]['subContexts'][0]['bindings']['constants'][x['stage']][16]==x['word'],'replaced unsafe bank retained, never repaired')
   require(same(x['pixelsBefore'],x['pixelsAfter']) and not any(e['call']=='uniform4uiv' and e['name']==('vs' if x['stage']==0 else 'fs')+'const0[0]' for e in x['events']),'unsafe replacement cannot upload or change framebuffer')
  replacements=[x for x in rig['lifecycle'] if x['name']=='shader replacement'];require(len(replacements)==2,'both shader generations replaced')
  for x in replacements:
   a=x['before']['contexts'][0]['subContexts'][0];b=x['after']['contexts'][0]['subContexts'][0];old=a['bindings']['vertexShader' if x['stage']==0 else 'fragmentShader'];new=next(o for o in b['objects'] if o['handle']==old['handle'] and o['public'] is True);require(new['generation']!=old['generation'],'new public shader cannot borrow old generation')
  require(len([x for x in rig['lifecycle'] if x['name']=='explicit restoration'])==1,'explicit restoration exercised')
  require(len(rig['yieldAttacks'])==(1 if schedule else 0),'actual scheduled GPU index interference')
  if schedule:
   y=rig['yieldAttacks'][0];require(same(y['before'],y['after']) and [x['name'] for x in y['attempts']]==['begin','restore','destroy'] and all(x['result']['ok'] is False and x['result']['error']['code']=='busy' for x in y['attempts']),'busy mutations preserve the same prepared approval')
   require(y['nativePoison']['entries'] and all(x['observed']==x['words'] for x in y['nativePoison']['entries']),'actual native uniform poison observed during yield')
   fences=[e for e in events if e['call']=='fenceSchedule'];require(fences and any(e['withheld']>0 for e in fences),'actual varied nonblocking fence schedule')
  for submission in rig['submissions']:
   if 'inputAfter' in submission:require(all(x==255 for x in submission['inputAfter']),'caller packet bytes mutated after owned decode')
 require(type(p['drawCount']) is int and p['drawCount']==138 and type(p['checkedPixels']) is int and p['checkedPixels']==total==565248,'independent physical accounting')
 return {'rigs':21,'draws':138,'pixels':total,'domainFailures':258,'asyncSchedules':6}

def verify_domain(folder,n,reference):
 p=read(folder/'report.json');require(p['schema']=='radial-consumer-domain-v1' and p['status']=='passed' and p['guestExecution'] is False and p['gpuExecution'] is False,'actual consumer-only domain proof')
 for item in p['sources']:source(item,git('rev-parse','HEAD').decode().strip())
 require(same(p['proof'],reference['proof']) and len(p['results'])==12 and len(p['forgeries'])==164 and len(p['ownership'])==12 and len(p['combined'])==3,'complete domain, metadata and owned snapshot matrix')
 cases={e['name']:e for e in n['cases']};count=0
 for r,k in zip(p['results'],reference['kernels']):
  kernel=k['kernel'];require(same(r['kernel'],kernel) and same(r['result'],cases[kernel['case']]['result']),'actual compiler metadata equals full native result')
  md=r['result']['metadata'];require(r['parsed']['ok'] is True and same(r['parsed']['radialDomain'],md['constantRadialDomains'][0]),'compiler-derived closed radial policy')
  require(len(r['cases'])==20,'all independent rational witnesses')
  for actual,witness in zip(r['cases'],reference['proof']['cases']):
   require(type(actual['word']) is int and actual['word']==witness['word'],'literal boundary coefficient');integers(actual['bank'],kernel['count']*4)
   result=actual['result'];require(result['ok'] is witness['admitted'],'actual consumer versus independent rational domain')
   if result['ok']:require(same(result['words'],actual['bank']),'same owned finite words')
   else:require(result['error']['code']==('constant-radial-domain-error' if witness['finite'] else 'constant-domain-error'),'exact finite/coefficient obligation')
   count+=1
 for forgery in p['forgeries']:require(forgery['result']['ok'] is False and forgery['result']['error']['code']=='shader-domain-error','every modified contract rejected')
 for o in p['ownership']:require(o['callerAfter'][16]==0 and o['approved']['words'][16]==0x3f800000 and o['approved']['ok'] is True,'one owned immutable approval independent of caller mutation')
 for o in p['combined']:require(o['bank'][36]==19 and o['result']['ok'] is False and o['result']['error']['code']=='constant-constraint-error','simultaneous raw signed count not dropped')
 f=p['sabotage'];before=(ROOT/f['source']['path']).read_bytes();require(same(f['source'],binding(ROOT/f['source']['path'])) and before.count(f['before'].encode())==1,'one actual consumer source seam')
 require(f['before']=='if (magnitude < 0x3727c5ac)' and f['after']=='if (false && magnitude < 0x3727c5ac)','only coefficient guard removed')
 changed=before.replace(f['before'].encode(),f['after'].encode());require((folder/f['fault']['path']).read_bytes()==changed and same(f['fault'],binding(folder/f['fault']['path'],folder)),'actual sealed source mutation')
 require(f['bank'][16]==0x35800000 and f['result']['ok'] is True and same(f['result']['words'],f['bank']) and f['oracleAdmitted'] is False and f['caught']['name']=='AssertionError' and type(f['gpuDraws']) is int and f['gpuDraws']==0,'removed actual check admits counterexample, caught before unsafe GPU execution')
 return {'checks':count,'metadataForgeries':164,'ownership':12,'combined':3,'actualSourceFaultCaught':True}

def verify_probes(folder,head):
 import probes
 p=read(folder/'report.json');require(p['schema']=='radial-graph-probes-v1' and p['status']=='passed' and len(p['gitHead'])==40,'exact-source bounded coverage supplement')
 subprocess.run(['git','merge-base','--is-ancestor',p['gitHead'],head],cwd=ROOT,check=True,capture_output=True)
 for item in p['sources']:source(item,p['gitHead']);source(item,head)
 for item in p['records']:require(same(item,binding(folder/item['path'],folder)),'complete actual probe artifact')
 require(same(p['binary'],binding(folder/'native',folder)) and p['buildCommand']==['bash','build.sh','native'],'real instrumented native compiler')
 rows=probes.inputs();require(len(p['cases'])==len(rows)==12,'all named radial graph probes')
 for actual,wanted in zip(p['cases'],rows):
  require(same({k:actual[k] for k in wanted},wanted) and same(json.loads(actual['stdout']),actual['result']) and actual['result']['ok'] is wanted['predictedOk'],'predicted typed graph/version result and full native serialization')
  if wanted['predictedOk']:
   md=actual['result']['metadata'];require(md['profile']=='virgl-webgl2-raw-bits-v14' and md['constantRadialDomains'][0]['register']==4 and md['constantRadialDomains'][0]['component']==0 and md['constantRadialDomains'][0]['minimumMagnitude']==0x3727c5ac,'same explicit coefficient policy on nested/aliased graph')
  else:require(actual['result']['error']['code']=='unsupported-feature','unsafe certificate rejects')
 w=read(folder/'wasm.json');require(w['schema']=='radial-probe-wasm-v1' and w['status']=='passed' and w['nativeSha256']==sha((folder/'native.json').read_bytes()) and w['wasmSha256']==sha((ROOT/'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes()),'actual current Wasm supplement')
 require(same(w['cases'],[{k:r[k] for k in ('name','inputSha256','result')} for r in p['cases']]),'all full supplemental native/Wasm outcomes')
 x=read(folder/'coverage.json');require({Path(f['filename']).name for f in x['data'][0]['files']}=={'bridge.c','raw_bits.c'},'full actual compiler coverage source map')
 for item in p['coverage']['sources']:
  source({k:item[k] for k in ('path','bytes','sha256')},head);f=next(f for f in x['data'][0]['files'] if f['filename']==item['recordedFilename']);require(same(f['summary'],item['summary']),'actual bound supplemental source counters')
 fake={'sources':[{'bytes':s['bytes'],'summary':s['summary']} for s in p['coverage']['sources']],'records':p['records'],'nativeStack':{'files':[]}}
 native_receipt.held.coverage_primitives(fake,x)
 require(any(f['name']=='bridge.c:radial_recognize' and f['count']>0 for f in x['data'][0]['functions']),'actual radial parser/graph coverage')
 return {'cases':12,'positive':4,'negative':8,'nativeWasmParity':True}

def verify(output,head):
 output=Path(output);n=native_receipt.verify(output/'native',head);w=wasm_receipt.verify(output/'wasm',head,n)
 raw=subprocess.check_output(['node','tools/virgl-radial-domain/reference.mjs'],cwd=ROOT);require((output/'reference.json').read_bytes()==raw,'independent literal hardware/domain reference is not derived from GPU evidence');reference=json.loads(raw)
 fixture=read(ROOT/'renderer/virgl-shader/tests/radial-domain-cases.json');envelope=browser_envelope(output/'gpu',head);gpu=verify_gpu(envelope['acceptance'],n,fixture,reference);domain=verify_domain(output/'domain',n,reference);probes=verify_probes(output/'probes',head)
 sys.path.insert(0,str(ROOT/'tools/virgl-selected-lanes'))
 try:held=native_receipt.load('held_selected_gpu','tools/virgl-selected-lanes/receipt.py')
 finally:sys.path.pop(0)
 prior_head=read(output/'retained-selected/report.json')['gitHead']
 subprocess.run(['git','merge-base','--is-ancestor',prior_head,head],cwd=ROOT,check=True,capture_output=True)
 prior=held.browser_envelope(output/'retained-selected',prior_head)
 for item in prior['sources']:BASE.verify_source(item,head)
 oldraw=subprocess.check_output(['node','tools/virgl-selected-lanes/oracle.mjs'],cwd=ROOT);require((output/'retained-selected-oracle.json').read_bytes()==oldraw,'unchanged F2 literal oracle')
 old_gpu=held.verify_gpu(prior['acceptance'],{'cases':n['selectedCases'],'pairs':n['selectedPairs'],'loopCases':n['loopCases']},read(ROOT/'renderer/virgl-shader/tests/selected-lanes-cases.json'),json.loads(oldraw))
 paths=set(COVERAGE+['docs/gpu-3d-contract.json','Makefile','tools/verify-virgl-radial-domain.sh','tools/virgl-selected-lanes/receipt.py','tools/virgl-selected-lanes/oracle.mjs','tools/virgl-selected-lanes/shared.py','tools/virgl-selected-lanes/native_receipt.py','tools/virgl-selected-lanes/faults.py','tools/virgl-selected-lanes/retained.py','tools/virgl-constants/receipt.py','tools/virgl-bounded-loops/native_receipt.py'])
 for directory in (ROOT/'tools/virgl-radial-domain',ROOT/'renderer/virgl-shader'):
  paths.update(str(p.relative_to(ROOT)) for p in directory.rglob('*') if p.is_file() and not any(part.startswith('.') or part in ('build','__pycache__') for part in p.relative_to(directory).parts))
 paths.update(str(p.relative_to(ROOT)) for p in (ROOT/'renderer/virgl-command').glob('*.mjs'))
 sources=[binding(ROOT/p) for p in sorted(paths)];[source(s,head) for s in sources]
 production=read(ROOT/'docs/gpu-3d-contract.json')['production'];require(same(production,json.loads(git('show',native_receipt.producer.HELD_HEAD+':docs/gpu-3d-contract.json'))['production']),'guest graphics negotiation remains gated')
 if (output/'negative-receipts.json').exists():
  import receipt_attacks
  negative=read(output/'negative-receipts.json');names=['gpu/'+x for x in receipt_attacks.GPU_ATTACKS]+['wasm/'+x for x in receipt_attacks.WASM_ATTACKS]
  require(negative['schema']=='radial-negative-receipts-v1' and negative['status']=='passed' and [x['name'] for x in negative['results']]==names and all(x['outcome']=='rejected' and type(x['reason']) is str and x['reason'] for x in negative['results']),'all promoted physical and typed forgeries rejected')
  positive=(output/'positive-receipt.json').read_bytes();require(same(negative['positiveReceipt'],{'path':'receipt.json','bytes':len(positive),'sha256':sha(positive)}) and json.loads(positive)['gitHead']==head,'first exact-head positive proof bound')
 records=[binding(p,output) for p in sorted(output.rglob('*')) if p.is_file() and p.name not in ('receipt.json','acceptance.log')]
 return {'schema':'radial-domain-submission-v1','task':'E6-T12f3','status':'passed','gitHead':head,'heldHead':native_receipt.producer.HELD_HEAD,'guestExecution':False,'workloadCompatibilityClaimed':False,'production':production,'native':{k:n[k] for k in ('stats','layout','flow','recordedMaxima','compatibility')},'wasm':w,'gpu':gpu,'domain':domain,'probes':probes,'retainedGpu':old_gpu,'sources':sources,'records':records}

if __name__=='__main__':
 output=Path(sys.argv[1]).resolve();report=verify(output,git('rev-parse','HEAD').decode().strip());(output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('E6-T12f3 restricted radial admission evidence passed.')
