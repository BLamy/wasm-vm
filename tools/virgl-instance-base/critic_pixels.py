#!/usr/bin/env python3
"""Interpret original token instructions over actual uploads and native calls."""
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
from critic_checks import original_words

MASK=0xffffffff
sha=lambda b:hashlib.sha256(b).hexdigest()
u32=lambda b,at=0:struct.unpack_from('<I',b,at)[0]
float_value=lambda w:struct.unpack('<f',struct.pack('<I',w))[0]
float_bits=lambda f:struct.unpack('<I',struct.pack('<f',f))[0]


def original_eval(program,inputs,constants,image,base,ordinal,vertex):
    sv={}
    for d in program['declarations']:
        if d['file']==9:
            assert d['first']==d['last'] and d['semantic'] in (10,11)
            sv[d['first']]=[(base+ordinal)&MASK if d['semantic']==10 else vertex]*4
    registers={(2,k):v for k,v in inputs.items()}
    registers.update({(9,k):v for k,v in sv.items()})
    registers.update({(7,i):v['words'] for i,v in enumerate(program['immediates'])})
    for instruction in program['instructions']:
        opcode=instruction['opcode']
        if opcode==98:  # END is validated against the complete original enum.
            assert not instruction['destinations'] and not instruction['sources'];continue
        sources=[]
        for s in instruction['sources']:
            assert not s['indirect']
            value=constants[(s['slot'],s['index'])] if s['file']==1 else [s['index']]*4 if s['file']==5 else registers[(s['file'],s['index'])]
            value=[value[lane] for lane in s['swizzle']]
            if opcode in (1,8):  # original MOV untyped and ADD floating.
                if s['absolute']:value=[w&0x7fffffff for w in value]
                if s['negate']:value=[w^0x80000000 for w in value]
            elif opcode not in (98,):
                assert not s['absolute']
                if s['negate']:value=[(-w)&MASK for w in value]
            sources.append(value)
        if opcode==1:result=sources[0]
        elif opcode==8:result=[float_bits(float_value(a)+float_value(b)) for a,b in zip(*sources)]
        elif opcode==76:result=[a^b for a,b in zip(*sources)]
        elif opcode==77:result=image
        else:raise AssertionError(('unexpected bounded original opcode',opcode))
        assert len(instruction['destinations'])==1
        d=instruction['destinations'][0]
        prior=registers.setdefault((d['file'],d['index']),[None]*4)
        for lane in range(4):
            if d['mask']&(1<<lane):prior[lane]=result[lane]
    return registers


def enum_opcodes():
    header=(Path(__file__).resolve().parents[2]/'renderer/virgl-shader/vendor/src/gallium/include/pipe/p_shader_tokens.h').read_text()
    text=re.search(r'enum tgsi_opcode\s*\{(.*?)\};',header,re.S)[1]
    text=re.sub(r'/\*.*?\*/','',text,flags=re.S)
    items=[x.strip() for x in text.split(',') if x.strip()]
    assert all(re.fullmatch('TGSI_OPCODE_[A-Z0-9_]+',x) for x in items)
    return {x.removeprefix('TGSI_OPCODE_'):i for i,x in enumerate(items)}


