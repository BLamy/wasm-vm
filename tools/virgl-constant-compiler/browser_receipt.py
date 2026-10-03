"""Independent source, packet, real GL identity and complete GPU word receipts."""
import copy
import hashlib
import importlib.util
import json
import re
import struct
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('constant_compiler_math',Path(__file__).with_name('oracle.py'))
math=importlib.util.module_from_spec(spec);spec.loader.exec_module(math)
require=math.require
FIXTURE='renderer/virgl-command/tests/constant-compiler-shaders.json'
MODULE='renderer/virgl-command/tests/constant-compiler.mjs'
ORACLE='renderer/virgl-command/tests/constant-compiler-oracle.mjs'
RUNTIME=['renderer/virgl-shader/index.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs',MODULE,ORACLE]
SCHEDULES=[{'seed':0x7c1209ad,'commandsPerStep':1},{'seed':0xea016f35,'commandsPerStep':3}]
DECODER_BEFORE='this.require(Number.isFinite(value), "invalid-value", "Non-finite float field.");'
DECODER_AFTER='this.require(this.opcode === 12 || Number.isFinite(value), "invalid-value", "Non-finite float field.");'

def read(path):return json.loads(Path(path).read_bytes())
def sha(raw):return hashlib.sha256(raw).hexdigest()
def binding(path,base=ROOT):
    path=Path(path);raw=path.read_bytes();return {'path':str(path.relative_to(base)),'bytes':len(raw),'sha256':sha(raw)}
def word_bytes(words):return struct.pack('<'+'I'*len(words),*words)
def float_word(value):return struct.unpack('<I',struct.pack('<f',value))[0]
def finite(word):return type(word) is int and 0<=word<2**32 and (word>>23)&255!=255

def specialized_pair(vertex,fragment):
    vertex=copy.deepcopy(vertex);fragment=copy.deepcopy(fragment)
    inputs=sorted(fragment['metadata']['inputs'],key=lambda x:x['semanticIndex'])
    for output in vertex['metadata']['outputs']:
        if output['semantic']=='GENERIC':
            match=next((i for i in inputs if i['semanticIndex']==output['semanticIndex']),None)
            output['interpolation']=match['interpolation'] if match else 'smooth'
            if output['interpolation']=='flat':
                before,after=(f'   out  vec4 {output["name"]};',f' flat    out  vec4 {output["name"]};') if vertex['metadata']['profile']=='virgl-webgl2-straight-line-v5' else (f'smooth out vec4 {output["name"]};',f'flat out vec4 {output["name"]};')
                require(vertex['glsl'].count(before)==1,'one exact declared vertex interface specialization');vertex['glsl']=vertex['glsl'].replace(before,after)
    key='generic-interpolation-v1:'+';'.join(f'g{i["semanticIndex"]}/{i["componentMask"]}/{i["interpolation"]}' for i in inputs)
    vertex.pop('ok');fragment.pop('ok')
    return {'ok':True,'interfaceKey':key,'vertex':vertex,'fragment':fragment}

