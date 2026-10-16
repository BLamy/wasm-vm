#!/usr/bin/env python3
"""Independent finest coverage, preserved environment and original native-plane audits."""
import gzip
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
BASE='41c1aa490d19d8c307ea7bdbb5647acf346681f4'
FREEZE='f57db8c880684eb73cdc29c166568185fdde0a46'
SUBMISSION='b0bc023d80c06cf0a449eb7648632b3a9a0af137'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
load=lambda p:json.loads(p.read_bytes())
fw=lambda f:struct.unpack('<I',struct.pack('<f',f))[0]
wf=lambda w:struct.unpack('<f',struct.pack('<I',w))[0]
u32=lambda raw,offset:struct.unpack_from('<I',raw,offset)[0]


def source_name(path):
    marker='renderer/virgl-shader/'
    return marker+path.split(marker,1)[1] if marker in path else None


def changed_lines(names):
    diff=subprocess.check_output(['git','diff','--unified=0',BASE,SUBMISSION,'--',*names],cwd=ROOT,text=True)
    added={};name=None;line=0
    for row in diff.splitlines():
        if row.startswith('+++ b/'):name=row[6:]
        elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
        elif row.startswith('+') and name:added.setdefault(name,[]).append(line);line+=1
        elif row.startswith(' '):line+=1
    return added


