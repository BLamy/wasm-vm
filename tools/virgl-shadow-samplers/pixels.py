#!/usr/bin/env python3
"""Derive whole planes from original packets and inputs, never emitted ESSL."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
from oracle import declarations, execute, fw, wf
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'virgl-unorm-depth'))
from lifetimes import audit_lifetimes

sha=lambda raw:hashlib.sha256(raw).hexdigest()
def packets(raw):
    at=0
    while at<len(raw):
        head=struct.unpack_from('<I',raw,at)[0];n=head>>16
        assert at+4*(n+1)<=len(raw)
        words=list(struct.unpack_from('<'+'I'*n,raw,at+4))
        yield head&255,head>>8&255,words,raw[at:at+4*(n+1)]
        at+=4*(n+1)
    assert at==len(raw)

def audit(directory,control=False):
    directory=Path(directory);report=json.loads((directory/'report.json').read_text())
    assert report['task']=='E6-T11d49' and report['status']==('failed' if control else 'passed')
    a=report.get('partial') or report['browserResult']['result']
    assert 'Metal' in a['gpu'] and 'M4' in a['gpu'] and not a['guestExecution'] and not a['productionNegotiation']
    assert report['browserErrors']==dict(console=[],page=[],requests=[])
    blobs={}
    for ref in a['blobs']:
        rawzip=(directory/ref['path']).read_bytes();assert sha(rawzip)==ref['gzipSha256']
        raw=gzip.decompress(rawzip);assert len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];blobs[ref['key']]=raw
    def body(ref):
        raw=blobs[ref['key']];assert len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];return raw
    rows=[];differences=[];counts=dict(runs=0,frames=0,pixels=0,words=0,refusals=0,consumedSyncs=0,disposalOnlySyncs=0)
    for ref in a['runs']:
        if 'path' in ref:
            raw=(directory/ref['path']).read_bytes();assert len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];r=json.loads(raw)
        else:r=ref
        counts['runs']+=1
        assert all(obj['deleted']==1 for obj in r['nativeObjects'])
        assert all(sync['deleted']==1 for sync in r['fenceObjects'])
        assert all(v==0 for budgets in [r['final']['renderer']['budgets'],r['final']['resources']['budgets']] for v in budgets.values())
        physical=audit_lifetimes(r);counts['disposalOnlySyncs']+=sum('completed' not in f for f in r['fenceObjects'])
        for upload in r['uploads']:
            if upload['bytes']:body(upload['bytes'])
        for read in r['readbacks']:
            if read['bytes']:body(read['bytes'])
        if not r['frames']:
            counts['refusals']+=1;assert r.get('refused')
            assert not r['shadowStates'] or r.get('recovered')
            rows.append(dict(name=r['name'],refusal=True));continue
        original_inputs=[body(ref) for ref in r['inputs']]
        for i,raw in enumerate(original_inputs):
            allocation=next(a for a in r['allocations'] if a['metadata']['id']==[3,4,5,7][i])
            uploads=[u for u in r['uploads'] if u['name']=='bufferSubData' and u.get('buffer')==allocation['buffer']]
            assert uploads and all(body(u['bytes'])==raw and u['args'][1]==0 for u in uploads)
        depth_original={p['level']:p for p in r['planes']}
        source_metadata=r['source']['metadata'];format=source_metadata['format'];source_texture=next(a['texture'] for a in r['allocations'] if a['metadata']['id']==6)
        bpp=16 if format in [196,200] else 8 if format==126 else 2 if format==16 else 4
        backing=bytearray([0xa7]*len(body(r['source']['backing'])))
        for p in r['planes']:
            raw=body(p['input']);assert len(raw)==p['width']*p['height']*bpp
            for y in range(p['height']):backing[p['offset']+y*p['stride']:p['offset']+y*p['stride']+p['width']*bpp]=raw[y*p['width']*bpp:(y+1)*p['width']*bpp]
            upload=next(u for u in r['uploads'] if u['name']=='texSubImage2D' and u.get('texture')==source_texture and u['args'][1]==p['level'])
            expected=raw if format!=21 else b''.join(struct.pack('<I',((w&0xffffff)*0xffffffff+0x7fffff)//0xffffff) for w in struct.unpack('<'+'I'*(len(raw)//4),raw))
            if upload['bytes'] is None:
                assert format==126 and upload['type']=='PBO' and upload['args'][6:]==[34041,36269]
                buffer=next(a['uploadBuffer'] for a in r['allocations'] if a['metadata']['id']==6)
                staged=[u for u in r['uploads'] if u['name']=='bufferSubData' and u.get('buffer')==buffer and u['sequence']<upload['sequence']][-1]
                assert staged['sequence']+1==upload['sequence'] and staged['args']==[35052,0]
                assert body(staged['bytes'])==expected
            else:assert body(upload['bytes'])==expected
            assert upload['args'][4:6]==[p['width'],p['height']]
        assert bytes(backing)==body(r['source']['backing'])
        for frame in r['frames']:
            objects={};views={};samplers={};shaders={}
            for h in r['history'][:frame['historyIndex']+1]:
                for op,kind,w,raw in packets(bytes.fromhex(h['hex'])):
                    if op==1 and kind in [6,7]:objects[kind,w[0]]=w[:]
                    if op==3 and kind in [6,7]:objects.pop((kind,w[0]),None)
                    if op==1 and kind==4:
                        text=raw[24:24+w[2]-1].decode('ascii');assert raw[24+w[2]-1]==0
                        objects[4,w[0]]=(w[1],text)
                    if op==31 and w[0]:shaders[w[1]]=objects[4,w[0]][1]
                    if op in [10,18]:
                        bound=views if op==10 else samplers
                        for offset,handle in enumerate(w[2:]):bound[w[0],w[1]+offset]=objects[(6 if op==10 else 7),handle] if handle else None
            assert shaders[0]==r['vertexText'] and shaders[1]==r['fragmentText']
            states=[s for s in r['shadowStates'] if s['eventSequence']<frame['completion']['sequence']]
            assert states;state=states[-1];writer=state['eventSequence'];assert state['args']==[0,0,r['width']*r['height']]
            draw=next(d for d in r['draws'] if d['sequence']==writer)
            for attribute in draw['attributes']:
                index=int(attribute['name'].removeprefix('in_'));allocation=next(a for a in r['allocations'] if a['metadata']['id']==[3,4,5,7][index])
                assert attribute['buffer']==allocation['buffer'] and attribute['stride']==16 and attribute['offset']==0 and not attribute['integer'] and attribute['divisor']==0
            events=r['events'];sync=frame['completion']['sync'];created=next(e for e in events if e['name']=='fenceSync' and e['sync']==sync)
            consumed=next(e for e in events if e['name']=='clientWaitSync' and e['sync']==sync and e['delivered'] in [37146,37148])
            deleted=next(e for e in events if e['name']=='deleteSync' and e['sync']==sync)
            read=next(e for e in r['readbacks'] if e['name']=='readPixels' and e['cpu'] and e['bytes']['sha256']==frame['native']['sha256'] and e['sequence']>deleted['sequence'])
            assert writer<created['sequence']<=consumed['sequence']<deleted['sequence']<read['sequence']
            assert frame['completion']['sequence']==consumed['sequence'];counts['consumedSyncs']+=1
            stage_inputs={};depths={};descriptions={};native_uniforms={u['name']:u for u in state['before']['uniforms']}
            for owner in [0,1]:
                prefix='vs' if owner==0 else 'fs';text=shaders[owner]
                slots=set(int(m[1]) for m in re.finditer(r'SAMP\[(\d+)\], (?:2D|SHADOW2D)',text))
                for slot in slots:
                    vw,sw=views[owner,slot],samplers[owner,slot];assert vw and sw
                    index=vw[4]&255;last=vw[4]>>8&255;format=vw[2]&0xffffff
                    lanes=[vw[5]>>(3*i)&7 for i in range(4)];assert all(v<=5 for v in lanes)
                    bits=sw[1];description=dict(function=bits>>16&7,minLod=wf(sw[3]),maxLod=wf(sw[4]),fixedPoint=format in [16,20,21],integerColors=format in [196,200]);assert bits>>15&1==1 or 'same-image' in r['name'] or description['integerColors']
                    depth={}
                    for original_level in range(index,last+1):
                        p=depth_original[original_level];raw=body(p['input']);bpp=16 if description['integerColors'] else 8 if format==126 else 2 if format==16 else 4
                        values=[struct.unpack_from('<4I',raw,i*16) if description['integerColors'] else struct.unpack_from('<H',raw,i*2)[0]/65535 if format==16 else ((struct.unpack_from('<I',raw,i*4)[0]>>8) if format==20 else struct.unpack_from('<I',raw,i*4)[0]&0xffffff)/0xffffff if format in [20,21] else struct.unpack_from('<f',raw,i*bpp)[0] for i in range(p['width']*p['height'])]
                        assert len(set(values))==1;depth[original_level-index]=dict(width=p['width'],height=p['height'],value=values[0])
                    depths[owner,slot]=depth;descriptions[owner,slot]=description,lanes
                    native=next((s for s in state['before']['samplers'] if s['name']==prefix+'samp'+str(slot)),None)
                    if native is None:
                        assert r.get('reflection')=='pruned';continue
                    assert native['unit']==slot+(16 if owner==0 else 0)
                    params=native['parameters'];assert params['TEXTURE_COMPARE_MODE']==(34894 if bits>>15&1 else 0)
                    assert native['type']==(35682 if 'SAMP['+str(slot)+'], SHADOW2D' in text else 36306 if format==196 else 36298 if format==200 else 35678)
                    assert params['TEXTURE_MIN_LOD']==description['minLod'] and params['TEXTURE_MAX_LOD']==description['maxLod']
                    assert params['TEXTURE_MAG_FILTER']==(9729 if bits>>13&1 else 9728)
                    if index==0:assert native['texture']==source_texture
                    if not control or frame is r['frames'][0]:assert params['TEXTURE_COMPARE_FUNC']==512+description['function']
                    if re.search(r'^\d+: (?:TEX|TXL|TXD|TXP|TXB) [^\n]*SAMP\['+str(slot)+r'\], SHADOW2D$',text,re.M):
                        for semantic,expected in [('mask',[int(c<4) for c in lanes]),('add',[int(c==5) for c in lanes])]:
                            u=native_uniforms.get(prefix+'shad'+semantic+str(slot))
                            assert u or r.get('reflection')=='pruned'
                            if u:
                                assert u['size']==1 and u['type']==35666
                                if not control or frame is r['frames'][0]:assert u['value']==expected
            wanted=[]
            for pixel in range(r['width']*r['height']):
                inputs={i:list(struct.unpack_from('<4I',raw,pixel*16)) for i,raw in enumerate(original_inputs)}
                # Each original point covers exactly its assigned pixel center.
                pos=[wf(v) for v in inputs[0]];assert pos[2:]==[0,1]
                assert abs((pos[0]+1)*r['width']/2-(pixel%r['width']+.5))<1e-5
                assert abs((pos[1]+1)*r['height']/2-(pixel//r['width']+.5))<1e-5
                def run(owner,input):
                    selected=[k for k in descriptions if k[0]==owner]
                    desc,lanes=descriptions[selected[0]] if selected else (dict(function=0,minLod=0,maxLod=0),[0,1,2,3])
                    depth=depths[selected[0]] if selected else {0:dict(width=1,height=1,value=0)}
                    return execute(shaders[owner],input,pixel,0,0,{**desc,'bySlot':{k[1]:(descriptions[k][0],depths[k],descriptions[k][1]) for k in selected}},depth,lanes)
                vs=run(0,inputs);vout=declarations(shaders[0],'OUT');fin=declarations(shaders[1],'IN')
                fs_inputs={i:vs[next(o for o,s in vout.items() if s==semantic)] for i,semantic in fin.items()}
                result=run(1,fs_inputs)[0];wanted.extend(result)
            wanted=struct.pack('<'+'I'*len(wanted),*wanted);assert wanted==body(r['expected'])
            observed=body(frame['native']);assert len(observed)==len(wanted)
            words_a=struct.unpack('<'+'I'*(len(observed)//4),observed);words_b=struct.unpack('<'+'I'*(len(wanted)//4),wanted)
            miss=[dict(word=i,expected=b,observed=a) for i,(a,b) in enumerate(zip(words_a,words_b)) if a!=b]
            differences.extend(dict(name=r['name'],frame=frame['label'],writer=writer,sync=sync,read=read['sequence'],**m) for m in miss)
            counts['frames']+=1;counts['pixels']+=len(words_a)//4;counts['words']+=len(words_a)
            rows.append(dict(name=r['name'],frame=frame['label'],writer=writer,sync=sync,created=created['sequence'],consumed=consumed['sequence'],deleted=deleted['sequence'],read=read['sequence'],expectedSha256=sha(wanted),observedSha256=sha(observed),mismatches=len(miss)))
    assert bool(differences)==control
    result=dict(status='refuted' if control else 'passed',originalPacketsAndAllBodiesReopened=True,oracleImportsProduct=False,reportSha256=sha((directory/'report.json').read_bytes()),counts=counts,frames=rows,differences=differences)
    (directory/('control-audit.json' if control else 'pixels-audit.json')).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ['frames','differences']}))
    return result

if __name__=='__main__':audit(sys.argv[1],'--control' in sys.argv)
