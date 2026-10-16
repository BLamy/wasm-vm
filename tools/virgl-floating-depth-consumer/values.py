#!/usr/bin/env python3
"""Invert original TGSI, packets and input bytes. No product or emitted GLSL oracle."""
import copy,gzip,hashlib,json,math,re,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'virgl-packed-unsigned-consumer'))
from pixels import packets,scalar,word,audit_native_lifetimes
sha=lambda raw:hashlib.sha256(raw).hexdigest()

def audit(directory,control=False):
    directory=Path(directory);envelope=json.loads((directory/'report.json').read_text());e=envelope.get('partial') or envelope['browserResult']['result']
    assert envelope['browserErrors']==dict(console=[],page=[],requests=[])
    blobs={r['key']:r for r in e['blobs']};assert len(blobs)==len(e['blobs'])
    def load(ref):
        row=blobs[ref['key']];assert row['sha256']==ref['sha256'];z=(directory/row['path']).read_bytes();assert sha(z)==row['gzipSha256'];raw=gzip.decompress(z)
        assert len(raw)==row['bytes'] and sha(raw)==row['sha256'];return raw
    counts=dict(runs=0,frames=0,outputWords=0,depthPixels=0,publicBytes=0,syncs=0,polls=0,cpuReads=0,compilerResponses=0);differences=[]
    def compare(raw,expected,where):
        if raw!=expected:
            misses=[dict(byte=i,observed=a,expected=b) for i,(a,b) in enumerate(zip(raw,expected)) if a!=b][:12]
            differences.append(dict(where=where,observedBytes=len(raw),expectedBytes=len(expected),misses=misses))
    def packed_depth(fmt,raw):
        bpp=4 if fmt==18 else 8;out=bytearray(raw)
        if fmt==126:
            for i in range(len(out)//bpp):out[i*bpp+5:i*bpp+8]=b'\0'*3
        return bytes(out)
    def diagnostic(fmt,p):
        raw=p['raw'];bpp=4 if fmt==18 else 8;out=bytearray();s8=bytearray()
        for i in range(p['width']*p['height']):
            out+=raw[i*bpp:i*bpp+4]+struct.pack('<III',0,0,1);s8+=bytes([raw[i*bpp+4] if fmt==126 else 0,0,0,0])
        return bytes(out+s8)
    def sample(ctx,planes):
        stage,text=next((stage,text) for stage,text in ctx['stage'].items() if re.search(r'\b(TXF|TXL|TEX|TXD|TXB|TXQ)\b',text));op=re.search(r'\b(TXF|TXL|TEX|TXD|TXB|TXQ) TEMP\[0\](?:\.xyw)?, IMM\[(\d+)\],(?: IMM\[\d+\], IMM\[\d+\],)? SAMP\[(\d+)\], 2D',text);assert op,text
        opcode,index,slot=op[1],int(op[2]),int(op[3]);view=ctx['bound'][stage,slot];state=ctx['sampleStates'][stage,slot];assert state['min']==state['mag']==0 and state['mip'] in [0,2]
        assert re.search(r'DCL SVIEW\['+str(slot)+r'\], 2D, FLOAT',text)
        immediates={int(i):list(map(float,values.split(','))) for i,typ,values in re.findall(r'^IMM\[(\d+)\] (FLT32|INT32) \{([^}]+)\}',text,re.M)};coord=immediates[index]
        if opcode=='TXQ':
            assert coord[0].is_integer();p=planes[view['first']+int(coord[0])];values=[p['width'],p['height'],0,view['last']-view['first']+1]
        else:
            lod=int(coord[3]) if opcode in ['TXL','TXF'] else 0
            if opcode=='TXD':
                m=re.search(r'TXD TEMP\[0\], IMM\[\d+\], IMM\[(\d+)\], IMM\[(\d+)\]',text);dx,dy=immediates[int(m[1])],immediates[int(m[2])];base=planes[view['first']]
                rho=max(math.hypot(dx[0]*base['width'],dx[1]*base['height']),math.hypot(dy[0]*base['width'],dy[1]*base['height']));lod=math.floor(math.log2(rho)+.5);assert rho==2
            p=planes[view['first']+lod];x,y=(int(coord[0]),int(coord[1])) if opcode=='TXF' else (math.floor(coord[0]*p['width']),math.floor(coord[1]*p['height']))
            assert 0<=x<p['width'] and 0<=y<p['height'];z=struct.unpack_from('<f',p['raw'],(y*p['width']+x)*(4 if view['format']==18 else 8))[0];base=[z,0,0,1];values=[0 if n==4 else 1 if n==5 else base[n] for n in view['swizzle']]
        return [word(v) for v in values],stage,slot,view,state
    for ri,run in enumerate(e['runs']):
        counts['runs']+=1;fmt=run['format'];assert fmt in [18,126];bpp=4 if fmt==18 else 8
        planes={p['level']:dict(p,raw=load(p['input'])) for p in run['planes']};backing=load(run['sourceBacking']);wanted=bytearray([0xa7]*len(backing))
        for p in planes.values():
            assert len(p['raw'])==p['width']*p['height']*bpp
            for y in range(p['height']):wanted[p['offset']+y*p['stride']:p['offset']+y*p['stride']+p['width']*bpp]=p['raw'][y*p['width']*bpp:(y+1)*p['width']*bpp]
        assert wanted==backing,'original segmented bytes and every input padding byte'
        assert load(run['positions'])==struct.pack('<24f',-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1)
        contexts={};predictions={};snapshots={};otherDepths={};draws={d['label']:d for d in run['draws']};assert len(draws)==len(run['draws']);color=None
        for hi,history in enumerate(run['history']):
            ctx=contexts.setdefault(history['ctx'],dict(shaders={},stage={},views={},bound={},samplers={},sampleStates={},surfaces={},colors={},depth=None,dsas={},dsa=dict(enabled=False,write=False,func=0)))
            for ci,(opcode,kind,w,raw) in enumerate(packets(history['hex'])):
                if ci>=history['result'].get('appliedCommands',history.get('appliedBeforeDispose',0)):continue
                if opcode==1 and kind==4:ctx['shaders'][w[0]]=raw[24:24+w[2]-1].decode('ascii')
                elif opcode==31:ctx['stage'][w[1]]=ctx['shaders'][w[0]]
                elif opcode==1 and kind==6:ctx['views'][w[0]]=dict(resource=w[1],format=w[2]&0xffffff,first=w[4]&255,last=w[4]>>8&255,swizzle=[w[5]>>(i*3)&7 for i in range(4)])
                elif opcode==1 and kind==7:ctx['samplers'][w[0]]=dict(min=w[1]>>9&1,mip=w[1]>>11&3,mag=w[1]>>13&1)
                elif opcode==10:
                    for slot,handle in enumerate(w[2:],w[1]):ctx['bound'][w[0],slot]=ctx['views'].get(handle)
                elif opcode==18:
                    for slot,handle in enumerate(w[2:],w[1]):ctx['sampleStates'][w[0],slot]=ctx['samplers'].get(handle)
                elif opcode==1 and kind==8:ctx['surfaces'][w[0]]=dict(resource=w[1],format=w[2],level=w[3])
                elif opcode==5:ctx['colors']={slot:ctx['surfaces'][handle] for slot,handle in enumerate(w[2:]) if handle};ctx['depth']=ctx['surfaces'].get(w[1])
                elif opcode==1 and kind==3:ctx['dsas'][w[0]]=dict(enabled=bool(w[1]&1),write=bool(w[1]&2),func=w[1]>>2&7)
                elif opcode==2 and kind==3:ctx['dsa']=ctx['dsas'][w[0]]
                elif opcode==7:
                    if w[0]&4:
                        assert ctx['colors'][0]['resource']==1;color=w[1:5]*(run['width']*run['height']);predictions[hi]=dict(color=list(color),planes=copy.deepcopy(planes),view=None)
                    if w[0]&1:
                        target=ctx['depth'];z=struct.unpack_from('<d',raw,24)[0]
                        if target['resource']!=6:otherDepths[target['resource'],target['level']]=z
                        else:
                            assert target['format']==fmt;p=planes[target['level']];updated=bytearray(p['raw'])
                            for i in range(p['width']*p['height']):struct.pack_into('<f',updated,i*bpp,z)
                            p['raw']=bytes(updated)
                elif opcode==8:
                    draw=draws[history['label']];native=draw['native'];colorSurface=ctx['colors'][0];assert draw['args']==[4,0,6] and native['colors'][0]['level']==colorSurface['level']
                    target=next(a for a in run['allocations'] if a['metadata']['id']==colorSurface['resource']);width=max(1,target['metadata']['width']>>colorSurface['level']);height=max(1,target['metadata']['height']>>colorSurface['level']);assert native['viewport']==[0,0,width,height]
                    compare(struct.pack('<I',native['colors'][0]['attachment']),struct.pack('<I',target['texture']),f'{ri}/{hi}/color-attachment')
                    assert native['colors'][0]['componentType']=={31:5126,196:5125,200:5124}[run['outputFormat']]
                    view=None
                    if run['kind']=='sample':
                        values,stage,slot,view,state=sample(ctx,planes);color=values*(width*height);sampler=draw['samplers'][0];assert len(draw['samplers'])==1 and sampler['type']==35678 and sampler['unit']==(16 if stage==0 else 0)+slot
                        assert sampler['parameters']['TEXTURE_MAG_FILTER']==9728 and sampler['parameters']['TEXTURE_MIN_FILTER']==(9984 if state['mip']==0 else 9728)
                        if sampler['metadata']['format']!=fmt or sampler['metadata']['id']!=6:differences.append(dict(where=f'{ri}/{hi}/native-sampler',observed=sampler['metadata'],expectedFormat=fmt))
                        assert sampler['base']==0 and sampler['last']==view['last']-view['first'];assert not native['depthTest']
                    else:
                        imm=re.search(r'IMM\[0\] UINT32 \{([^}]+)\}',ctx['stage'][1]);assert imm;words=[int(v) for v in imm[1].split(',')];assert len(words)==4
                        dsa=ctx['dsa'];target=ctx['depth'];p=planes[target['level']] if target['resource']==6 else None;updated=bytearray(p['raw']) if p else None;assert native['depthTest']==dsa['enabled'] and native['depthMask']==dsa['write'] and native['depthFunction']==512+dsa['func'] and not native['stencilTest']
                        texture=next(a['texture'] for a in run['allocations'] if a['metadata']['id']==target['resource']);depth=native['depth'];compare(struct.pack('<I',depth[0]['texture']),struct.pack('<I',texture),f'{ri}/{hi}/depth-attachment');assert depth[0]['level']==target['level']
                        if depth[1]['texture']!=(texture if target['format']==126 else None):differences.append(dict(where=f'{ri}/{hi}/stencil-attachment',observed=depth[1]['texture'],expected=texture if target['format']==126 else None))
                        for i in range(width*height):
                            z=struct.unpack_from('<f',updated,i*bpp)[0] if p else otherDepths[target['resource'],target['level']];passed=not dsa['enabled'] or [False,.5<z,.5==z,.5<=z,.5>z,.5!=z,.5>=z,True][dsa['func']]
                            if passed:color[i*4:i*4+4]=words
                            if passed and dsa['enabled'] and dsa['write']:assert p is not None;struct.pack_into('<f',updated,i*bpp,.5)
                        if p:p['raw']=bytes(updated)
                    assert any(q['method']=='pair' and q['request']['vertexText']==ctx['stage'][0] and q['request']['fragmentText']==ctx['stage'][1] and q['result']['ok'] for q in run['requests']);counts['compilerResponses']+=1
                    predictions[hi]=dict(color=list(color),planes=copy.deepcopy(planes),view=view,draw=draw)
            snapshots[hi]=copy.deepcopy(planes)
        for fi in run['frames']:
            frame=e['frames'][fi];pred=predictions[frame['historyIndex']];expected=struct.pack('<'+'I'*len(pred['color']),*pred['color']);compare(load(frame['native']),expected,f'{ri}/{fi}/color');counts['frames']+=1;counts['outputWords']+=len(pred['color'])
            if pred.get('draw'):assert frame['completion']['sequence']>pred['draw']['sequence'] and frame['completion']['actual'] in [37146,37148]
            for p in frame.get('outputs',[]):compare(load(p['native']),expected if p['level']==run['outputLevel'] else bytes(p['width']*p['height']*16),f'{ri}/{fi}/output-mip{p["level"]}')
            for kind in ['bindings','depths']:
                for binding in frame.get(kind,[]):
                    if kind=='bindings':assert binding['texture']==pred['draw']['samplers'][0]['texture']
                    for p in binding['planes']:
                        original=pred['planes'][p['original']];assert p['width']==original['width'] and p['height']==original['height'];compare(load(p['native']),diagnostic(fmt,original),f'{ri}/{fi}/{kind}/mip{p["original"]}');counts['depthPixels']+=p['width']*p['height']
            if 'backing' in frame:
                history=run['history'][frame['publicHistory']];op,kind,w,raw=next(packets(history['hex']));assert op==43 and w[0]==1 and w[12]==2 and w[1]==run['outputLevel'];wanted=bytearray([0x2e]*20000)
                for y in range(w[9]):wanted[w[11]+y*w[3]:w[11]+y*w[3]+w[8]*16]=expected[y*w[8]*16:(y+1)*w[8]*16]
                compare(load(frame['backing']),wanted,f'{ri}/{fi}/public');counts['publicBytes']+=len(wanted)
        if 'depthClear' in run:
            cleared=snapshots[run['clearEvents'][-1]['historyIndex']]
            for binding in run['depthClear']['depths']:
                for p in binding['planes']:compare(load(p['native']),diagnostic(fmt,cleared[p['original']]),f'{ri}/full-clear/mip{p["original"]}');counts['depthPixels']+=p['width']*p['height']
        for action in run['actions']:
            if action.get('kind')!='depth-public':continue
            wanted=bytearray(load(action['backingBefore']))
            for read in action['reads']:
                hi=read['historyIndex'];op,kind,w,raw=next(packets(run['history'][hi]['hex']));assert op==43 and w[0]==6 and w[12]==2;p=snapshots[hi][w[1]];raw=packed_depth(fmt,p['raw'])
                for y in range(w[9]):wanted[w[11]+y*w[3]:w[11]+y*w[3]+w[8]*bpp]=raw[y*w[8]*bpp:(y+1)*w[8]*bpp]
                compare(load(read['backing']),wanted,f'{ri}/{hi}/depth-public');counts['publicBytes']+=len(wanted)
        if 'replacementBackingAfter' in run:
            action=next(a for a in run['boundaries'] if a.get('kind')=='source-id-reuse');assert action['fresh']>action['old'];compare(load(run['replacementBackingAfter']),load(action['backing']),f'{ri}/replacement-all-bytes')
        if 'nonoverlap' in run:
            row=run['nonoverlap'];pred=predictions[row['historyIndex']];compare(load(row['native']),struct.pack('<'+'I'*len(pred['color']),*pred['color']),f'{ri}/disjoint-depth-output');counts['outputWords']+=len(pred['color'])
        for key,value in audit_native_lifetimes(run).items():counts[key]+=value
    result=dict(schema='original-floating-depth-consumer-independent-inverse-v1',status='refuted' if differences else 'passed',oracleImportsProductCode=False,originalShaderWireAndInputAreAuthority=True,counts=counts,differences=differences)
    if control:
        assert differences,'actual native corruption must be rejected';result['physicalControl']=dict(fault=e['fault'],recordedPhysicalEvents=sum(len(r['faultEvents']) for r in e['runs']))
        if e['fault'].startswith('completed-'):
            corrupt=next(r['corruption'] for r in e['runs'] if 'corruption' in r);assert corrupt['after']['sync']!=corrupt['before']['sync'] and corrupt['after']['sequence']>corrupt['before']['sequence'] and corrupt['after']['actual'] in [37146,37148];result['physicalControl']['distinctSecondFence']=True
        else:assert result['physicalControl']['recordedPhysicalEvents']>0
    else:assert not differences,differences[:3]
    (directory/'value-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status=result['status'],counts=counts,differences=len(differences))))
    return result

def main(root):
    root=Path(root)
    if (root/'report.json').exists():return audit(root,'--control' in sys.argv)
    records={}
    for file in sorted(root.glob('hardware-*/report.json')):records[file.parent.name]=audit(file.parent)
    for file in sorted(root.glob('fault-*/report.json')):records[file.parent.name]=audit(file.parent,True)
    assert records
    (root/'independent-values.json').write_text(json.dumps(dict(status='passed',oracleImportsProductCode=False,records=records),indent=2)+'\n')
if __name__=='__main__':main(sys.argv[1])
