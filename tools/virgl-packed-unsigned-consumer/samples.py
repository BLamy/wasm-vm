#!/usr/bin/env python3
"""Invert original packed UINT sampler packets without importing product code."""
import gzip,hashlib,json,math,re,struct,sys
from pathlib import Path
from pixels import PACKED_UINT,audit_native_lifetimes,decoded_native,packets,scalar

def rgba(fmt,raw):
    d=PACKED_UINT[fmt];result=[]
    for at in range(0,len(raw),d['guestPixelBytes']):
        value=int.from_bytes(raw[at:at+d['guestPixelBytes']],'little')
        result.extend((value>>field['offset'])&(2**field['bits']-1) for field in d['rgbaFields'])
    return result

def main(directory,control=False):
    directory=Path(directory);report=json.loads((directory/'report.json').read_text());e=report.get('browserResult',{}).get('result') or report.get('partial')
    assert e and e['mode'] in ['samples','sample-boundaries'] and report['browserErrors']==dict(console=[],page=[],requests=[])
    blobs={row['key']:row for row in e['blobs']};assert len(blobs)==len(e['blobs'])
    def load(ref):
        row=blobs[ref['key']];assert row['sha256']==ref['sha256']
        compressed=(directory/row['path']).read_bytes();assert hashlib.sha256(compressed).hexdigest()==row['gzipSha256']
        raw=gzip.decompress(compressed);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'];return raw
    counts=dict(runs=0,frames=0,components=0,rangeComponents=0,backingBytes=0,syncs=0,polls=0,cpuReads=0,compilerResponses=0)
    differences=[]
    for ri,run in enumerate(e['runs']):
        d=PACKED_UINT[run['format']];counts['runs']+=1
        originals={p['level']:dict(p,raw=load(p['input'])) for p in run['planes']};backing=load(run['sourceBacking'])
        wanted=bytearray([0xa7]*len(backing))
        for p in originals.values():
            row_bytes=p['width']*d['guestPixelBytes'];assert len(p['raw'])==row_bytes*p['height']
            for y in range(p['height']):wanted[p['offset']+y*p['stride']:p['offset']+y*p['stride']+row_bytes]=p['raw'][y*row_bytes:(y+1)*row_bytes]
        assert backing==wanted,'original SG rows and every untouched backing byte'
        contexts={};predictions={};labels={};draws={r['label']:r for r in run['draws']}
        assert len(draws)==len(run['draws'])
        for hi,history in enumerate(run['history']):
            ctx=contexts.setdefault(history['ctx'],dict(shaders={},stage={},views={},bound={},samplers={},sampleStates={},surfaces={},colors={}))
            for ci,(op,kind,w,raw) in enumerate(packets(history['hex'])):
                if ci>=history['result'].get('appliedCommands',0):continue
                if op==1 and kind==4:ctx['shaders'][w[0]]=raw[24:24+w[2]-1].decode('ascii')
                elif op==31:ctx['stage'][w[1]]=ctx['shaders'][w[0]]
                elif op==1 and kind==6:ctx['views'][w[0]]=dict(resource=w[1],format=w[2]&0xffffff,first=w[4]&255,last=w[4]>>8&255,swizzle=[w[5]>>(3*i)&7 for i in range(4)])
                elif op==1 and kind==7:ctx['samplers'][w[0]]=dict(min=w[1]>>9&1,mip=w[1]>>11&3,mag=w[1]>>13&1)
                elif op==18:
                    for slot,handle in enumerate(w[2:],w[1]):ctx['sampleStates'][w[0],slot]=ctx['samplers'].get(handle)
                elif op==10:
                    for slot,handle in enumerate(w[2:],w[1]):ctx['bound'][w[0],slot]=ctx['views'].get(handle)
                elif op==1 and kind==8:ctx['surfaces'][w[0]]=dict(resource=w[1],format=w[2],level=w[3])
                elif op==5:ctx['colors']={slot:ctx['surfaces'][handle] for slot,handle in enumerate(w[2:]) if handle}
                elif op==7 and w[0]&4:
                    target=ctx['colors'][0]
                    if target['resource']==1:
                        predictions[hi]=dict(expected=w[1:5],draw=None)
                    else:
                        assert target['resource']==6 and target['format']==run['format'];p=originals[target['level']];packed=0
                        for lane,field in enumerate(d['rgbaFields']):packed|=min(w[1+lane],2**field['bits']-1)<<field['offset']
                        p['raw']=packed.to_bytes(d['guestPixelBytes'],'little')*(p['width']*p['height'])
                elif op==8:
                    stage,text=next((stage,text) for stage,text in ctx['stage'].items() if re.search(r'\b(?:TXF|TXL|TEX)\b',text))
                    op_match=re.search(r'\b(TXF|TXL|TEX) TEMP\[0\], IMM\[(\d+)\], SAMP\[(\d+)\], 2D',text);assert op_match
                    opcode,index,slot=op_match[1],int(op_match[2]),int(op_match[3]);view=ctx['bound'][stage,slot];assert view['format']==run['format'] and view['resource']==6
                    assert re.search(r'DCL SVIEW\['+str(slot)+r'\], 2D, UINT',text)
                    raw_imm=re.search(r'IMM\['+str(index)+r'\] (FLT32|INT32) \{([^}]+)\}',text);assert raw_imm
                    coordinate=list(map(float,raw_imm[2].split(',')));lod=int(coordinate[3]) if opcode!='TEX' else 0
                    p=originals[view['first']+lod];values=rgba(run['format'],p['raw'])
                    if opcode=='TXF':assert coordinate[:3]==[0,0,0];color=values[:4]
                    else:assert coordinate[:2]==[.5/p['width'],.5/p['height']];color=values[:4]
                    expected=[0 if lane==4 else 1 if lane==5 else color[lane] for lane in view['swizzle']]
                    draw=draws[history['label']];assert draw['args']==[4,0,6] and draw['native']['colors'][0]['componentType']==5125 and not draw['native']['blend']
                    sampler=draw['samplers'][0];assert len(draw['samplers'])==1 and sampler['type']==36306 and sampler['unit']==(16 if stage==0 else 0)+slot,(run['name'],stage,slot,sampler['unit'],sampler['type'])
                    correct_range=sampler['metadata']['format']==view['format'] and sampler['metadata']['width']==max(1,run['source']['width']>>view['first']) and sampler['base']==0 and sampler['last']==view['last']-view['first']
                    if not correct_range:assert control;differences.append(dict(run=ri,history=hi,kind='native-sample-range',observed=sampler['metadata'],view=view))
                    state=ctx['sampleStates'][stage,slot];assert state['min']==state['mag']==0 and state['mip'] in [0,2]
                    assert sampler['parameters']['TEXTURE_MAG_FILTER']==9728 and sampler['parameters']['TEXTURE_MIN_FILTER']==(9984 if state['mip']==0 else 9728)
                    if stage==0:assert 'GENERIC[0], CONSTANT' in ctx['stage'][1]
                    assert any(request['method']=='pair' and request['request']['vertexText']==ctx['stage'][0] and request['request']['fragmentText']==ctx['stage'][1] and request['result']['ok'] for request in run['requests'])
                    predictions[hi]=dict(expected=expected,draw=draw,view=view,originals={k:dict(v) for k,v in originals.items()})
            labels[history['label']]=hi
        for fi in run['frames']:
            frame=e['frames'][fi];assert frame['run']==ri;prediction=predictions[frame['historyIndex']];expected=prediction['expected'];native=load(frame['native'])
            actual=struct.unpack('<'+'I'*(len(native)//4),native);assert len(actual)==run['width']*run['height']*4
            miss=[dict(at=i,observed=a,expected=expected[i%4]) for i,a in enumerate(actual) if a!=expected[i%4]]
            if miss:differences.append(dict(run=ri,frame=fi,kind='sample',miss=miss[:16]))
            counts['components']+=len(actual);counts['frames']+=1
            if prediction['draw']:
                assert frame['completion']['sequence']>prediction['draw']['sequence'];assert frame['completion']['actual'] in [37146,37148]
                if frame.get('bindings'):
                    binding=frame['bindings'][0];view=prediction['view'];assert binding['texture']==prediction['draw']['samplers'][0]['texture']
                    for p in binding['planes']:
                        original=prediction['originals'][view['first']+p['local']];fmt=run['format'];observed=decoded_native(fmt,load(p['native']));wanted=rgba(fmt,original['raw'])
                        assert observed==wanted,'every original packed field in the retained native range';counts['rangeComponents']+=len(wanted)
            for plane in frame.get('outputs',[]):
                raw=load(plane['native']);assert raw==native if plane['level']==0 else raw==bytes(len(raw)),'all output mip planes remain isolated'
            if 'backing' in frame:
                out=load(frame['backing']);wanted=bytearray([0x2e]*len(out));commands=list(packets(run['history'][frame['publicHistory']]['hex']));assert len(commands)==1
                op,_,w,_=commands[0];assert op==43 and w[0]==1 and w[1]==0 and w[12]==2 and w[8:11]==[run['width'],run['height'],1]
                for y in range(run['height']):wanted[w[11]+y*w[3]:w[11]+y*w[3]+run['width']*16]=native[y*run['width']*16:(y+1)*run['width']*16]
                assert out==wanted,'native UINT values and every untouched public byte';counts['backingBytes']+=len(out)
            else:assert control and miss or frame.get('retired')
        for request in run['requests']:
            assert request['result']['ok'];counts['compilerResponses']+=1
            for stage in ([request['result']] if request['method']=='stage' else [request['result']['vertex'],request['result']['fragment']]):
                assert stage['metadata']['profile']=='virgl-webgl2-standard-integer-image-gles3-v1'
        if e['mode']=='sample-boundaries':
            refusals={h['label']:h for h in run['history'] if not h['result']['ok']}
            for prefix,code in [('packed-alias-identity-','incompatible-resource'),('packed-typed-FLOAT-','incompatible-resource'),('packed-typed-SINT-','incompatible-resource'),('packed-linear-min-','unsupported-sampler'),('packed-linear-mag-','unsupported-sampler'),('packed-linear-mip-','unsupported-sampler'),('packed-historical-closed-','unsupported-feature')]:
                refusal=next(h for label,h in refusals.items() if label.startswith(prefix));assert refusal['result']['error']['code']==code and refusal['label'] not in draws
                assert not any(event['label']==refusal['label'] and event['name'] in ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','blitFramebuffer'] for event in run['events']),'refusal precedes guest draw and private native range copy'
            reuse=next(a for a in run['actions'] if a.get('kind')=='source-id-reuse');assert reuse['newGeneration']>run['sourceGeneration'] and reuse['replacement']['format']!=run['format']
            assert load(run['replacementBackingAfter'])==load(reuse['backing']),'every replacement CPU byte survives GPU-only old-generation refresh'
            point=next(a for a in run['actions'] if a.get('kind')=='pending-native-range-and-target');assert point['renderer']['jobs']['status']=='finishing' and point['before']['budgets']['imageHolds']==2
            assert point['targetGeneration']>next(r['generation'] for r in run['created'] if r['metadata']['id']==1)
            terminal=run['actions'][-1]['result'];mode=run['terminalMode']
            if mode=='complete':assert terminal['ok'] and terminal['gpuComplete']
            else:assert terminal['error']['code']==('cancelled' if mode=='cancel' else 'disposed')
            if mode.endswith('dispose'):assert not any(event['cpu'] for event in run['events'] if event['name'] in ['readPixels','getBufferSubData'] and event['label'].startswith('packed-queued-'))
        for key,value in audit_native_lifetimes(run).items():counts[key]+=value
    assert bool(differences)==control and report['status']==('failed' if control else 'passed')
    if control:assert report['fault']=='sample-plane' and e['sabotage']['held'] is False and any(run['faultEvents'] for run in e['runs'])
    result=dict(status='refuted' if differences else 'passed',counts=counts,differences=differences,originalWireInverse=True,productImports=False,nativeUintTolerance=0,expectedPhysicalControl=control)
    (directory/'sample-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

if __name__=='__main__':main(sys.argv[1],len(sys.argv)>2 and sys.argv[2]=='--control')