def translations(proof,fixture,cases,pairs,originals,fault_cases=None):
    expected={entry['name']:entry['result'] for entry in (fault_cases or [])} if fault_cases is not None else cases
    require(len(proof['shaderFixtures'])==len(fixture['shaders']),'complete stage inventory')
    by_body={}
    for item,entry in zip(fixture['shaders'],proof['shaderFixtures']):
        result=expected[item['name']]
        require(entry=={**item,'inputSha256':sha(item['text'].encode()),'result':result},'complete native/Wasm stage equality')
        require(result['metadata']['profile']==item['expected']['profile'],'actual compiler profile')
        if proof['mode']!='missing-contract':require(result['metadata'].get('constantDomains')==item['expected']['constantDomains'],'compiler-derived stage contract')
        by_body[(item['stage'],item['text'])]=result
    require(len(proof['pairFixtures'])==len(fixture['pairs']),'complete pair inventory')
    by_pair={}
    shaders={entry['name']:entry for entry in fixture['shaders']}
    for item,entry in zip(fixture['pairs'],proof['pairFixtures']):
        vertex,fragment=shaders[item['vertex']],shaders[item['fragment']]
        request={'vertexText':vertex['text'],'fragmentText':fragment['text']}
        derived=specialized_pair(expected[vertex['name']],expected[fragment['name']])
        result=pairs[item['name']] if fault_cases is None else derived
        require(result==derived,'independent established flat pair specialization')
        require(entry=={**item,'request':request,'result':result},'complete pair result equality')
        require(result['interfaceKey']==item['interfaceKey'],'authored exact interface key')
        by_pair[(vertex['text'],fragment['text'])]=result
    require(len(proof['negativeFixtures'])==len(fixture['negativeCases']),'complete rejected compiler inventory')
    for item,entry in zip(fixture['negativeCases'],proof['negativeFixtures']):
        require(entry=={**item,'result':cases[item['name']]} and entry['result']['ok'] is False,'unchanged rejected full result')
        by_body[(item['stage'],item['text'])]=entry['result']
    require(len(proof['corpus'])==19 and sum(entry['result']['ok'] for entry in proof['corpus'])==12,'unchanged 19 original outcomes')
    for entry in proof['corpus']:
        require(sha((ROOT/entry['path']).read_bytes())==entry['sha256'],'original immutable body')
        if originals:require(entry['result']==originals[entry['sha256']],'full original native/Wasm equality')
    for rig in proof['rigs']:
        require(rig['translations'],'renderer really uses compiler bridge')
        for entry in rig['translations']:
            request=entry['request']
            result=(by_body[(request['stage'],request['text'])] if entry['kind']=='single' else by_pair[(request['vertexText'],request['fragmentText'])])
            require(set(entry)=={'kind','request','result'} and entry['result']==result,'bridge records and returns identical compiler result with no wrapper')
    return by_body,by_pair

