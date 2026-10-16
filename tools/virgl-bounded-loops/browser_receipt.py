"""Reconstruct literal addressed words and colors from complete actual GPU evidence."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess

ROOT=Path(__file__).resolve().parents[2]
HELD='62e90790d5c6f0a5da5fa528c482679c16c74290'

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
math=module('bounded_loop_literal_oracle',Path(__file__).with_name('oracle.py'))
legacy=module('held_constant_compiler_browser',ROOT/'tools/virgl-constant-compiler/browser_receipt.py')
life=module('held_constant_compiler_lifecycle',ROOT/'tools/virgl-constant-compiler/lifecycle_receipt.py')
require=math.require
FIXTURE='renderer/virgl-command/tests/bounded-loops-shaders.json'
MODULE='renderer/virgl-command/tests/bounded-loops.mjs'
ORACLE='renderer/virgl-command/tests/bounded-loops-oracle.mjs'
RUNTIME=['renderer/virgl-shader/index.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs',MODULE,ORACLE]
SCHEDULES=[{'seed':0x5e91c42b,'commandsPerStep':1},{'seed':0xc83a701d,'commandsPerStep':3}]
# Authored dyadic colors are independently checked against the literal programs below.
COLORS=[[200,102,52,27],[84,84,84,84],[128,66,34,18],[128,66,34,18],[128,66,34,18],[33,33,33,33],[128,66,34,18],[36,36,36,36],[142,73,38,19],[57,57,57,57],[128,66,34,18],[81,81,81,81]]

def canonical(value):
    """JSON's scalar types are evidence: Python's False == 0 is not equality."""
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)


def same(actual,expected):return canonical(actual)==canonical(expected)


def byte_values(value):
    require(type(value)is list and all(type(v)is int and 0<=v<=255 for v in value),
            'byte observations contain only integer octets')
    return bytes(value)


def strict_observations(value):
    """Type-check the closed browser observation schema before held leaf oracles.

    All words, IDs, counters, lengths and packet bytes are JSON integers. The
    only ordinary fractional observations are the authored viewport half-depths.
    """
    booleans={'guestExecution','productionVirgl','trustedHostMetadataWrapper',
              'compilerAdmissionUnchanged','ok','present','taken','tail','disposed','public',
              'programNull','framebufferNull','vertexArrayNull','gpuComplete',
              'inspectionMutationRejected','optional','predecessorFullGateClaimed','isBlockCoverage'}
    byte_fields={'bytes','rgbaBytes','pixelsBefore','pixelsAfter','inputAfter',
                 'callerBytesAfter','packetBytes'}
    def walk(item,path=(),boolean=False):
        if boolean:
            require(type(item)is bool,'boolean observation at '+str(path));return
        if type(item)is dict:
            require(all(type(k)is str for k in item),'string observation keys')
            for key,child in item.items():
                flag=key in booleans or (key=='status' and item.get('call') in ('compileShader','linkProgram'))
                walk(child,path+(key,),flag)
        elif type(item)is list:
            if path and path[-1]=='colorMask':
                require(len(item)==4 and all(type(v)is bool for v in item),'four boolean color-mask observations');return
            if path and path[-1] in byte_fields:byte_values(item)
            for index,child in enumerate(item):walk(child,path+(index,))
        elif len(path)>=3 and path[-3:] in (('viewport','scale',2),('viewport','translate',2)):
            require(type(item)is float and same(item,0.5),'authored fractional viewport depth')
        elif type(item)is float:
            require(False,'fractional observation outside authored viewport depth at '+str(path))
        else:
            require(type(item) in (str,int,type(None)),'unexpected boolean/non-JSON observation at '+str(path))
    walk(value)


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
            positions.extend((math.float_word(x),math.float_word(y)));selectors.extend((((96+bit)<<23)|0x400000,((96+page)<<23)|0x400000));inputs.extend((0x3e800000,0x3f400000));others.extend((0x3f000017,0x3e000000))
        indices.extend((first,first+1,first+2,first,first+2,first+3))
    vertices=[]
    for i in range(len(positions)//2):vertices.extend(positions[2*i:2*i+2]+selectors[2*i:2*i+2]+inputs[2*i:2*i+2]+others[2*i:2*i+2])
    expected={'rows':rows,'width':64,'height':64,'stride':32,'positionWords':positions,'selectorWords':selectors,'inputWords':inputs,'otherWords':others,'vertexWords':vertices,'indexWords':indices}
    require(same(rig['geometry'],expected),'literal position/selector/two independent input meshes')
    raw_vertices=struct.pack('<'+'I'*len(vertices),*vertices);raw_indices=struct.pack('<'+'H'*len(indices),*indices)
    wanted=[(101,0,64,16,len(raw_vertices),1,raw_vertices),(102,0,64,32,len(raw_indices),1,raw_indices),(103,2,67,10,64,64,bytes(16384))]
    require(len(rig['resourceInputs'])==3,'exact three resource definitions')
    for entry,(identity,target,fmt,bind,width,height,raw) in zip(rig['resourceInputs'],wanted):
        require(same(entry,{'id':identity,'target':target,'format':fmt,'bind':bind,'width':width,'height':height,'bytes':list(raw)}),'all literal decoded resource bytes')
    require(len(rig['bufferReadbacks'])==2 and rig['textureReadbacks']==[],'two actual independent native buffer readbacks')
    for entry,raw in zip(rig['bufferReadbacks'],(raw_vertices,raw_indices)):require(byte_values(entry['bytes'])==raw and entry['nativeId'].startswith('Buffer:'),'actual uploaded native inputs')


def atlas(draw,kernel,vector,fixture,failure=False):
    require(draw['kernel']==kernel['name'] and same(draw['vector'],vector) and draw['checkedPixels']==4096,'exact literal kernel/vector capture')
    byte_values(draw['rgbaBytes'])
    pixels=draw['rgbaBytes'];actual=[[0]*4 for _ in kernel['pages']]
    for y in range(64):
        for x in range(64):
            page,bit=y//2,x//2;pixel=pixels[4*(64*y+x):4*(64*y+x+1)]
            if page>=len(actual):require(same(pixel,[0,0,255,255]),'unused full atlas cells remain clear');continue
            require(all(v in (0,255) for v in pixel),'actual endpoint bitplane bytes')
            anchor=pixels[4*(64*page*2+bit*2):4*(64*page*2+bit*2+1)]
            require(same(pixel,anchor),'all four pixels in each actual bit cell agree')
            if x%2==0 and y%2==0:
                for lane,v in enumerate(pixel):actual[page][lane]|=(v//255)<<bit
    expected,branches,addresses,accesses,loops=math.pages(kernel,vector,fixture)
    require(same(draw['branches'],branches),'independently recursively selected literal branches')
    require(same(draw['addresses'],addresses) and same(draw['accesses'],accesses),'independent literal unsigned address assignments and component selections')
    require(same(draw['loops'],loops) and len(loops)==1 and loops[0]['iterations']==vector['exitJ'],'independent complete bounded iteration trace')
    j=vector['exitJ'];require(expected[1]==[j,j+10,j*16,0xffffffff if vector['tail'] else 0],'literal j/a/b header invariant and tail decision')
    indices=[entry['index'] for entry in addresses];wanted=list(range(11,11+j))+([j+9,j+28,j+27] if vector['tail'] else [])
    require(same(indices,wanted),'complete mathematical header and guarded tail address sequence')
    failures=[]
    require(len(draw['pages'])==len(expected),'all declared full-word pages')
    for row,(definition,entry,wanted,words) in enumerate(zip(kernel['pages'],draw['pages'],expected,actual)):
        require(same(entry,{**definition,'observedWords':words,'expectedWords':wanted}),'producer expectation independently reconstructed from literal TGSI')
        for lane,(a,b) in enumerate(zip(wanted,words)):
            if a!=b:failures.append({'page':row,'lane':lane,'name':definition['name'],'expectedWord':a,'observedWord':b})
    require(same(draw.get('failures',[]),failures) and bool(failures)==failure,'address source fault has a measured raw-word counterexample')
    require(not any(f['page']==0 for f in failures),'literal orientation remains exact under bounded early-break fault')
    if failure:
        observed_j=actual[1][0];raw_n=vector['countWord'];signed_n=raw_n if raw_n<0x80000000 else raw_n-0x100000000
        require(1<=observed_j<=max(1,signed_n)<=18,'measured fault exit remains within the forced signed-count bound')
        taken=observed_j!=raw_n;flag=0xffffffff if taken else 0
        require(actual[1]==[observed_j,observed_j+10,16*observed_j,flag],'fault preserves measured recurrence roles')
        selected=[observed_j+9,observed_j+28,observed_j+27] if taken else [0,0,0]
        require(actual[6]==selected+[flag] and all(0<=i<46 for i in selected),'measured fault tail addresses remain inside the full table')
        words=math.bank(vector);require(actual[2]==[words[4*(observed_j+10)]]*4,'fault header pixels bind the measured safe address')
        if taken:
            require(actual[3]==[words[4*selected[0]]]*4 and actual[4]==words[4*selected[1]:4*selected[1]+4] and actual[5]==words[4*selected[2]:4*selected[2]+4],'fault tail pixels bind all measured safe selections')
    return {'pixels':4096,'words':4*len(actual),'mismatches':len(failures)}


def color(draw,vector,family,fixture):
    index=fixture['vectors']['counts'].index(vector);wanted=COLORS[index]
    require(same(vector['color'],wanted),'independently authored literal per-lane colors')
    inputs={0:[0,0,0,0x3f800000],1:[0,0,0,0x3f800000],2:[0x3e800000,0x3f400000,0,0x3f800000],3:[0x3f000017,0x3e000000,0,0x3f800000]}
    vertex=next(s for s in fixture['shaders'] if s['name']=='coupled-vertex');fragment=next(s for s in fixture['shaders'] if s['name']=='coupled-fragment')
    source,_,_,_,_,_=math.interpret(vertex['text'],inputs,math.bank(vector));inputs[1]=[source('OUT[1]',lane) for lane in range(4)]
    source,_,_,_,_,_=math.interpret(fragment['text'],inputs,math.bank(vector));words=[source('OUT[0]',lane) for lane in range(4)]
    independently=[int(min(1,max(0,math.rational(word)))*255+math.Fraction(1,2)) for word in words]
    require(same(independently,wanted),'literal table agrees with exact rational addressed values')
    require(draw['family']==family and same(draw['vector'],vector) and same(draw['color'],wanted) and draw['checkedPixels']==4096 and same(draw['rgbaBytes'],wanted*4096),'every native color pixel matches literal addressed outcome')


def envelope(directory,head,mode,fault_manifest,preview):
    report=read(directory/'report.json');failed=mode=='early-break'
    for field in ('sources','servedFiles','browserCoverage','faultManifestBinding'):
        strict_observations(report[field])
    require(same(report['schema'],1) and report['task']=='E6-T12e9' and report['gitHead']==head and report['mode']==mode and report['status']==('failed' if failed else 'passed'),'browser exact-head mode and outcome')
    require((preview or report['trackedChanges']==[]) and report['guestExecution']is False and report['trustedHostMetadataWrapper']is False and report['currentGuest3dAdvertisement']is False,'frozen compiler proof with production disabled')
    require(same(report['browserErrors'],{'console':[],'page':[],'requests':[]}),'zero native browser errors')
    sources={}
    for entry in report['sources']:
        raw=(ROOT/entry['path']).read_bytes();require(entry['size']==len(raw) and entry['sha256']==sha(raw),'actual source binding')
        require(entry['path'] not in sources or same(sources[entry['path']],entry),'unique consistent source identity');sources[entry['path']]=entry
    require(same(report['faultManifest'],fault_manifest if failed else None),'exact selected isolated compiler fault manifest')
    fault_directory=(Path(fault_manifest['outputDirectory']) if preview else directory.parent/'fault-artifacts') if failed else None
    if failed:
        raw=(fault_directory/'manifest.json').read_bytes();require(report['faultManifestBinding']['sha256']==sha(raw) and report['faultManifestBinding']['bytes']==len(raw),'actual served fault manifest')
    else:require(report['faultManifestBinding']is None,'clean run has no artifact substitution')
    served={item['path']:item for item in report['servedFiles']};require(len(served)==len(report['servedFiles']),'unique actual served paths')
    for filename,entry in served.items():
        require(filename in sources,'all served bytes source bound');raw=(ROOT/filename).read_bytes()
        if failed and filename in ('renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'):
            kind='module' if filename.endswith('.mjs') else 'wasm';artifact=fault_manifest['modes'][mode]['artifacts'][kind];raw=(fault_directory/artifact['path']).read_bytes();require(sha(raw)==artifact['sha256'] and len(raw)==artifact['bytes'],'actual built isolated compiler fault')
        if mode=='decoder-bypass' and filename=='renderer/virgl-command/decoder.mjs':
            require(raw.count(legacy.DECODER_BEFORE.encode())==1,'unique explicit negative-only decoder fault seam');raw=raw.replace(legacy.DECODER_BEFORE.encode(),legacy.DECODER_AFTER.encode())
        require(entry['sha256']==sha(raw) and entry['size']==len(raw),'exact served source/artifact bytes')
    require(set(RUNTIME+[FIXTURE,'renderer/virgl-shader/build/wasm/virgl-shader.wasm'])<=set(served),'actual compiler, fixture and complete shared pipeline consumed')
    entry=report['browserCoverage'];raw=(directory/entry['path']).read_bytes();require(sha(raw)==entry['sha256'],'actual recorded coverage');scripts=json.loads(raw)['scripts']
    strict_observations(scripts)
    require({s['source'] for s in scripts}==set(RUNTIME),'coverage includes all newly authored helpers and real renderer')
    for script in scripts:require(script['sha256']==served[script['source']]['sha256'] and script['originalSha256']==sources[script['source']]['sha256'] and any(any(r['count']>0 for r in f['ranges']) for f in script['coverage']['functions']),'executed source-bound browser coverage')
    entry=report['failureScreenshot' if failed else 'screenshot'];require(sha((directory/entry['path']).read_bytes())==entry['sha256'],'actual GPU screenshot')
    browser=report['browser'];require(browser['launch']['headless']is False and browser['gpu']['featureStatus'][browser['webglFeature']]=='enabled' and not any(re.search('swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu',a,re.I) for a in browser['actualCommandLine']),'headed actual hardware GPU')
    return report


def lifecycle(rig,mode):
    # The held packet/fence oracle still sees every submission. Its closed attack
    # schema predates count constraints, so the new count observations have this
    # separate complete check instead of fabricated historical error records.
    legacy_attacks=[a for a in rig['attacks'] if a['name']!='invalid count' and not a['name'].startswith('count constraint ')]
    summary=life.verify({**rig,'attacks':legacy_attacks},mode,globals())
    count_sets=[a for a in rig['attacks'] if a['name']=='invalid count']
    count_draws=[a for a in rig['attacks'] if a['name'].startswith('count constraint ')]
    expected=[(stage,word) for stage in (0,1) for word in (19,0x3f800000,0x7f000000)] if rig['name'].startswith('coupled-') else []
    require(same([(a['stage'],a['word']) for a in count_sets],expected) and len(count_draws)==len(expected),'exact both-stage current raw count rejection inventory')
    for setter,rejection,(stage,word) in zip(count_sets,count_draws,expected):
        require(setter['position']==36 and finite(word) and 18<word<0x80000000,'finite raw positive word violates signed upper count')
        before=setter['before'];after=setter['after'];wanted=json.loads(canonical(before));wanted['contexts'][0]['subContexts'][0]['bindings']['constants'][stage][36]=word
        require(same(after,wanted),'count SET changes only the actual owned raw count word')
        require(setter['result']['ok'] is True and setter['result']['appliedCommands']==1 and same(setter['pixelsBefore'],setter['pixelsAfter']),'valid raw packet stores count without drawing')
        require(not any(e['call']=='uniform4uiv' and e['name']==('vsconst0[0]' if stage==0 else 'fsconst0[0]') for e in setter['events']),'invalid count bank never uploaded during nondraw restoration')
        require(rejection['name']==f'count constraint stage {stage} word {word}' and rejection['result']['ok'] is False and rejection['result']['error']['code']=='constant-constraint-error' and rejection['result']['appliedCommands']==0,'exact current-bank constraint failure')
        require(same(rejection['before'],after) and same(rejection['after'],after) and same(rejection['pixelsBefore'],setter['pixelsAfter']) and same(rejection['pixelsAfter'],setter['pixelsAfter']),'invalid draw observes same count generation without changing state or pixels')
        require(all(rig.get('schedule') and e['call'] in ('fenceSync','fenceSchedule','clientWaitSync','deleteSync') for e in rejection['events']),'count failure precedes every GPU draw effect; only existing async completion fences remain')
    summary['rejections']+=len(count_draws)
    return summary


def verify_proof(proof,fixture,cases,pairs,originals,fault_cases=None):
    strict_observations(proof)
    require(proof['schema']=='wasm-vm-bounded-loops-browser-v1' and proof['trustedHostMetadataWrapper']is False and proof['productionVirgl']is False and proof['guestExecution']is False,'honest isolated indirect compiler boundary')
    require(same(proof['fixture'],binding(ROOT/FIXTURE)),'all literal input bytes bound')
    expected_cases={e['name']:e['result'] for e in fault_cases} if fault_cases is not None else cases
    for item in proof['shaderFixtures']:
        require(same(item['result'],expected_cases[item['name']]),'typed complete native/Wasm shader result')
        definition=next(x for x in fixture['shaders'] if x['name']==item['name'])
        require(same(item['result']['metadata'].get('constantAccesses'),definition['expected']['constantAccesses']),'complete compiler-derived exact static access contract')
        require(same(item['result']['metadata'].get('constantConstraints'),definition['expected']['constantConstraints']),'complete compiler-derived exact signed count constraint')
    for item in proof['negativeFixtures']:
        require(same(item['result'],cases[item['name']]),'typed complete rejected shader result')
    for item in proof['corpus']:
        require(same(item['result'],originals[item['sha256']]),'typed complete original shader result')
    for item in proof['pairFixtures']:
        expected=(legacy.specialized_pair(expected_cases[item['vertex']],expected_cases[item['fragment']])
                  if fault_cases is not None else pairs[item['name']])
        require(same(item['result'],expected),'typed complete native/Wasm pair result')
    by_body,by_pair=legacy.translations(proof,fixture,cases,pairs,originals,fault_cases)
    for rig in proof['rigs']:
        for entry in rig['translations']:
            request=entry['request']
            expected=by_body[(request['stage'],request['text'])] if entry['kind']=='single' else by_pair[(request['vertexText'],request['fragmentText'])]
            require(same(entry['result'],expected),'typed unmodified actual compiler result at renderer boundary')
    mode=proof['mode'];fault=mode=='early-break';kernel_map={k['name']:k for k in fixture['kernels']};shaders={s['name']:s for s in fixture['shaders']}
    names=['loop-vertex'] if fault else ['coupled-sync'] if mode=='decoder-bypass' else [k['name'] for k in fixture['kernels']]+['coupled-sync']+[f'coupled-async-{s["seed"]:x}' for s in SCHEDULES]
    require([r['name'] for r in proof['rigs']]==names,'complete bounded independent workload inventory')
    counts={'draws':0,'pixels':0,'words':0,'mismatches':0,'fences':0,'withheldPolls':0,'rejections':0}
    for rig in proof['rigs']:
        kernel=kernel_map.get(rig['name']);geometry(rig,len(kernel['pages']) if kernel else None);programs=legacy.native_events(rig)
        schedule=next((s for s in SCHEDULES if rig['name']==f'coupled-async-{s["seed"]:x}'),None);require(same(rig.get('schedule'),schedule),'declared bounded independent async schedule')
        summary=lifecycle(rig,'decoder-bypass' if mode=='decoder-bypass' else 'normal')
        expected_attacks=0 if fault else 1 if kernel else 14 if schedule else 26 if mode=='decoder-bypass' else 20
        require(len(rig['attacks'])==expected_attacks,'complete declared bank rejection inventory')
        if not kernel and not schedule:
            poisons=[(x['stage'],x['position'],x['word']) for x in rig['attacks'] if x['name']=='invalid bank']
            require(same(poisons,[(0,124,0x7f800000),(0,183,0xffc12345),(1,124,0x7fc01234),(1,183,0xff800000),(0,36,0xffffffff),(1,36,0x7f800000)]),'both stage unselected and last-component finite-prefix witnesses')
        for attack in rig['attacks']:
            if attack['name'] not in ('invalid bank','invalid count'):require(all(schedule and e['call'] in ('fenceSync','fenceSchedule','clientWaitSync','deleteSync') for e in attack['events']) and same(attack['before'],attack['after']),'complete prefix rejection precedes all draw allocation, upload, index access and dispatch; async job completion fences are separately verified')
        for key in ('fences','withheldPolls','rejections'):counts[key]+=summary[key]
        pair_name=kernel['pair'] if kernel else 'coupled-pair'
        pair=next(p for p in fixture['pairs'] if p['name']==pair_name);translated=by_pair[(shaders[pair['vertex']]['text'],shaders[pair['fragment']]['text'])];sources=[translated['vertex']['glsl'],translated['fragment']['glsl']]
        vectors=fixture['vectors']['counts'][:1 if fault else None]
        if kernel:
            require(len(rig['atlases'])==len(vectors) and rig['draws']==[],'all literal branch vectors captured in word atlases')
            for draw,vector in zip(rig['atlases'],vectors):
                legacy.draw_identity(rig,draw,[math.bank(vector)]*2,sources,programs);result=atlas(draw,kernel,vector,fixture,fault);counts['draws']+=1
                for key,value in result.items():counts[key]+=value
        else:
            family='coupled';vectors=[next(v for v in fixture['vectors']['counts'] if v['name']==name) for name in fixture['lifecycleVectors']];vectors=vectors+[vectors[0]]
            require(rig['atlases']==[] and len(rig['draws'])==len(vectors),'all four branch selections and coupled restoration captured')
            for draw,vector in zip(rig['draws'],vectors):legacy.draw_identity(rig,draw,[math.bank(vector)]*2,sources,programs);color(draw,vector,family,fixture);counts['draws']+=1;counts['pixels']+=4096
            if family=='coupled':
                require(len(rig['yieldAttacks'])==(1 if schedule else 0) and len(rig['poison'])==(2 if schedule else 1),'actual independent native restore/yield poisoning')
                require(len(rig['lifecycle'])==(0 if schedule else len(fixture['negativeCases'])),'actual negative CREATE cleanup and recovery')
    if not fault:require(proof['status']=='passed' and proof['drawCount']==counts['draws']==(5 if mode=='decoder-bypass' else 39) and proof['capturedWords']==counts['words']==(0 if mode=='decoder-bypass' else 768) and proof['checkedPixels']==counts['pixels']==(20480 if mode=='decoder-bypass' else 159744),'all independently counted successful GPU observations')
    else:require(proof['status']=='failed' and 'actual bounded loop atlas differs from independent literal oracle' in proof['failure']['message'] and counts['mismatches']>0,'source address fault fails at measured actual GPU words')
    return counts


def verify(output,head,native_report,fault_manifest,*,preview=False):
    output=Path(output);fixture=read(ROOT/FIXTURE);cases={e['name']:e['result'] for e in native_report['cases']};pairs={e['name']:e['result'] for e in native_report['pairs']};originals={e.get('sha256',e.get('inputSha256')):e['result'] for e in native_report['originals']}
    require(len(originals)==19,'complete original native corpus counterpart')
    records=[];sources={};summaries=[]
    for directory,mode in [('hardware','normal'),('sabotage-decoder-bypass','decoder-bypass'),('sabotage-early-break','early-break')]:
        current=output/directory;report=envelope(current,head,mode,fault_manifest,preview);fault_cases=None
        if mode=='early-break':
            root=Path(fault_manifest['outputDirectory']) if preview else output/'fault-artifacts';entry=fault_manifest['modes'][mode]['nativeTranslations'];raw=(root/entry['path']).read_bytes();require(sha(raw)==entry['sha256'] and len(raw)==entry['bytes'],'complete isolated native fault translations');fault_cases=json.loads(raw)
        summary=verify_proof(report['acceptance'],fixture,cases,pairs,originals,fault_cases);require(report['status']==report['acceptance']['status'],'inner/outer recording outcome agrees');summaries.append({'mode':mode,**summary,'report':binding(current/'report.json',output)})
        for item in report['sources']:sources[item['path']]={'path':item['path'],'bytes':item['size'],'sha256':item['sha256']}
        records.extend(binding(p,output) for p in sorted(current.iterdir()) if p.is_file())
    for name in ['tools/virgl-bounded-loops/browser_receipt.py','tools/virgl-bounded-loops/oracle.py','tools/virgl-constant-compiler/browser_receipt.py','tools/virgl-constant-compiler/lifecycle_receipt.py','tools/virgl-constant-compiler/oracle.py','tools/virgl-dot-reciprocals/oracle.py','tools/virgl-component-floats/oracle.py','tools/virgl-numeric-floats/oracle.py']:
        sources[name]=binding(ROOT/name)
        if '/virgl-bounded-loops/' not in name:require(subprocess.check_output(['git','show',f'{HELD}:{name}'],cwd=ROOT)==(ROOT/name).read_bytes(),'predecessor leaf oracle remains byte-identical to verified parent')
    return {'status':'passed','preview':preview,'sources':list(sources.values()),'records':records,'modes':summaries}