def audit(directory,native_file):
    directory=Path(directory).resolve(); report_raw=(directory/'report.json').read_bytes();report=json.loads(report_raw)
    a=report['acceptance'];events=a['events']
    assert [e['id'] for e in events]==list(range(len(events)))
    assert report['browserErrors']==dict(console=[],page=[],requests=[])
    assert not report['browser']['launch']['headless']
    assert report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']]=='enabled'
    assert not any(re.search(r'swiftshader|llvmpipe|softpipe|disable-gpu',s,re.I) for s in report['browser']['actualCommandLine'])
    rows=[json.loads(r) for r in Path(native_file).read_text().splitlines()]
    blobs={}
    for b in a['blobs']:
        zipped=(directory/b['path']).read_bytes();assert sha(zipped)==b['gzipSha256']
        raw=gzip.decompress(zipped);assert len(raw)==b['bytes'] and sha(raw)==b['sha256']
        assert b['key'] not in blobs;blobs[b['key']]=raw
    def handle(v):return v['handle'] if v else None
    shaders,programs,live,retired={},{},{},set()
    for e in events:
        assert 'error' not in e
        method,args=e['method'],e['args']
        for v in args+e.get('after',[])+[e.get('result')]:
            if isinstance(v,dict) and 'key' in v:assert len(blobs[v['key']])==v['byteLength']
        if method=='shaderSource':shaders[handle(args[0])]=args[1]
        if method=='getShaderSource':assert e['result']==shaders[handle(args[0])]
        if method=='attachShader':programs.setdefault(handle(args[0]),[]).append(handle(args[1]))
        if method in ['createShader','createProgram','createBuffer','createTexture','createVertexArray','createFramebuffer','fenceSync']:
            h=handle(e['result']);assert h is not None and h not in live;live[h]=method
        if method in ['deleteShader','deleteProgram','deleteBuffer','deleteTexture','deleteVertexArray','deleteFramebuffer','deleteSync']:
            h=handle(args[0]);assert h in live and h not in retired;retired.add(h)
        if method=='getError':assert e['result']==0
    assert set(live)==retired, {h:live[h] for h in set(live)-retired}
    frames,mismatches,consumed=[],[],set()
    for f in a['frames']:
        row=rows[f['nativeIndex']];assert f['pair']==row['result']
        vertex_program=original_words(row['originalTokens'][0]['rawWords'],details=True)
        fragment_program=original_words(row['originalTokens'][1]['rawWords'],details=True)
        subset=events[f['firstEvent']:f['lastEvent']+1]
        bound,buffers,pointers,divisors,locations,block_indices,block_bindings,base_bindings,uniform_words={},{},{},{},{},{},{},{},{}
        image=None;program=None;draws=[];read=None;offset_handle=None;offset_index=None;offset_defaults=[];offset_types=[];offset_sizes=[];offset_writes=[]
        for e in subset:
            method,args=e['method'],e['args']
            if method=='useProgram' and args[0]:program=handle(args[0])
            if method=='bindBuffer':bound[args[0]]=handle(args[1])
            if method=='bufferData':buffers[bound[args[0]]]=blobs[args[1]['key']]
            if method=='getBufferSubData':assert blobs[e['after'][2]['key']]==buffers[bound[args[0]]][args[1]:args[1]+e['after'][2]['byteLength']]
            if method in ['vertexAttribPointer','vertexAttribIPointer']:pointers[args[0]]=dict(buffer=bound[34962],args=args,integer=method.endswith('IPointer'))
            if method=='vertexAttribDivisor':divisors[args[0]]=args[1]
            if method=='getAttribLocation':
                m=re.fullmatch(r'in_(\d+)',args[1]);assert m;locations[int(m[1])]=e['result']
            if method=='getUniformLocation':
                if e['result']:uniform_words[handle(e['result'])]=dict(name=args[1],words=None)
                if args[1]=='wv_instance_base':offset_handle=handle(e['result'])
            if method=='getUniformIndices' and args[1]==['wv_instance_base']:offset_index=e['result'][0]
            if method=='getUniform' and handle(args[1])==offset_handle:offset_defaults.append(e['result'])
            if method=='getActiveUniforms' and offset_index is not None and args[1]==[offset_index]:
                if args[2]==35383:offset_types.append(e['result'])
                if args[2]==35384:offset_sizes.append(e['result'])
            if method=='uniform1ui' and handle(args[0])==offset_handle:offset_writes.append(e)
            if method=='uniform4uiv':uniform_words[handle(args[0])]['words']=list(struct.unpack('<'+'I'*(len(blobs[args[1]['key']])//4),blobs[args[1]['key']]))
            if method=='getUniformBlockIndex':block_indices[e['result']]=args[1]
            if method=='uniformBlockBinding':block_bindings[args[1]]=args[2]
            if method=='bindBufferBase' and args[2]:base_bindings[args[1]]=handle(args[2])
            if method=='texSubImage2D':image=list(struct.unpack('<4I',blobs[args[-1]['key']]))
            if method in ['drawArrays','drawArraysInstanced','drawElements','drawElementsInstanced']:
                assert args[0]==0
                element=method.startswith('drawElements');count=args[1] if element else args[2]
                instances=args[4] if method=='drawElementsInstanced' else args[3] if method=='drawArraysInstanced' else 1
                if element:
                    n={5121:1,5123:2,5125:4}[args[2]];assert args[3]%n==0
                    b=buffers[bound[34963]];vertices=[int.from_bytes(b[args[3]+i*n:args[3]+(i+1)*n],'little') for i in range(count)]
                else:vertices=list(range(args[1],args[1]+count))
                draws.append(dict(event=e,vertices=vertices,instances=instances))
            if method=='readPixels':read=e
        assert program and [shaders[s] for s in programs[program]]==[f['pair']['vertex']['glsl'],f['pair']['fragment']['glsl']]
        instance_slots={d['first'] for d in vertex_program['declarations'] if d['file']==9 and d['semantic']==10}
        used=any(s['file']==9 and s['index'] in instance_slots for i in vertex_program['instructions'] for s in i['sources'])
        assert (offset_handle is not None)==used
        if used:
            assert offset_defaults[0]==0 and offset_types==[[5125]] and offset_sizes==[[1]]
            assert offset_writes and offset_writes[0]['args'][1]==((f['base']+1)&MASK if f.get('fault')=='wrong-offset' else f['base'])
            if f.get('originalComplete'):assert len(offset_writes)==2 and offset_writes[-1]['args'][1]==(f['base']+17)&MASK
        else:assert not offset_writes
        assert read and draws
        selected=draws[-1]
        fence=f['gpuComplete'];created=events[fence['createdEvent']];waited=events[fence['consumedEvent']]
        assert selected['event']['id']==fence['writerEvent']<created['id']<waited['id']<read['id']
        assert created['method']=='fenceSync' and created['args']==[37143,0]
        h=handle(created['result']);assert h==fence['handle'] and h not in consumed;consumed.add(h)
        assert waited['method']=='clientWaitSync' and handle(waited['args'][0])==h and waited['args'][1:]==[0,0] and waited['result'] in [37146,37148]
        if f.get('originalComplete'):
            first=f['originalComplete'];assert len(draws)==2 and first['handle']!=h
            assert draws[0]['event']['id']==first['writerEvent']<first['createdEvent']<first['consumedEvent']<draws[1]['event']['id']
            assert events[first['createdEvent']]['method']=='fenceSync' and handle(events[first['createdEvent']]['result'])==first['handle']
            assert events[first['consumedEvent']]['method']=='clientWaitSync' and handle(events[first['consumedEvent']]['args'][0])==first['handle'] and events[first['consumedEvent']]['result'] in [37146,37148]
            assert first['consumedEvent']<f['originalOutput']['readEvent']<offset_writes[-1]['id']<draws[1]['event']['id']
            assert first['handle'] not in consumed
            consumed.add(first['handle'])
        width,height=read['args'][2:4];assert read['args'][:2]==[0,0] and read['args'][4]==36249
        raw=blobs[read['after'][-1]['key']];assert len(raw)==width*height*16
        assert selected['vertices']==f['vertices'] and selected['instances']==f['instances']
        constants={}
        for index,name in block_indices.items():
            if index not in block_bindings:continue
            binding=block_bindings[index];data=buffers[base_bindings[binding]]
            if name=='VirglBlock':assert len(data)==656 and float_value(u32(data,640))==1
            else:
                slot=int(re.fullmatch(r'VirglVSConst(\d+)',name)[1])
                for i in range(len(data)//16):constants[slot,i]=list(struct.unpack_from('<4I',data,i*16))
        for record in uniform_words.values():
            m=re.fullmatch(r'vsconst(\d+)\[0\]',record['name'])
            if m:
                w=record['words'];assert w is not None
                for i in range(len(w)//4):constants[int(m[1]),i]=w[i*4:i*4+4]
        def attribute(index,vertex,instance):
            location=locations[index];p=pointers[location];args=p['args'];b=buffers[p['buffer']];divisor=divisors.get(location,0);ordinal=instance//divisor if divisor else vertex
            if p['integer']:
                assert args[1]==4 and args[2] in (5124,5125)
                at=args[4]+ordinal*(args[3] or 16);return list(struct.unpack_from('<4I',b,at))
            assert args[1]==4 and args[3] is False
            if args[2]==5126:
                at=args[5]+ordinal*(args[4] or 16);return list(struct.unpack_from('<4I',b,at))
            assert args[2]==33640
            packed=u32(b,args[5]+ordinal*(args[4] or 4));components=[packed&1023,(packed>>10)&1023,(packed>>20)&1023,(packed>>30)&3]
            if f['selectors']['packedSignedMask']&(1<<index):
                components=[v-(1024 if i<3 else 4) if v>=(512 if i<3 else 2) else v for i,v in enumerate(components)]
                if f['selectors']['packedNormalizedMask']&(1<<index):components=[max(-1,v/(511 if i<3 else 1)) for i,v in enumerate(components)]
            return [float_bits(v) for v in components]
        own=set()
        for j in range(selected['instances']):
            for v in selected['vertices']:
                inputs={index:attribute(index,v,j) for index in locations}
                registers=original_eval(vertex_program,inputs,constants,image,f['base'],j,v)
                position=next(d for d in vertex_program['declarations'] if d['file']==3 and d['semantic']==0)
                pos=registers[3,position['first']];x=math.floor((float_value(pos[0])/float_value(pos[3])+1)*width/2);y=math.floor((float_value(pos[1])/float_value(pos[3])+1)*height/2)
                assert 0<=x<width and 0<=y<height and (x,y) not in own;own.add((x,y))
                generic=next(d for d in vertex_program['declarations'] if d['file']==3 and d['semantic']==5)
                fragment_in=next(d for d in fragment_program['declarations'] if d['file']==2 and d['semantic']==5 and d['semanticIndex']==generic['semanticIndex'])
                fragment=original_eval(fragment_program,{fragment_in['first']:registers[3,generic['first']]},{},None,0,0,0)
                color=next(d for d in fragment_program['declarations'] if d['file']==3 and d['semantic']==1)
                expected=fragment[3,color['first']]
                for lane,w in enumerate(expected):
                    if f.get('originalOutput'):
                        original_read=events[f['originalOutput']['readEvent']]
                        assert original_read['method']=='readPixels' and original_read['after'][-1]['key']==f['originalOutput']['bytesKey']
                        original_raw=blobs[original_read['after'][-1]['key']]
                        assert len(original_raw)==len(raw) and u32(original_raw,((y*width+x)*4+lane)*4)==w
                    observed=u32(raw,((y*width+x)*4+lane)*4)
                    if observed!=w:mismatches.append(dict(frame=f['name'],x=x,y=y,lane=lane,vertex=v,instance=j,expected=w,observed=observed,byteOffset=((y*width+x)*4+lane)*4,readEvent=read['id'],outputSha256=sha(raw)))
        assert len(own)==width*height
        frames.append(dict(name=f['name'],originalVertices=selected['vertices'],originalInstances=selected['instances'],writer=selected['event']['id'],fence=fence,originalFence=f.get('originalComplete'),read=read['id'],outputSha256=sha(raw),words=width*height*4))
    fault='fault-' in directory.name
    if fault:
        assert report['status']=='failed' and mismatches
    else:assert report['status']=='passed' and not mismatches
    result=dict(status='refuted' if fault else 'passed',reportSha256=sha(report_raw),frames=frames,mismatches=mismatches,
                nativeEvents=len(events),reopenedNativeBodies=len(blobs),physicalSyncs=len(consumed),retiredObjects=len(retired),originalWordsInterpreted=True)
    (directory/'critic-original-pixels.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status=result['status'],frames=len(frames),words=sum(f['words'] for f in frames),mismatches=len(mismatches),syncs=len(consumed),retiredObjects=len(retired))))
    return result


if __name__=='__main__':
    # Check every numeric opcode against the complete pinned original enum.
    op=enum_opcodes();assert {k:op[k] for k in ['MOV','ADD','XOR','TXF','END']}=={'MOV':1,'ADD':8,'XOR':76,'TXF':77,'END':98}
    audit(sys.argv[1],sys.argv[2])
