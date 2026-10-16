#!/usr/bin/env python3
"""Independent original-packet/native-state, finest-coverage and hand-point audit."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess

ROOT=Path(__file__).resolve().parents[2]
BASE='ff80836249c9f235cae516421498a574b51b6f9c'
FREEZE='c510692cc77e0f0c99d1e2f28dff9de6de2f3372'
NATIVE_DRAWS=['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']
OPS=[7680,0,7681,7682,7683,34055,34056,5386]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT)

def packets(text):
    raw=bytes.fromhex(text);at=0
    while at<len(raw):
        h,=struct.unpack_from('<I',raw,at);n=h>>16;end=at+4*(n+1)
        assert end<=len(raw)
        yield h&255,h>>8&255,list(struct.unpack_from('<'+'I'*n,raw,at+4)),raw[at:end]
        at=end
    assert at==len(raw)

def original(row,label='ordered-draw'):
    ctx=next(h['ctx'] for h in row['history'] if h['label']==label)
    objects={};s={'refs':[0,0],'raster':0,'elements':[],'bindings':[],'shaderHandles':{}}
    for history in row['history']:
        if history['ctx']!=ctx:continue
        for op,kind,w,raw in packets(history['hex']):
            if op==1:objects[kind,w[0]]=w
            if op==1 and kind==4:objects['shader',w[0]]=raw[24:24+w[2]-1].decode()
            if op==2 and kind==3:s['dsa']=objects[kind,w[0]]
            if op==2 and kind==2:s['raster']=objects[kind,w[0]][1]
            if op==2 and kind==5:s['elements']=[objects[kind,w[0]][i:i+4] for i in range(1,len(objects[kind,w[0]]),4)]
            if op==6:s['bindings']=[w[i:i+3] for i in range(0,len(w),3)]
            if op==11:s['index']=w
            if op==13:s['refs']=[w[0]&255,w[0]>>8&255]
            if op==31:s['shaderHandles'][w[1]]=w[0]
            if op==8:s['draw']=w
        if history['label']==label:break
    s['shaders']={stage:objects['shader',handle] for stage,handle in s['shaderHandles'].items()}
    return s

def face(w,reference):
    return dict(STENCIL_FUNC=512+(w>>1&7),STENCIL_REF=reference,STENCIL_VALUE_MASK=w>>13&255,
                STENCIL_WRITEMASK=w>>21&255,STENCIL_FAIL=OPS[w>>4&7],
                STENCIL_PASS_DEPTH_FAIL=OPS[w>>10&7],STENCIL_PASS_DEPTH_PASS=OPS[w>>7&7])

def assembly(mode,ids):
    if mode==0:return [[n] for n in ids]
    if mode==1:return [ids[i:i+2] for i in range(0,len(ids)-1,2)]
    if mode in [2,3]:return [ids[i-1:i+1] for i in range(1,len(ids))]+([[ids[-1],ids[0]]] if mode==2 and len(ids)>=2 else [])
    if mode==4:return [ids[i:i+3] for i in range(0,len(ids)-2,3)]
    if mode==5:return [[ids[i-2],ids[i-1],ids[i]] if i%2==0 else [ids[i-1],ids[i-2],ids[i]] for i in range(2,len(ids))]
    assert mode==6
    return [[ids[0],ids[i-1],ids[i]] for i in range(2,len(ids))]

class Recording:
    def __init__(self,directory):
        self.directory=Path(directory);self.report_raw=(self.directory/'report.json').read_bytes()
        self.report=json.loads(self.report_raw);self.e=self.report['browserResult'].get('result') or self.report['partial']
        assert self.report['browserErrors']==dict(console=[],page=[],requests=[])
        assert self.report['browser']['headless'] is False
        assert 'Metal' in self.e['gpu'] and 'M4' in self.e['gpu']
        assert not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)',arg,re.I) for arg in self.report['browser']['commandLine'])
        assert not self.e['guestExecution'] and not self.e['productionNegotiation']
        self.blobs={};self.counts={'bodies':0,'runs':0,'nativeCalls':0,'gpuIndexBytes':0,'gpuVertexBytes':0}
        for ref in self.e['blobs']:
            assert ref['key'] not in self.blobs
            z=(self.directory/ref['path']).read_bytes();raw=gzip.decompress(z)
            assert sha(z)==ref['gzipSha256'] and len(raw)==ref['bytes'] and sha(raw)==ref['sha256']
            self.blobs[ref['key']]=(ref,raw);self.counts['bodies']+=1
    def body(self,ref):
        r,raw=self.blobs[ref['key']];assert (r['bytes'],r['sha256'])==(ref['bytes'],ref['sha256']);return raw
    def rows(self):
        for ref in self.e['runs']:
            if 'path' in ref:
                raw=(self.directory/ref['path']).read_bytes();assert len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];row=json.loads(raw);digest=sha(raw)
            else:row=ref;digest=sha(json.dumps(row,separators=(',',':')).encode())
            self.counts['runs']+=1
            yield row,digest

def native(directory):
    r=Recording(directory);assert r.report['status']=='passed';citations=[];modes=set();widths=set();instances=set();states=set()
    for row,digest in r.rows():
        s=original(row);d=s['draw'];count,mode,indexed,effective=d[1],d[2],bool(d[3]),max(1,d[4])
        modes.add(mode);instances.add(d[4]);buffers={p['id']:r.body(p['input']) for p in row['buffers']}
        if row.get('failurePhase'):
            # The full independent output/guard/suffix inverse is run separately;
            # this direct check anchors the actual attempted native call counts.
            phase=row['failurePhase'];calls=[p for p in row['draws'] if p['label']=='ordered-draw']
            expected=3 if phase=='draw' else 8 if phase in ['allocation','upload'] else 0
            assert len(calls)==expected and not row['execution']['result']['ok'] and row['execution']['result']['gpuComplete']
            citations.append(dict(run=row['name'],bodySha256=digest,failure=phase,nativeCallSequences=[c['sequence'] for c in calls]));continue
        ids=list(range(d[0],d[0]+count))
        if indexed:
            index,size,offset=s['index'];widths.add(size);raw=buffers[index]
            ids=[int.from_bytes(raw[offset+i*size:offset+(i+1)*size],'little') for i in range(count)]
            assert offset+count*size<=len(raw)
        segments=[[]]
        for n in ids:
            if indexed and d[7] and n==d[8]:segments.append([])
            else:segments[-1].append(n)
        primitives=[p for segment in segments for p in assembly(mode,segment)]
        front,back=s['dsa'][2:4];front_only=bool(front&1) and not back&1
        faces=[face(front,s['refs'][0]),face(front,s['refs'][0]) if front_only else face(back,s['refs'][1])]
        present=row['format'] in [20,126];common=all(faces[0][k]==faces[1][k] for k in ['STENCIL_REF','STENCIL_VALUE_MASK','STENCIL_WRITEMASK'])
        active=bool((front|back)&1)
        lowering=('front' if mode<=3 or s['raster']>>8&3==2 else 'triangles') if present and active and not common else None
        states.add((active,front_only,lowering));split=lowering=='triangles';assembled=split or mode in [2,6]
        native_ids=[n for p in primitives for n in p] if assembled else [0xffffffff if indexed and d[7] and n==d[8] else n for n in ids]
        native_indexed=indexed or assembled;native_mode=4 if split else 1 if mode==2 else 4 if mode==6 else mode
        calls=[p for p in row['draws'] if p['label']=='ordered-draw'];observed=[p for p in row['orderedStates'] if p['label']=='ordered-draw' and p['name'] in NATIVE_DRAWS]
        completed=len(row['execution']['result']['draws']);expected_calls=(len(primitives)*2 if split else 1)*completed
        assert len(calls)==len(observed)==expected_calls
        assert len(native_ids)*effective*(2 if split else 1)<=count*effective*6
        assert (len(primitives)*2 if split else 1)<=count*effective*2
        for i,(call,state) in enumerate(zip(calls,observed)):
            args=[4,3,5125,i%(len(primitives)*2)//2*12] if split else [native_mode,len(native_ids),5125,0] if native_indexed else [native_mode,d[0],count]
            if effective>1:args.append(effective)
            assert call['args']==state['args']==state['delivered']==args
            assert call['name']==('drawElements' if native_indexed else 'drawArrays')+('Instanced' if effective>1 else '')
            n=state['before']['native'];assert n['provoking']==0x8e4e
            selected=i%2 if split else 0 if lowering=='front' else None
            assert n['stencil']['faces']==faces if selected is None else n['stencil']['faces']==[faces[selected]]*2
            assert n['stencil']['enabled']==active and n['stencil']['frontFace']==(2304 if s['raster']>>15&1 else 2305)
            assert n['cull']==(split or s['raster']>>8&3==2) and n['cullFace']==(1028 if split and i%2 else 1029)
            assert state['after']['eventSequence']==call['sequence']
            assert call['native']['scissor']==bool(s['raster']>>14&1)
            assert call['native']['depthTest']==bool(s['dsa'][1]&1) and call['native']['depthMask']==bool(s['dsa'][1]&2)
            assert call['native']['depthFunction']==512+(s['dsa'][1]>>2&7)
            for slot,e in enumerate(s['elements']):
                off,divisor,binding,fmt=e;stride,base,resource=s['bindings'][binding]
                a=next(a for a in state['before']['vertexInputs'] if a['name']=='in_'+str(slot))
                assert a['enabled']==bool(stride) and a['components']==fmt-27 and a['type']==5126 and not a['normalized']
                assert a['divisor']==(min(divisor,65536) if stride else 0)
                if stride:
                    assert a['stride']==stride and a['offset']==base+off
                    body=next(b for b in row['vertexInputBodies'] if b['buffer']==a['buffer'])
                    actual=r.body(body['bytes']);assert actual==buffers[resource]
                    r.counts['gpuVertexBytes']+=len(actual)
                else:assert a['genericValues']==list(struct.unpack_from('<4f',buffers[resource],base+off))
            pairs=[p for p in row['requests'] if p['method']=='pair' and p['result']['ok'] and p['request']['vertexText']==s['shaders'][0] and p['request']['fragmentText']==s['shaders'][1]];assert pairs
            for shader in call['shaders']:
                text=pairs[-1]['result']['vertex' if shader['type']==35633 else 'fragment']['glsl'];assert shader['glsl']==text
                assert any(e['name']=='shaderSource' and e['sequence']<call['sequence'] and e['args'][1]==text for e in row['events'])
            r.counts['nativeCalls']+=1
        entries=[p for p in row['orderedIndices'] if p['label']=='ordered-draw'];assert len(entries)==(completed if native_indexed else 0)
        for i,p in enumerate(entries):
            wanted=struct.pack('<'+'I'*len(native_ids),*native_ids)
            assert r.body(p['input'])==r.body(p['gpu'])==wanted and p['deleted']
            assert p['inspection']['normalizedBytes']==len(wanted)*(i+1) and p['inspection']['normalizedBuffers']==i+1
            assert p['inspection']['normalizationScratchBytes']==len(wanted)
            completion=p['retirement']['completion'];assert completion['actual'] in [37146,37148] and completion['delivered'] in [37146,37148]
            assert not calls or completion['sequence']>calls[-1]['sequence']
            assert p['retirement']['inspection']['normalizationScratchBytes']==0
            r.counts['gpuIndexBytes']+=len(wanted)
        # Preflight/capture budget refusals issue no lowered draw and must not
        # acquire authority to overwrite a caller's arbitrary native poison.
        if row.get('restored') and (completed or row['execution']['result']['ok']):
            assert row['restored']['stencil']['faces']==faces and row['restored']['cull']==(s['raster']>>8&3==2)
            assert row['restored']['cullFace']==1029
        citations.append(dict(run=row['name'],bodySha256=digest,drawWords=d,originalIds=ids,originalPrimitives=primitives,
                              lowering=lowering,nativeCallSequences=[c['sequence'] for c in calls],normalizedBodyDigests=[p['gpu']['sha256'] for p in entries]))
    return dict(status='passed',reportSha256=sha(r.report_raw),counts=r.counts,modes=sorted(modes),indexWidths=sorted(widths),instanceFields=sorted(instances),citations=citations)

def coverage(directory):
    directory=Path(directory);name='renderer/virgl-command/state.mjs';body=git('show',FREEZE+':'+name);old=git('show',BASE+':'+name)
    additions=[];line=0
    for row in git('diff','--unified=0',BASE,FREEZE,'--',name).decode().splitlines():
        if row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
        elif row.startswith('+') and not row.startswith('+++'):additions.append(line);line+=1
        elif row.startswith(' '):line+=1
    records=[]
    for p in sorted(directory.rglob('browser-coverage.json')):
        if any(part.startswith('fault-') for part in p.parts):continue
        for s in json.loads(p.read_text())['scripts']:
            if s['source']==name:
                assert s['sourceBody'].encode()==body and s['sha256']==sha(body)
                records.append((p.relative_to(directory).as_posix(),sha(p.read_bytes()),s['coverage']))
    for p in sorted((directory/'node-coverage').glob('coverage-*.json')):
        for s in json.loads(p.read_text())['result']:
            if s['url'].startswith('file:') and s['url'].endswith('/'+name):
                assert (directory/'wire/source'/name).read_bytes()==body
                records.append((p.relative_to(directory).as_posix(),sha(p.read_bytes()),s))
    offsets=[0]
    for l in body.decode().splitlines(keepends=True):offsets.append(offsets[-1]+len(l.encode('utf-16-le'))//2)
    waivers={(w['startOffset'],w['endOffset']):w for w in json.loads((ROOT/'tools/virgl-ordered-stencil/coverage-waivers.json').read_text())['waivers']}
    partitions=[]
    for line in additions:
        a,b=offsets[line-1:line+1];cuts={a,b}
        for _,_,s in records:
            for f in s['functions']:
                for r in f['ranges']:cuts.update(o for o in [r['startOffset'],r['endOffset']] if a<o<b)
        for start,end in zip(sorted(cuts),sorted(cuts)[1:]):
            counters=[]
            for record,digest,s in records:
                governing=[r for f in s['functions'] for r in f['ranges'] if r['startOffset']<=start and end<=r['endOffset']]
                if governing:counters.append(dict(record=record,recordSha256=digest,**min(governing,key=lambda r:r['endOffset']-r['startOffset'])))
            count=max([c['count'] for c in counters] or [0]);p=dict(source=name,line=line,startOffset=start,endOffset=end,count=count,finestGoverningCounters=counters)
            if count==0:
                w=waivers[start,end];text=body.decode().encode('utf-16-le')[start*2:end*2].decode('utf-16-le')
                assert w['classification']=='unchanged-operand' and text==w['text'] and sha(text.encode())==w['sha256'] and sha(old)==w['predecessorSourceSha256']
                assert old.decode().encode('utf-16-le')[w['predecessorStartOffset']*2:w['predecessorEndOffset']*2].decode('utf-16-le')==text
                assert 'PROFILE' in text or text==': {}','waiver of new runtime logic'
                p['unchangedOperandWaiver']=w
            partitions.append(p)
    positive=sum(p['count']>0 for p in partitions);waived=len(partitions)-positive
    assert (positive,waived)==(230,17)
    return dict(status='passed',sourceSha256=sha(body),partitions=partitions,positive=positive,exactUnchangedWaivers=waived,zeroNewPartitions=0)

def hand(directory,control=False):
    r=Recording(directory);assert r.report['status']==('failed' if control else 'passed');points=[]
    expected_ids=[37,37,4099,701,9031,4099,9031,701,4099,701,9031,4099,9031,701,37,4099,701,9031,4099,9031,701,4099,701,9031,4099,9031,701,37,4099,701]
    for row,digest in r.rows():
        s=original(row);d=s['draw'];assert d==[0,30,4,1,0,0,0,1,37,0,0,0]
        assert s['index']==[22,4,12] and s['refs']==[211,39]
        buffers={p['id']:r.body(p['input']) for p in row['buffers']};assert list(struct.unpack_from('<30I',buffers[22],12))==expected_ids
        assert (s['dsa'][2]>>1&7,s['dsa'][2]>>4&7,s['dsa'][2]>>7&7,s['dsa'][2]>>13&255,s['dsa'][2]>>21&255)==(1,6,5,95,91)
        assert (s['dsa'][3]>>1&7,s['dsa'][3]>>7&7,s['dsa'][3]>>13&255,s['dsa'][3]>>21&255)==(5,7,213,229)
        assert not s['dsa'][1]&1 and not s['raster']>>15&1 and not s['raster']>>8&3
        # Original exact validity tags and native framebuffer positions, without
        # using either worker fixture metadata or product/model code.
        off,_,binding,_=s['elements'][0];_,base,resource=s['bindings'][binding]
        for identity,position in [(4099,(2,2)),(701,(18,2)),(9031,(18,10))]:
            x,y,z,w=struct.unpack_from('<4f',buffers[resource],base+off+identity*16)
            assert (16+x*16,8+y*8)==position and z==identity and w==1
        plane=next(p for p in row['planes'] if p['level']==row['level']);source=r.body(plane['input']);bpp=8 if row['format']==126 else 4;so=4 if bpp==8 else 0
        assert all(source[i*bpp+so]==93 for i in range(row['width']*row['height']))
        old=93;transitions=[old]
        for side in [0,1]*4:
            if side==0:operation=(old+1)&255 if 83<(old&95) else (old-1)&255;mask=91
            else:operation=old^255 if 5!=(old&213) else 39;mask=229
            old=(old&(~mask&255))|(operation&mask);transitions.append(old)
        assert transitions==[93,94,187,186,95,68,161,160,69]
        assert len(row['frames'])==1 and row['execution']['result']['ok'] and row['execution']['result']['gpuComplete']
        frame=row['frames'][0];color=r.body(frame['color']);depth=r.body(frame['depth']);pixel=4*row['width']+14;offset=row['width']*row['height']*16+pixel*4
        observed=depth[offset];assert observed==(71 if control else 69)
        assert struct.unpack_from('<4f',color,pixel*16)==(.55078125,0,.75,1)
        before,after=row['corruption']['before'],row['corruption']['after'];assert before['sync']!=after['sync'] and after['sequence']>before['sequence']
        sync=next(p for p in row['fenceObjects'] if p['id']==after['sync'])
        writers=[e for e in row['events'] if e['label']=='ordered-draw' and e['name'] in NATIVE_DRAWS]
        assert len(writers)==16 and before['sequence']<writers[0]['sequence']<writers[-1]['sequence']<sync['createdSequence']<after['sequence']
        assert after['actual'] in [37146,37148] and after['delivered'] in [37146,37148]
        assert any(p['sequence']==after['sequence'] and p['actual']==after['actual'] and p['delivered']==after['delivered'] for p in sync['polls'])
        offsets=[e['args'][3] for e in writers];assert offsets==([i*12 for i in range(8)]*2 if control else [i//2*12 for i in range(16)])
        points.append(dict(run=row['name'],bodySha256=digest,originalTransitions=transitions,expectedS8=69,observedS8=observed,colorByteOffset=pixel*16,
                           colorSha256=sha(color),stencilByteOffset=offset,depthSha256=sha(depth),drawSequences=[e['sequence'] for e in writers],
                           baselineCompletion=before,postWriterCompletion=after,postWriterFenceCreated=sync['createdSequence']))
    assert len(points)==(1 if control else 4)
    if control:
        m=r.report['mutation'];assert m['kind']=='actual-served-whole-face-grouping'
        original_body=(r.directory/'source/renderer/virgl-command/state.mjs').read_bytes();delivered=(r.directory/'served/renderer/virgl-command/state.mjs').read_bytes()
        assert sha(original_body)==m['original']['sha256'] and sha(delivered)==m['delivered']['sha256']
        needle=b'for (let i = 0; i < nativeCount; i += 3) for (let face = 0; face < 2; face++) {'
        replacement=b'for (let face = 0; face < 2; face++) for (let i = 0; i < nativeCount; i += 3) {'
        assert original_body.count(needle)==1 and original_body.replace(needle,replacement)==delivered
        assert next(s for s in r.report['servedFiles'] if s['path']=='/renderer/virgl-command/state.mjs')['sha256']==sha(delivered)
    return dict(status='refuted' if control else 'passed',predictionStayedUnchanged=True,reportSha256=sha(r.report_raw),points=points)

def main():
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['native','coverage','hand','control']);p.add_argument('directory',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();result=coverage(a.directory) if a.mode=='coverage' else hand(a.directory,a.mode=='control') if a.mode in ['hand','control'] else native(a.directory)
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status=result['status'],output=str(a.output),counts=result.get('counts'),points=len(result.get('points',[])),coverage=result.get('positive'))))
if __name__=='__main__':main()