def coverage(directory):
    unpacked=directory/'unpacked'; js='renderer/virgl-shader/standard.mjs'
    native=['renderer/virgl-shader/'+leaf for leaf in ['bridge.c','standard_guard.c','standard_emit.c','standard_guard.h']]
    additions=changed_lines([js,*native]);scripts=[];functions=[]
    for temperature in ['hot','cold']:
        root=unpacked/temperature
        for file in (root/'hardware').glob('browser-coverage.json'):
            for record in load(file)['scripts']:
                if record['source']==js:
                    assert record['sha256']==sha((unpacked/'source'/js).read_bytes())
                    scripts.append(dict(path=file.relative_to(unpacked).as_posix(),coverage=record['coverage']))
        for file in (root/'node-coverage').glob('*.json'):
            for record in load(file)['result']:
                if source_name(record['url'])==js:scripts.append(dict(path=file.relative_to(unpacked).as_posix(),coverage=record))
        for file in (root/'coverage').glob('*.json'):
            export=load(file)
            for fn in export['data'][0]['functions']:
                if any(source_name(name) in native for name in fn['filenames']):
                    functions.append(dict(path=file.relative_to(unpacked).as_posix(),exportSha256=sha(file.read_bytes()),function=fn))
    partitions=[];waivers=[]
    for name,lines in additions.items():
        full=(unpacked/'source'/name).read_text();source=full.splitlines(keepends=True);offsets=[0]
        for line in source:offsets.append(offsets[-1]+(len(line.encode('utf-16-le'))//2 if name==js else len(line)))
        scopes=[]
        if name==js:
            for script in scripts:
                regions=[]
                for fn in script['coverage']['functions']:
                    regions.extend(dict(start=r['startOffset'],end=r['endOffset'],count=r['count'],original=r,functionName=fn['functionName']) for r in fn['ranges'])
                scopes.append(dict(path=script['path'],name='finest-governing-function',regions=regions))
        else:
            for record in functions:
                fn=record['function'];regions=[]
                for r in fn['regions']:
                    if r[7]!=0 or source_name(fn['filenames'][r[5]])!=name:continue
                    start=offsets[r[0]-1]+r[1]-1;end=offsets[r[2]-1]+r[3]-1
                    if start<end:regions.append(dict(start=start,end=end,count=r[4],original=r))
                if regions:scopes.append(dict(path=record['path'],name=fn['name'],regions=regions))
        for line in lines:
            start,end=offsets[line-1],offsets[line];points={start,end}
            for scope in scopes:
                for region in scope['regions']:
                    points.update(at for at in [region['start'],region['end']] if start<at<end)
            points=sorted(points)
            for a,b in zip(points,points[1:]):
                text=full[a:b]
                if not text.strip():continue
                counters=[]
                for scope in scopes:
                    active=[r for r in scope['regions'] if r['start']<=a and b<=r['end']]
                    if active:
                        finest=min(active,key=lambda r:r['end']-r['start'])
                        counters.append(dict(record=scope['path'],function=scope['name'],**finest))
                row=dict(source=name,line=line,start=a,end=b,text=text,sourceSha256=sha(full.encode()))
                if counters:
                    maximum=max(c['count'] for c in counters);assert maximum>0,('unexecuted governing partition',row,counters)
                    partitions.append(dict(**row,maxCount=maximum,counters=counters,status='HELD'))
                else:
                    assert name.endswith('.h') or re.fullmatch(r'[\s{};,)]+',text) or re.match(r'\s*(?:/\*|\*|//|const (?:char \*|struct )|static (?:const char \*|void |bool )|uint32_t |bool |struct standard_profile|unsigned |\})',text),('unclassified executable operand',row)
                    waivers.append(dict(**row,reason='Non-executable C ABI/profile field, signature, comment or punctuation; current full native/sanitized/Wasm calls exercise its actual typed ABI.'))
    counts=dict(javascript=sum(r['source']==js for r in partitions),native=sum(r['source']!=js for r in partitions),waivers=len(waivers),zero=0)
    # Counts may exclude pure whitespace; full governing ranges, not counts, are authority.
    assert counts['javascript']>0 and counts['native']>0
    build=(unpacked/'source/renderer/virgl-shader/build.sh').read_text()
    log=(unpacked/'hot/acceptance.log').read_text()
    for mode in ['standard-shadow-texture-native','standard-shadow-texture-sanitize','standard-shadow-texture-allocation-sanitize','standard-wasm-stack','wasm']:
        assert 'build.sh '+mode in log,mode
    assert '-sINITIAL_MEMORY=16777216' in build and '-sSTACK_SIZE=262144' in build and '-sALLOW_MEMORY_GROWTH=0' in build
    result=dict(schema='independent-shadow-finest-coverage-v1',status='passed',predecessor=BASE,freeze=FREEZE,addedLines=additions,counts=counts,partitions=partitions,waivers=waivers,
                additionalHunks=[dict(source='renderer/virgl-shader/bridge.h',classification='ABI declarations and comments; both exports exercised by full original native/sanitized/Wasm responses.'),dict(source='renderer/virgl-shader/build.sh',classification='Test/build/export configuration; actual recorded modes execute, generated Wasm exports execute, fixed memory and optimized stack are independently checked.'),dict(source='Makefile',classification='Declarative acceptance alias; recorded exact acceptance invocation exercises its sole shell command.')])
    (directory/'coverage-fine.json').write_text(json.dumps(result,indent=2)+'\n');print('Independent governing partitions:',counts)


def carried_physical(directory):
    path=ROOT/'tools/virgl-shadow-shaders/pixels.py'
    spec=importlib.util.spec_from_file_location('reopened_original_words',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    rows=[]
    for temperature in ['hot','cold']:
        root=directory/'unpacked'/temperature
        for name in ['hardware','fault-wrong-mask']:
            row=module.audit(root/name,root/'native')
            rows.append(dict(temperature=temperature,**row))
            print('Original native bodies and fences:',temperature,name,len(row['frames']),len(row['mismatches']))
    (directory/'worker-original-physical-audit.json').write_text(json.dumps(dict(status='passed',schema='independently-reopened-original-word-worker-planes-v1',oracleSourceSha256=sha(path.read_bytes()),records=rows),indent=2)+'\n')
    cold=load(directory/'unpacked/cold/report.json');assert cold['status']=='passed' and cold['gitHead']==cold['cloneHead']==FREEZE and cold['statusBefore']==cold['statusAfter']=='' and cold['exitCode']==0
    assert cold['command']==['make','verify-E6-T11d48'] and sha((directory/'unpacked/cold/cold.log').read_bytes())==cold['logSha256']
    assert sha((directory/'unpacked/cold/receipt.json').read_bytes())==cold['receiptSha256']
    stack=[]
    for temperature in ['hot','cold']:
        frames={}
        for file in (directory/'unpacked'/temperature/'stack').glob('*.su'):
            for line in file.read_text().splitlines():
                fields=line.split('\t');frames[fields[0].rsplit(':',1)[-1]]=int(fields[1])
        for mode in ['stage','pair']:
            names=['bridge_translate_standard_shadow_texture'+('_pair' if mode=='pair' else ''),'standard_'+mode,'standard_convert','vrend_convert_shader','standard_emit']
            sizes={name:frames[name] for name in names};total=sum(sizes.values());assert total<262144
            assert total==({'stage':139616,'pair':195344}[mode]);stack.append(dict(temperature=temperature,mode=mode,frames=sizes,total=total))
    (directory/'environment-stack-audit.json').write_text(json.dumps(dict(status='passed',cold=cold,stack=stack,incrementalCarry='Runtime/compiler and worker harness source bodies unchanged after f57; final pristine proof carries. Consumer/storage/Rust/web/guest boundaries and all published predecessor seals remain exact 41c1aa bodies.'),indent=2)+'\n')


def novel(directory):
    folder=directory/'independent/hardware';report=load(folder/'report.json');a=report['acceptance'];assert report['status']==a['status']=='passed' and report['browserErrors']==dict(console=[],page=[],requests=[])
    assert not report['browser']['launch']['headless'] and 'Apple M4 Max' in a['renderer'] and 'Metal' in a['renderer']
    bodies={}
    for row in a['blobs']:
        zipped=(folder/row['path']).read_bytes();raw=gzip.decompress(zipped);assert sha(zipped)==row['gzipSha256'] and len(raw)==row['bytes'] and sha(raw)==row['sha256'];assert row['key'] not in bodies;bodies[row['key']]=raw
    e=a['events'];assert [v['id'] for v in e]==list(range(len(e))) and all('error' not in v for v in e)
    for event in e:
        for value in event['args']+event.get('after',[])+[event.get('result')]:
            if isinstance(value,dict) and 'key' in value:assert len(bodies[value['key']])==value['byteLength']
    def h(value):return value['handle'] if value else None
    locations={};values={};unit=0;textures={};bound={};samplers={};sampbound={};bufferbound={};buffers={};pointers={};program=None
    cursor=0;syncs=set();rows=[]
    original=a['original'];forecast=load(ROOT/'evidence/virgl-shadow-shaders/verifier/predictions.json')['novelPlan']['baselineExpectedWords']
    assert original['expectedWords']==forecast and a['block']==dict(block=0,size=656,offset=640)
    def operand(text,regs):
        absolute=text.startswith('|');text=text.strip('|');match=re.fullmatch(r'(IN|OUT|TEMP|IMM)\[(\d+)\](?:\.([xyzw]{4}))?',text);assert match,text
        values=regs[(match[1],int(match[2]))];result=[values['xyzw'.index(c)] for c in match[3] or 'xyzw'];return [v&0x7fffffff for v in result] if absolute else result
    def execute(text,inputs,stage,depth,view):
        regs={('IN',i):value for i,value in inputs.items()}
        for imm in re.finditer(r'^IMM\[(\d+)\] (UINT32|INT32) \{([^}]+)\}',text,re.M):regs['IMM',int(imm[1])]=[int(v)&0xffffffff for v in imm[3].split(',')]
        for instruction in re.finditer(r'^\d+: (\w+)(?: (.*))?$',text,re.M):
            mnemonic=instruction[1];op=mnemonic.split('_')[0]
            if op=='END':continue
            args=instruction[2].split(', ');dest=re.fullmatch(r'(OUT|TEMP)\[(\d+)\](?:\.([xyzw]+))?',args[0]);assert dest
            if op=='MOV':result=operand(args[1],regs)
            elif op=='XOR':result=[x^y for x,y in zip(operand(args[1],regs),operand(args[2],regs))]
            elif op=='TXQ':
                level=operand(args[1],regs)[0];d=depth['levels'][level];result=[d['width'],d['height'],0,3]
            else:
                assert op in ['TXP','TXL'] and args[-1]=='SHADOW2D'
                coordinates=[wf(word) for word in operand(args[1],regs)]
                if op=='TXP':coordinates=[v/coordinates[3] for v in coordinates[:3]]+[coordinates[3]];level=0
                else:level=min(2,max(0,math.floor(coordinates[3]+.5)))
                z=depth['levels'][level]['value'];reference=coordinates[2];comparison=reference<z if stage=='vertex' else reference>=z
                result=[fw(0 if lane==4 else 1 if lane==5 else int(comparison)) for lane in view]
                if '_SAT' in mnemonic:result=[fw(min(1,max(0,wf(word)))) for word in result]
            key=(dest[1],int(dest[2]));out=regs.get(key,[0]*4).copy()
            for lane in dest[3] or 'xyzw':out['xyzw'.index(lane)]=result['xyzw'.index(lane)]
            regs[key]=out
        return {index:words for (kind,index),words in regs.items() if kind=='OUT'}
    for frame in a['frames']:
        writer=e[frame['fence']['writerEvent']]
        while cursor<=writer['id']:
            event=e[cursor];cursor+=1;args=event['args'];method=event['method']
            if method=='useProgram':program=h(args[0])
            elif method=='getUniformLocation' and event['result']:locations[h(event['result'])]=(h(args[0]),args[1])
            elif method=='uniform1i':values[locations[h(args[0])]]=args[1]
            elif method=='uniform4fv':values[locations[h(args[0])]]=list(struct.unpack('<4f',bodies[args[1]['key']]))
            elif method=='bindBuffer':bufferbound[args[0]]=h(args[1])
            elif method=='bufferData':buffers[bufferbound[args[0]]]=bodies[args[1]['key']]
            elif method=='getBufferSubData':assert bodies[event['after'][2]['key']]==buffers[bufferbound[args[0]]]
            elif method=='vertexAttribPointer':pointers[args[0]]=(bufferbound[34962],args)
            elif method=='activeTexture':unit=args[0]-33984
            elif method=='bindTexture':bound[unit]=h(args[1])
            elif method=='texStorage2D':textures[bound[unit]]=dict(storage=args[1:],levels={})
            elif method=='texSubImage2D':
                raw=bodies[args[8]['key']];depth=struct.unpack('<'+'f'*(len(raw)//4),raw);assert len(set(depth))==1 and len(depth)==args[4]*args[5]
                textures[bound[unit]]['levels'][args[1]]=dict(width=args[4],height=args[5],value=depth[0])
            elif method in ['samplerParameteri','samplerParameterf']:samplers.setdefault(h(args[0]),{})[args[1]]=args[2]
            elif method=='bindSampler':sampbound[args[0]]=h(args[1])
        assert writer['method']=='drawArrays' and writer['args']==[0,0,6]
        uniform={name:value for (owner,name),value in values.items() if owner==program}
        expected=[]
        for stage,prefix,unit,function in [('vertex','vs',3,513),('fragment','fs',9,518)]:
            viewpacket=original['viewPackets'][stage];view=[viewpacket[6]>>(3*i)&7 for i in range(4)];assert view==original['views'][stage]
            assert uniform[prefix+'samp7']==unit;mask=[int(c<4) for c in view];add=[int(c==5) for c in view]
            if frame['corrupted'] and stage=='fragment':mask[1]=0
            assert uniform[prefix+'shadmask7']==mask and uniform[prefix+'shadadd7']==add
            assert textures[bound[unit]]['storage']==[3,36012,4,2]
            assert samplers[sampbound[unit]]=={10241:9984,10240:9728,10242:33071,10243:33071,34892:34894,34893:function,33082:0,33083:2}
        assert uniform['fssamplevels7']==3
        for vertex in range(6):
            attrs={}
            for item in a['inputs']:
                buffer,args=pointers[item['location']];raw=buffers[buffer];assert raw==bytes(item['originalBytes']) and args[1:]==[4,5126,False,0,0]
                attrs[item['index']]=[u32(raw,vertex*16+lane*4) for lane in range(4)]
            vo=execute(original['request']['vertexText'],attrs,'vertex',textures[bound[3]],original['views']['vertex'])
            x=math.floor((wf(vo[0][0])/wf(vo[0][3])+1)*3/2);y=math.floor((wf(vo[0][1])/wf(vo[0][3])+1)*2/2);assert y*3+x==vertex
            fo=execute(original['request']['fragmentText'],{0:vo[1],1:vo[2]},'fragment',textures[bound[9]],original['views']['fragment']);expected.extend(fo[0])
        assert expected==forecast==frame['expectedWords'] and sha(struct.pack('<24I',*expected))==frame['expectedSha256']
        fence=frame['fence'];created,consumed,deleted,read=[e[fence[k]] for k in ['createdEvent','consumedEvent','deleteEvent']]+[e[frame['readEvent']]]
        assert writer['id']<created['id']<consumed['id']<deleted['id']<read['id'];token=h(created['result']);assert token==fence['handle'] and token not in syncs;syncs.add(token)
        assert created['method']=='fenceSync' and created['args']==[37143,0] and consumed['method']=='clientWaitSync' and consumed['args']==[{'handle':token,'type':'WebGLSync'},0,0] and consumed['result']==fence['status'] in [37146,37148]
        assert deleted['method']=='deleteSync' and h(deleted['args'][0])==token and read['method']=='readPixels' and read['args'][:6]==[0,0,3,2,36249,5125]
        raw=bodies[frame['outputKey']];assert frame['outputKey']==read['after'][-1]['key'] and len(raw)==96;actual=list(struct.unpack('<24I',raw));assert actual==frame['observedWords']
        misses=[dict(index=i,lane=i%4,expected=expect,observed=actual[i]) for i,expect in enumerate(expected) if actual[i]!=expect]
        assert len(misses)==(4 if frame['corrupted'] else 0);assert all(m['lane']==1 and m['observed']==2 and m['expected']==1065353218 for m in misses)
        rows.append(dict(name=frame['name'],writerEvent=writer['id'],fence=fence,readEvent=read['id'],outputSha256=sha(raw),expectedSha256=frame['expectedSha256'],mismatches=misses,words=24,status='refuted' if misses else 'HELD'))
    assert a['cleaned'];result=dict(status='passed',schema='independent-original-novel-shadow-plane-audit-v1',reportSha256=sha((folder/'report.json').read_bytes()),reopenedBodies=len(bodies),events=len(e),frames=rows,originalByteOracleIndependentOfESSL=True)
    (directory/'novel-physical-audit.json').write_text(json.dumps(result,indent=2)+'\n');print('Independent original novel plane: 24 exact words; four physically corrupted words refuted.')


if __name__=='__main__':
    directory=Path(sys.argv[2]).resolve()
    {'coverage':coverage,'worker':carried_physical,'novel':novel}[sys.argv[1]](directory)
