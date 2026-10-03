"""Reconstruct branch words and literal colors from complete actual GPU evidence."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess

ROOT=Path(__file__).resolve().parents[2]
HELD='26ed74a31e0ee3c1d43b4e174c8096d67898d920'

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
math=module('structured_literal_oracle',Path(__file__).with_name('oracle.py'))
legacy=module('held_constant_compiler_browser',ROOT/'tools/virgl-constant-compiler/browser_receipt.py')
life=module('held_constant_compiler_lifecycle',ROOT/'tools/virgl-constant-compiler/lifecycle_receipt.py')
require=math.require
FIXTURE='renderer/virgl-command/tests/structured-conditionals-shaders.json'
MODULE='renderer/virgl-command/tests/structured-conditionals.mjs'
ORACLE='renderer/virgl-command/tests/structured-conditionals-oracle.mjs'
RUNTIME=['renderer/virgl-shader/index.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs',MODULE,ORACLE]
SCHEDULES=[{'seed':0x7c1209ad,'commandsPerStep':1},{'seed':0xea016f35,'commandsPerStep':3}]
# Authored dyadic colors are independently checked against the literal programs below.
COLORS=[[159,48,64,255],[48,96,143,96],[159,96,16,255],[128,128,80,143]]
MOV_COLORS=[[128,32,0,255],[128,32,0,255],[64,191,0,255],[64,191,0,255]]

def read(path):return json.loads(Path(path).read_bytes())
def sha(raw):return hashlib.sha256(raw).hexdigest()
def binding(path,base=ROOT):
    path=Path(path);raw=path.read_bytes();return {'path':str(path.relative_to(base)),'bytes':len(raw),'sha256':sha(raw)}
def finite(word):return type(word)is int and 0<=word<2**32 and (word>>23)&255!=255


def geometry(rig,rows):
    positions=[];selectors=[];inputs=[];others=[];indices=[]
    cells=[(0,0)] if rows is None else [(page,bit) for page in range(rows) for bit in range(32)]
    for page,bit in cells:
        first=len(positions)//2
        for dx,dy in ((0,0),(1,0),(1,1),(0,1)):
            x,y=(-1+2*dx,-1+2*dy) if rows is None else (-1+(bit+dx)/16,-1+(page+dy)/16)
            positions.extend((math.float_word(x),math.float_word(y)));selectors.extend((((96+bit)<<23)|0x400000,((96+page)<<23)|0x400000));inputs.extend((0x3e800000,0x3f400000));others.extend((0x3f000000,0x3e000000))
        indices.extend((first,first+1,first+2,first,first+2,first+3))
    vertices=[]
    for i in range(len(positions)//2):vertices.extend(positions[2*i:2*i+2]+selectors[2*i:2*i+2]+inputs[2*i:2*i+2]+others[2*i:2*i+2])
    expected={'rows':rows,'width':64,'height':64,'stride':32,'positionWords':positions,'selectorWords':selectors,'inputWords':inputs,'otherWords':others,'vertexWords':vertices,'indexWords':indices}
    require(rig['geometry']==expected,'literal position/selector/two independent input meshes')
    raw_vertices=struct.pack('<'+'I'*len(vertices),*vertices);raw_indices=struct.pack('<'+'H'*len(indices),*indices)
    wanted=[(101,0,64,16,len(raw_vertices),1,raw_vertices),(102,0,64,32,len(raw_indices),1,raw_indices),(103,2,67,10,64,64,bytes(16384))]
    require(len(rig['resourceInputs'])==3,'exact three resource definitions')
    for entry,(identity,target,fmt,bind,width,height,raw) in zip(rig['resourceInputs'],wanted):
        require(entry=={'id':identity,'target':target,'format':fmt,'bind':bind,'width':width,'height':height,'bytes':list(raw)},'all literal decoded resource bytes')
    require(len(rig['bufferReadbacks'])==2 and rig['textureReadbacks']==[],'two actual independent native buffer readbacks')
    for entry,raw in zip(rig['bufferReadbacks'],(raw_vertices,raw_indices)):require(bytes(entry['bytes'])==raw and entry['nativeId'].startswith('Buffer:'),'actual uploaded native inputs')


def atlas(draw,kernel,vector,fixture,failure=False):
    require(draw['kernel']==kernel['name'] and draw['vector']==vector and draw['checkedPixels']==4096,'exact literal kernel/vector capture')
    pixels=draw['rgbaBytes'];actual=[[0]*4 for _ in kernel['pages']]
    for y in range(64):
        for x in range(64):
            page,bit=y//2,x//2;pixel=pixels[4*(64*y+x):4*(64*y+x+1)]
            if page>=len(actual):require(pixel==[0,0,255,255],'unused full atlas cells remain clear');continue
            require(all(v in (0,255) for v in pixel),'actual endpoint bitplane bytes')
            anchor=pixels[4*(64*page*2+bit*2):4*(64*page*2+bit*2+1)]
            require(pixel==anchor,'all four pixels in each actual bit cell agree')
            if x%2==0 and y%2==0:
                for lane,v in enumerate(pixel):actual[page][lane]|=(v//255)<<bit
    expected,branches=math.pages(kernel,vector,fixture)
    require(draw['branches']==branches,'independently recursively selected literal branches')
    if kernel['family']=='raw':
        a=[1,2143289345,2147483648,4294967295];b=[8388607,1065353216,0,305419896]
        require(expected[1:9]==[b,a,a,a,a,b,a,a],'explicit unsigned x-lane truth table including y-only false and swizzled y true')
    failures=[]
    require(len(draw['pages'])==len(expected),'all declared full-word pages')
    for row,(definition,entry,wanted,words) in enumerate(zip(kernel['pages'],draw['pages'],expected,actual)):
        require(entry=={**definition,'observedWords':words,'expectedWords':wanted},'producer expectation independently reconstructed from literal TGSI')
        for lane,(a,b) in enumerate(zip(wanted,words)):
            if a!=b:failures.append({'page':row,'lane':lane,'name':definition['name'],'expectedWord':a,'observedWord':b})
    require(draw.get('failures',[])==failures and bool(failures)==failure,'branch source fault has a measured raw-word counterexample')
    require(not any(f['page']==0 for f in failures),'literal orientation remains exact under branch fault')
    return {'pixels':4096,'words':4*len(actual),'mismatches':len(failures)}


def color(draw,vector,family,fixture):
    index=fixture['vectors']['branches'].index(vector);wanted=(COLORS if family=='coupled' else MOV_COLORS)[index]
    require(vector['coupledColor']==COLORS[index] and vector['movColor']==MOV_COLORS[index],'independently authored literal per-lane colors')
    inputs={0:[0,0,0,0x3f800000],1:[0,0,0,0x3f800000],2:[0x3e800000,0x3f400000,0,0x3f800000],3:[0x3f000000,0x3e000000,0,0x3f800000]}
    if family=='coupled':
        vertex=next(s for s in fixture['shaders'] if s['name']=='coupled-vertex');fragment=next(s for s in fixture['shaders'] if s['name']=='coupled-fragment')
        source,_,_=math.interpret(vertex['text'],inputs,math.bank(vector));inputs[1]=[source('OUT[1]',lane) for lane in range(4)]
        source,_,_=math.interpret(fragment['text'],inputs,math.bank(vector));words=[source('OUT[0]',lane) for lane in range(4)]
    else:
        shader=next(s for s in fixture['shaders'] if s['name']=='mov-color-fragment');source,_,_=math.interpret(shader['text'],inputs,math.bank(vector));words=[source('OUT[0]',lane) for lane in range(4)]
    independently=[int(min(1,max(0,math.rational(word)))*255+math.Fraction(1,2)) for word in words]
    require(independently==wanted,'literal table agrees with recursive actual branch semantics')
    require(draw['family']==family and draw['vector']==vector and draw['color']==wanted and draw['checkedPixels']==4096 and draw['rgbaBytes']==wanted*4096,'every native color pixel matches literal branch outcome')


def envelope(directory,head,mode,fault_manifest,preview):
    report=read(directory/'report.json');failed=mode=='branch-polarity'
    require(report['schema']==1 and report['task']=='E6-T12e7' and report['gitHead']==head and report['mode']==mode and report['status']==('failed' if failed else 'passed'),'browser exact-head mode and outcome')
    require((preview or report['trackedChanges']==[]) and report['guestExecution']is False and report['trustedHostMetadataWrapper']is False and report['currentGuest3dAdvertisement']is False,'frozen compiler proof with production disabled')
    require(report['browserErrors']=={'console':[],'page':[],'requests':[]},'zero native browser errors')
    sources={}
    for entry in report['sources']:
        raw=(ROOT/entry['path']).read_bytes();require(entry['size']==len(raw) and entry['sha256']==sha(raw),'actual source binding')
        require(entry['path'] not in sources or sources[entry['path']]==entry,'unique consistent source identity');sources[entry['path']]=entry
    require(report['faultManifest']==(fault_manifest if failed else None),'exact selected isolated compiler fault manifest')
    fault_directory=Path(fault_manifest['outputDirectory']) if preview else directory.parent/'fault-artifacts'
    if failed:
        raw=(fault_directory/'manifest.json').read_bytes();require(report['faultManifestBinding']['sha256']==sha(raw) and report['faultManifestBinding']['bytes']==len(raw),'actual served fault manifest')
    else:require(report['faultManifestBinding']is None,'clean run has no artifact substitution')
    served={item['path']:item for item in report['servedFiles']};require(len(served)==len(report['servedFiles']),'unique actual served paths')
    for filename,entry in served.items():
        require(filename in sources,'all served bytes source bound');raw=(ROOT/filename).read_bytes()
        if failed and filename in ('renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'):
            kind='module' if filename.endswith('.mjs') else 'wasm';artifact=fault_manifest['modes'][mode]['artifacts'][kind];raw=(fault_directory/artifact['path']).read_bytes();require(sha(raw)==artifact['sha256'] and len(raw)==artifact['bytes'],'actual built isolated compiler fault')
        require(entry['sha256']==sha(raw) and entry['size']==len(raw),'exact served source/artifact bytes')
    require(set(RUNTIME+[FIXTURE,'renderer/virgl-shader/build/wasm/virgl-shader.wasm'])<=set(served),'actual compiler, fixture and complete shared pipeline consumed')
    entry=report['browserCoverage'];raw=(directory/entry['path']).read_bytes();require(sha(raw)==entry['sha256'],'actual recorded coverage');scripts=json.loads(raw)['scripts']
    require({s['source'] for s in scripts}==set(RUNTIME),'coverage includes all newly authored helpers and real renderer')
    for script in scripts:require(script['sha256']==served[script['source']]['sha256'] and script['originalSha256']==sources[script['source']]['sha256'] and any(any(r['count']>0 for r in f['ranges']) for f in script['coverage']['functions']),'executed source-bound browser coverage')
    entry=report['failureScreenshot' if failed else 'screenshot'];require(sha((directory/entry['path']).read_bytes())==entry['sha256'],'actual GPU screenshot')
    browser=report['browser'];require(browser['launch']['headless']is False and browser['gpu']['featureStatus'][browser['webglFeature']]=='enabled' and not any(re.search('swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu',a,re.I) for a in browser['actualCommandLine']),'headed actual hardware GPU')
    return report


def verify_proof(proof,fixture,cases,pairs,originals,fault_cases=None):
    require(proof['schema']=='wasm-vm-structured-conditional-browser-v1' and proof['trustedHostMetadataWrapper']is False and proof['productionVirgl']is False and proof['guestExecution']is False,'honest isolated structured compiler boundary')
    require(proof['fixture']==binding(ROOT/FIXTURE),'all literal input bytes bound')
    by_body,by_pair=legacy.translations(proof,fixture,cases,pairs,originals,fault_cases)
    mode=proof['mode'];fault=mode=='branch-polarity';kernel_map={k['name']:k for k in fixture['kernels']};shaders={s['name']:s for s in fixture['shaders']}
    names=['raw-vertex'] if fault else [k['name'] for k in fixture['kernels']]+['mov-color-vertex','mov-color-fragment','coupled-sync']+[f'coupled-async-{s["seed"]:x}' for s in SCHEDULES]
    require([r['name'] for r in proof['rigs']]==names,'complete bounded independent workload inventory')
    counts={'draws':0,'pixels':0,'words':0,'mismatches':0,'fences':0,'withheldPolls':0,'rejections':0}
    for rig in proof['rigs']:
        kernel=kernel_map.get(rig['name']);geometry(rig,len(kernel['pages']) if kernel else None);programs=legacy.native_events(rig)
        schedule=next((s for s in SCHEDULES if rig['name']==f'coupled-async-{s["seed"]:x}'),None);require(rig.get('schedule')==schedule,'declared bounded independent async schedule')
        summary=life.verify(rig,'normal',globals())
        for key in ('fences','withheldPolls','rejections'):counts[key]+=summary[key]
        pair_name=kernel['pair'] if kernel else rig['name']+'-pair' if rig['name'].startswith('mov-color') else 'coupled-pair'
        pair=next(p for p in fixture['pairs'] if p['name']==pair_name);translated=by_pair[(shaders[pair['vertex']]['text'],shaders[pair['fragment']]['text'])];sources=[translated['vertex']['glsl'],translated['fragment']['glsl']]
        vectors=fixture['vectors']['branches'][:1 if fault else None]
        if kernel:
            require(len(rig['atlases'])==len(vectors) and rig['draws']==[],'all literal branch vectors captured in word atlases')
            for draw,vector in zip(rig['atlases'],vectors):
                legacy.draw_identity(rig,draw,[math.bank(vector)]*2,sources,programs);result=atlas(draw,kernel,vector,fixture,fault);counts['draws']+=1
                for key,value in result.items():counts[key]+=value
        else:
            family='mov' if rig['name'].startswith('mov-color') else 'coupled';vectors=fixture['vectors']['branches']+([fixture['vectors']['branches'][0]] if family=='coupled' else [])
            require(rig['atlases']==[] and len(rig['draws'])==len(vectors),'all four branch selections and coupled restoration captured')
            for draw,vector in zip(rig['draws'],vectors):legacy.draw_identity(rig,draw,[math.bank(vector)]*2,sources,programs);color(draw,vector,family,fixture);counts['draws']+=1;counts['pixels']+=4096
            if family=='coupled':
                require(len(rig['yieldAttacks'])==(1 if schedule else 0) and len(rig['poison'])==(2 if schedule else 1),'actual independent native restore/yield poisoning')
                require(len(rig['lifecycle'])==(0 if schedule else len(fixture['negativeCases'])),'actual negative CREATE cleanup and recovery')
    if not fault:require(proof['status']=='passed' and proof['drawCount']==counts['draws']==39 and proof['capturedWords']==counts['words']==1088 and proof['checkedPixels']==counts['pixels']==159744,'all independently counted successful GPU observations')
    else:require(proof['status']=='failed' and 'actual branch atlas differs from independent literal oracle' in proof['failure']['message'] and counts['mismatches']>0,'source polarity fault fails at measured actual GPU words')
    return counts


def verify(output,head,native_report,fault_manifest,*,preview=False):
    output=Path(output);fixture=read(ROOT/FIXTURE);cases={e['name']:e['result'] for e in native_report['cases']};pairs={e['name']:e['result'] for e in native_report['pairs']};originals={e.get('sha256',e.get('inputSha256')):e['result'] for e in native_report['originals']}
    require(len(originals)==19,'complete original native corpus counterpart')
    records=[];sources={};summaries=[]
    for directory,mode in [('hardware','normal'),('sabotage-branch-polarity','branch-polarity')]:
        current=output/directory;report=envelope(current,head,mode,fault_manifest,preview);fault_cases=None
        if mode=='branch-polarity':
            root=Path(fault_manifest['outputDirectory']) if preview else output/'fault-artifacts';entry=fault_manifest['modes'][mode]['nativeTranslations'];raw=(root/entry['path']).read_bytes();require(sha(raw)==entry['sha256'] and len(raw)==entry['bytes'],'complete isolated native fault translations');fault_cases=json.loads(raw)
        summary=verify_proof(report['acceptance'],fixture,cases,pairs,originals,fault_cases);require(report['status']==report['acceptance']['status'],'inner/outer recording outcome agrees');summaries.append({'mode':mode,**summary,'report':binding(current/'report.json',output)})
        for item in report['sources']:sources[item['path']]={'path':item['path'],'bytes':item['size'],'sha256':item['sha256']}
        records.extend(binding(p,output) for p in sorted(current.iterdir()) if p.is_file())
    for name in ['tools/virgl-structured-conditionals/browser_receipt.py','tools/virgl-structured-conditionals/oracle.py','tools/virgl-constant-compiler/browser_receipt.py','tools/virgl-constant-compiler/lifecycle_receipt.py','tools/virgl-constant-compiler/oracle.py','tools/virgl-dot-reciprocals/oracle.py','tools/virgl-component-floats/oracle.py','tools/virgl-numeric-floats/oracle.py']:
        sources[name]=binding(ROOT/name)
        if '/virgl-structured-conditionals/' not in name:require(subprocess.check_output(['git','show',f'{HELD}:{name}'],cwd=ROOT)==(ROOT/name).read_bytes(),'predecessor leaf oracle remains byte-identical to verified parent')
    return {'status':'passed','preview':preview,'sources':list(sources.values()),'records':records,'modes':summaries}