def geometry(rig,rows,fixture):
    pos,sel,inp,indices=[],[],[],[]
    cells=[(None,None)] if rows is None else [(page,bit) for page in range(rows) for bit in range(32)]
    for page,bit in cells:
        first=len(pos)//2
        for dx,dy in ((0,0),(1,0),(1,1),(0,1)):
            x,y=(-1+2*dx,-1+2*dy) if rows is None else (-1+(bit+dx)/16,-1+(page+dy)/16)
            pos.extend((float_word(x),float_word(y)))
            sel.extend((((96+(bit or 0))<<23)|0x400000,((96+(page or 0))<<23)|0x400000))
            inp.extend((0x3e800000,0x3f400000))
        indices.extend((first,first+1,first+2,first,first+2,first+3))
    interleaved=[]
    for i in range(len(pos)//2):interleaved.extend(pos[2*i:2*i+2]+sel[2*i:2*i+2]+inp[2*i:2*i+2])
    expected={'rows':rows,'width':64,'height':64,'stride':24,'positionWords':pos,'selectorWords':sel,'inputWords':inp,'vertexWords':interleaved,'indexWords':indices}
    require(rig['geometry']==expected,'independently reconstructed exact dyadic mesh and normal selector bytes')
    vertex=word_bytes(interleaved);index=struct.pack('<'+'H'*len(indices),*indices)
    wanted=[(101,0,64,16,len(vertex),1,vertex),(102,0,64,32,len(index),1,index),(103,2,67,10,64,64,bytes(16384))]
    wanted += [(104+i,2,67,10,2,2,bytes(sample['bytes'])) for i,sample in enumerate(fixture['vectors']['textures'])]
    require(len(rig['resourceInputs'])==len(wanted),'all actual resource inputs')
    for entry,(identity,target,fmt,bind,width,height,raw) in zip(rig['resourceInputs'],wanted):
        require(entry=={'id':identity,'target':target,'format':fmt,'bind':bind,'width':width,'height':height,'bytes':list(raw),**({'slot':fixture['vectors']['textures'][identity-104]['slot']} if identity>=104 else {})},'literal uploaded resources')
    require(len(rig['bufferReadbacks'])==2 and len(rig['textureReadbacks'])==2,'actual input readbacks')
    for entry,data in zip(rig['bufferReadbacks'],(vertex,index)):
        require(bytes(entry['bytes'])==data and entry['nativeId'].startswith('Buffer:'),'actual native input buffer bytes')
    for entry,sample in zip(rig['textureReadbacks'],fixture['vectors']['textures']):
        require(entry['bytes']==sample['bytes'] and entry['nativeId'].startswith('Texture:'),'actual sampled texture bytes')
    return expected

def native_events(rig):
    created,deleted,sources,compiled,programs,linked={},set(),{},set(),{},set()
    events=rig['glEvents']
    allowed_sources=set()
    for translation in rig['translations']:
        result=translation['result']
        if result['ok']:
            allowed_sources.update([result['glsl']] if translation['kind']=='single' else [result['vertex']['glsl'],result['fragment']['glsl']])
    require([e['sequence'] for e in events]==list(range(len(events))),'complete ordered native events')
    for e in events:
        call=e['call']
        if call.startswith('create') or call=='fenceSync':require(e['id'] not in created,'unique native object');created[e['id']]=call
        elif call.startswith('delete'):require(e['id'] in created and e['id'] not in deleted,'native object released exactly once');deleted.add(e['id'])
        elif call=='shaderSource':require(created[e['id']]=='createShader' and e['source'] in allowed_sources,'every actual shader source equals an unmodified compiler result');sources[e['id']]=e['source']
        elif call=='compileShader':require(e['id'] in sources and e['status'] is True,'actual native shader compile');compiled.add(e['id'])
        elif call=='attachShader':require(e['shaderId'] in compiled and created[e['programId']]=='createProgram','native shader attachment');programs.setdefault(e['programId'],[]).append(sources[e['shaderId']])
        elif call=='linkProgram':require(e['status'] is True and len(programs[e['id']])==2,'actual native pair link');linked.add(e['id'])
        elif call=='uniform4uiv':require(e['programId']==e['currentProgramId'] and e['programId'] in linked and e['observed']==e['words'] and 0<len(e['words'])<=184 and all(map(finite,e['words'])),'actual finite unmodified native uvec4 upload')
        elif call=='drawElements':require(e['programId'] in linked and e['arguments']==[4,len(rig['geometry']['indexWords']),5123,0],'actual indexed atlas/coupled draw')
        elif call in ('samplerParameteri','samplerParameterf'):require(e['value']==e['observed'],'actual native sampler parameter')
        require(call!='finish','nonblocking GPU completion')
    require(set(created)==deleted and rig['glObjects']=={'created':len(created),'live':0},'all owned native objects truly collected')
    require(all(v==0 for v in rig['finalBudgets'].values()) and all(v==0 for v in rig['finalResourceBudgets'].values()),'all CPU/resource budgets released')
    require(sum(e['call']=='drawElements' for e in events)==len(rig['atlases'])+len(rig['draws']),'every actual draw has a complete framebuffer')
    for entry in rig['bufferReadbacks']+rig['textureReadbacks']:require(entry['nativeId'] in created,'input readback belongs to actual allocated resource')
    return programs

def draw_identity(rig,draw,words,sources,programs):
    sub=rig['submissions'][draw['submissionIndex']];events=rig['glEvents'][sub['eventsStart']:sub['eventsEnd']]
    dispatch=[e for e in events if e['call']=='drawElements']
    require(sub['result']['ok'] is True and sub['result']['draws']==[draw['draw']] and len(dispatch)==1,'capture belongs to actual successful draw submission')
    require(dispatch[0]['programId']==draw['nativeProgramId'] and programs[draw['nativeProgramId']]==sources,'attached native shader sources equal full real compiler pair output')
    p,b,d=draw['program'],draw['bindings'],draw['draw']
    require(p['vertexGeneration']==b['vertexShader']['generation'] and p['fragmentGeneration']==b['fragmentShader']['generation'] and d['vertexShader']==b['vertexShader'] and d['fragmentShader']==b['fragmentShader'],'same checked shader generations at native dispatch')
    require(p['key']==f'{p["vertexGeneration"]}:{p["fragmentGeneration"]}:{p["interfaceKey"]}','actual bounded program identity')
    require(d['contextId']==draw['contextId']==sub['contextId']==1 and d['subContextId']==draw['subContextId']==0 and d['subContextGeneration']==draw['subContextGeneration'],'same checked context/subcontext identity')
    require(d['count']==len(rig['geometry']['indexWords']) and d['indexByteLength']==2*d['count'] and d['actualMinIndex']==0 and d['actualMaxIndex']==len(rig['geometry']['positionWords'])//2-1 and d['indexResourceId']==102 and d['framebuffer']['resourceId']==103 and d['framebuffer']['width']==d['framebuffer']['height']==64,'actual indexed fetches and target cover authored mesh')
    require(len(draw['uniforms'])==len(p['reflection']['uniforms']),'complete uniform reflection')
    for u,ref in zip(draw['uniforms'],p['reflection']['uniforms']):
        require({k:v for k,v in u.items() if k!='words'}==ref,'native readback matches selected reflection')
        stage=0 if u['stage']=='vertex' else 1;count=u['uploadCount']*4
        require(u['name']==('vsconst0[0]' if stage==0 else 'fsconst0[0]') and u['type']=='uvec4[]' and u['encoding']=='float32-bits' and u['count']==46 and 0<u['activeCount']<=46 and u['uploadCount']==u['activeCount'],'real conditional uvec4 declaration/reflection')
        require(u['words']==words[stage][:count] and b['constants'][stage]==words[stage],'current bank equals independent packet/native readback')
        preceding=[e for e in events if e['call']=='uniform4uiv' and e['name']==u['name'] and e['sequence']<dispatch[0]['sequence']]
        require(preceding and preceding[-1]['programId']==draw['nativeProgramId'] and preceding[-1]['words']==words[stage][:count],'checked immutable prefix uploaded immediately before draw')
    require(len(draw['rgbaBytes'])==16384 and sha(bytes(draw['rgbaBytes']))==draw['rgbaSha256'],'complete actual framebuffer binding')


def atlas(draw,kernel,vector,fixture,failure=False):
    require(draw['kernel']==kernel['name'] and draw['vector']==vector and draw['checkedPixels']==4096,'authored kernel/vector and all-pixel count')
    pixels=draw['rgbaBytes'];words=[[0]*4 for _ in kernel['pages']]
    for y in range(64):
        for x in range(64):
            row,bit=y//2,x//2;pixel=pixels[(64*y+x)*4:(64*y+x+1)*4]
            if row>=len(words):require(pixel==[0,0,255,255],'every unused atlas pixel remains clear');continue
            require(all(v in (0,255) for v in pixel),'all actual bitplane pixels are endpoints')
            anchor=pixels[(64*row*2+bit*2)*4:(64*row*2+bit*2+1)*4]
            require(pixel==anchor,'all four pixels of each bit/lane cell agree')
            if x%2==y%2==0:
                for lane,value in enumerate(pixel):words[row][lane]|=(value//255)<<bit
    expected=math.pages(kernel,vector,fixture);failures=[]
    require(len(draw['pages'])==len(kernel['pages']),'all result/raw/orientation pages recorded')
    for row,(definition,entry,actual,oracle) in enumerate(zip(kernel['pages'],draw['pages'],words,expected)):
        observations=[math.observe(value,bits) for value,bits in zip(oracle,actual)]
        require(entry=={**definition,'observedWords':actual,'observations':observations},'independent full-word and rational GPU observation')
        if definition['name'] in ('rcp','rsq'):require(actual==[actual[0]]*4,'actual positive normal scalar result broadcasts identically')
        for lane,observation in enumerate(observations):
            if not observation['accepted']:failures.append({'page':row,'lane':lane,'name':definition['name'],'observation':observation})
    require(draw.get('failures',[])==failures and bool(failures)==failure,'actual independent numerical fault, not a failure string')
    require(all(not any(e['page']==row for e in failures) for row in range(3)),'raw constant pages and literal orientation are exact even under numeric fault')
    return {'pixels':4096,'words':len(words)*4,'mismatches':len(failures)}


def envelope(directory,head,mode,fault_manifest,preview=False):
    report=read(directory/'report.json');failed=mode in ('missing-contract','numeric-index')
    require(report['schema']==1 and report['task']=='E6-T12e6b' and report['gitHead']==head and report['mode']==mode and report['status']==('failed' if failed else 'passed'),'browser exact head/mode/outcome')
    require((preview or report['trackedChanges']==[]) and report['guestExecution'] is False and report['trustedHostMetadataWrapper'] is False and report['currentGuest3dAdvertisement'] is False,'frozen real compiler proof; production off')
    require(report['browserErrors']=={'console':[],'page':[],'requests':[]},'zero console/page/request errors')
    sources={}
    for item in report['sources']:
        raw=(ROOT/item['path']).read_bytes();require(item['size']==len(raw) and item['sha256']==sha(raw),'all browser source bytes remain bound')
        require(item['path'] not in sources or sources[item['path']]==item,'consistent source bindings');sources[item['path']]=item
    mutations=[]
    if mode=='decoder-bypass':
        path='renderer/virgl-command/decoder.mjs';raw=(ROOT/path).read_bytes();require(raw.count(DECODER_BEFORE.encode())==1,'unique SET-only finite fault seam')
        mutations=[{'path':path,'before':DECODER_BEFORE,'after':DECODER_AFTER,'matches':1,'originalSha256':sha(raw),'servedSha256':sha(raw.replace(DECODER_BEFORE.encode(),DECODER_AFTER.encode()))}]
    require(report['mutations']==mutations,'only the named decoder source alteration')
    require(report['faultManifest']==(fault_manifest if failed else None),'complete selected fault artifact manifest')
    if failed:
        fault_directory=Path(fault_manifest['outputDirectory']) if preview else directory.parent/'fault-artifacts'
        manifest_path=fault_directory/'manifest.json';raw=manifest_path.read_bytes()
        require(report['faultManifestBinding']['sha256']==sha(raw) and report['faultManifestBinding']['bytes']==len(raw),'served fault manifest bytes')
    served={item['path']:item for item in report['servedFiles']};require(len(served)==len(report['servedFiles']),'unique actual served paths')
    for path,item in served.items():
        require(path in sources,'every served byte is source bound')
        raw=(ROOT/path).read_bytes()
        if mode=='decoder-bypass' and path==mutations[0]['path']:raw=raw.replace(DECODER_BEFORE.encode(),DECODER_AFTER.encode())
        if failed and path in ('renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'):
            kind='module' if path.endswith('.mjs') else 'wasm';artifact=fault_manifest['modes'][mode]['artifacts'][kind]
            raw=(fault_directory/artifact['path']).read_bytes();require(sha(raw)==artifact['sha256'] and len(raw)==artifact['bytes'],'actual isolated compiler fault artifact')
        require(item['sha256']==sha(raw) and item['size']==len(raw),'exact actual served bytes')
    require(set(RUNTIME+[FIXTURE,'renderer/virgl-shader/build/wasm/virgl-shader.wasm'])<=set(served),'all real renderer/compiler/fixture modules consumed')
    coverage=report['browserCoverage'];raw=(directory/coverage['path']).read_bytes();require(sha(raw)==coverage['sha256'],'actual V8 coverage artifact')
    scripts=json.loads(raw)['scripts'];require({entry['source'] for entry in scripts}==set(RUNTIME),'coverage includes all new browser helpers and real pipeline')
    for entry in scripts:require(entry['sha256']==served[entry['source']]['sha256'] and entry['originalSha256']==sources[entry['source']]['sha256'] and any(any(r['count']>0 for r in f['ranges']) for f in entry['coverage']['functions']),'actual executed source-bound browser coverage')
    screenshot=report['failureScreenshot' if failed else 'screenshot'];require(sha((directory/screenshot['path']).read_bytes())==screenshot['sha256'],'actual final GPU screenshot')
    b=report['browser'];require(b['launch']['headless'] is False and b['gpu']['featureStatus'][b['webglFeature']]=='enabled' and not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu',arg,re.I) for arg in b['actualCommandLine']),'real headed hardware GPU')
    return report


def verify_proof(proof,fixture,cases,pairs,originals,fault_cases=None):
    require(proof['schema']=='wasm-vm-constant-compiler-browser-v1' and proof['trustedHostMetadataWrapper'] is False and proof['productionVirgl'] is False and proof['guestExecution'] is False,'honest conditional compiler boundary')
    require(proof['fixture']==binding(ROOT/FIXTURE),'complete fixture binding')
    by_body,by_pair=translations(proof,fixture,cases,pairs,originals,fault_cases)
    mode=proof['mode'];kernel_map={k['name']:k for k in fixture['kernels']}
    names=([k['name'] for k in fixture['kernels']]+['coupled-sync']+[f'coupled-async-{s["seed"]:x}' for s in SCHEDULES] if mode=='normal' else ['coupled-sync'] if mode=='decoder-bypass' else ['missing-contract'] if mode=='missing-contract' else ['arithmetic-vertex'])
    require([r['name'] for r in proof['rigs']]==names,'complete bounded ordered compiler workload')
    counts={'draws':0,'pixels':0,'words':0,'mismatches':0,'fences':0,'withheldPolls':0,'rejections':0}
    spec=importlib.util.spec_from_file_location('constant_compiler_lifecycle',Path(__file__).with_name('lifecycle_receipt.py'));life=importlib.util.module_from_spec(spec);spec.loader.exec_module(life)
    for rig in proof['rigs']:
        kernel=kernel_map.get(rig['name']);geometry(rig,len(kernel['pages']) if kernel else None,fixture);programs=native_events(rig)
        schedule=next((s for s in SCHEDULES if rig['name']==f'coupled-async-{s["seed"]:x}'),None);require(rig.get('schedule')==schedule,'declared independent async schedules')
        summary=life.verify(rig,mode,globals())
        for key in ('fences','withheldPolls','rejections'):counts[key]+=summary[key]
        if kernel:
            vectors=fixture['vectors'][kernel['vectorKey']][:1 if mode=='numeric-index' else None]
            require(len(rig['atlases'])==len(vectors) and rig['draws']==[],'each authored vector actually draws one complete atlas')
            pair=next(p for p in fixture['pairs'] if p['name']==kernel['pair']);shaders={s['name']:s for s in fixture['shaders']};translated=by_pair[(shaders[pair['vertex']]['text'],shaders[pair['fragment']]['text'])]
            for draw,vector in zip(rig['atlases'],vectors):
                draw_identity(rig,draw,[math.bank(vector)]*2,[translated['vertex']['glsl'],translated['fragment']['glsl']],programs)
                result=atlas(draw,kernel,vector,fixture,mode=='numeric-index');counts['draws']+=1
                for key,value in result.items():counts[key]+=value
                if kernel['family']=='texture':
                    require([(v['index'],v['name'],v['unit']) for v in draw['program']['reflection']['samplers']]==[(0,'fssamp0',0),(7,'fssamp7',7)],'actual sampler 0/7 reflection and stage units')
                    events=rig['glEvents'][:rig['submissions'][draw['submissionIndex']]['eventsEnd']]
                    for slot,resource in ((0,104),(7,105)):
                        wanted=next(r for r in rig['textureReadbacks'] if r['resourceId']==resource)['nativeId'];bound=[e for e in events if e['call']=='bindTexture' and e['unit']==33984+slot]
                        require(bound and bound[-1]['id']==wanted,'actual native texture bound at reflected sampler slot')
        elif mode=='missing-contract':
            e=rig['guardFailure'];require(e['result']['ok'] is False and e['result']['error']['code']=='shader-domain-error' and e['result']['appliedCommands']==0 and e['before']==e['after'] and e['events']==[],'real omitted contract rejected before native shader allocation')
            require(rig['atlases']==rig['draws']==[],'missing-contract proof dispatches nothing')
        else:
            vectors=([fixture['vectors']['coupled'][0]]*2 if mode=='decoder-bypass' else [fixture['vectors']['coupled'][i] for i in (0,1,0)])
            require(rig['atlases']==[] and len(rig['draws'])==len(vectors),'coupled A/B/A or bypass recovery draw sequence')
            shaders={s['name']:s for s in fixture['shaders']};translated=by_pair[(shaders['coupled-vertex']['text'],shaders['coupled-fragment']['text'])]
            for draw,vector in zip(rig['draws'],vectors):
                require(draw['vector']==vector,'literal current coupled input')
                draw_identity(rig,draw,[math.bank(vector['vertex']),math.bank(vector['fragment'])],[translated['vertex']['glsl'],translated['fragment']['glsl']],programs)
                rectangle,color=math.coupled(vector);x0,y0,w,h=rectangle
                expected=[channel for y in range(64) for x in range(64) for channel in (color if x0<=x<x0+w and y0<=y<y0+h else [0,0,255,255])]
                require(draw['rectangle']==rectangle and draw['color']==color and draw['rgbaBytes']==expected and draw['checkedPixels']==4096,'independent exact geometry and every coupled pixel')
                counts['draws']+=1;counts['pixels']+=4096
            if mode=='normal':require(len(rig['yieldAttacks'])==(1 if schedule else 0) and len(rig['poison'])==(2 if schedule else 1),'actual restore/yield native state poisoning')
    if mode in ('normal','decoder-bypass'):
        require(proof['status']=='passed' and proof['drawCount']==counts['draws']==(27 if mode=='normal' else 2) and proof['capturedWords']==counts['words'] and proof['checkedPixels']==counts['pixels'],'honest independently measured clean counts')
    else:
        require(proof['status']=='failed','intended source fault is an explicit failing proof')
        message='actual atlas numerical word differs from independent oracle' if mode=='numeric-index' else 'missing-contract source fault rejected by shared renderer'
        require(message in proof['failure']['message'],'source fault failure follows measured counterexample')
    return counts


def verify(output,head,native_report,fault_manifest,*,preview=False):
    output=Path(output);fixture=read(ROOT/FIXTURE)
    cases={e['name']:e['result'] for e in native_report['cases']};pairs={e['name']:e['result'] for e in native_report['pairs']}
    originals={e.get('sha256',e.get('inputSha256')):e['result'] for e in native_report.get('originals',[])}
    require(len(originals)==19,'native counterpart of all original bodies')
    records=[];sources={};summaries=[]
    for directory,mode in [('hardware','normal'),('decoder-bypass','decoder-bypass'),('sabotage-missing-contract','missing-contract'),('sabotage-numeric-index','numeric-index')]:
        root=output/directory;report=envelope(root,head,mode,fault_manifest,preview=preview);fault_cases=None
        if mode in ('missing-contract','numeric-index'):
            entry=fault_manifest['modes'][mode]['nativeTranslations'];fault_directory=Path(fault_manifest['outputDirectory']) if preview else output/'fault-artifacts';path=fault_directory/entry['path'];raw=path.read_bytes();require(sha(raw)==entry['sha256'] and len(raw)==entry['bytes'],'full isolated fault native stage transcript');fault_cases=json.loads(raw)
        summary=verify_proof(report['acceptance'],fixture,cases,pairs,originals,fault_cases)
        require(report['status']==report['acceptance']['status'],'inner/outer actual acceptance outcome')
        summaries.append({'mode':mode,**summary,'report':binding(root/'report.json',output)})
        for item in report['sources']:sources[item['path']]={'path':item['path'],'bytes':item['size'],'sha256':item['sha256']}
        for path in sorted(root.iterdir()):
            if path.is_file():records.append(binding(path,output))
    for path in (Path(__file__).resolve(),Path(__file__).with_name('oracle.py'),Path(__file__).with_name('lifecycle_receipt.py')):sources[str(path.relative_to(ROOT))]=binding(path)
    return {'status':'passed','preview':preview,'sources':list(sources.values()),'records':records,'modes':summaries}
