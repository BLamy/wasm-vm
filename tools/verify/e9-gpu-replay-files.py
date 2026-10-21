#!/usr/bin/env python3
"""Inspect retained browser storage, RV64 GPU bytes and RAM without production codecs."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--directory',required=True,type=Path)
a=p.parse_args();root=a.directory.resolve()
sha=lambda b:hashlib.sha256(b).hexdigest()
u16=lambda b,at:struct.unpack_from('<H',b,at)[0]
u32=lambda b,at:struct.unpack_from('<I',b,at)[0]
u64=lambda b,at:struct.unpack_from('<Q',b,at)[0]
report=json.loads((root/'report.json').read_text())
assert report['status']=='passed' and report['errors']==[] and report['requests']==[]
saved=root/'saved';storage=json.loads((saved/'storage.json').read_text())
objects={row['key']:row['value'] for row in storage['stores']['objects']}

def read(ref):
    obj=objects[ref['sha256']]
    assert obj['sha256']==ref['sha256'] and obj['length']==ref['length']
    parts=[]
    for part in obj['parts']:
        data=(saved/'chunks'/(part['sha256']+'.bin')).read_bytes()
        assert sha(data)==part['sha256'] and len(data)==int(part['length'])
        parts.append(data)
    data=b''.join(parts)
    assert len(data)==int(ref['length']) and sha(data)==ref['sha256']
    return data

for key,obj in objects.items():assert key==obj['sha256'] and read(obj)
manifest=json.loads(bytes(storage['stores']['sessions'][0]['value']['manifest']))
assert manifest['machine']['ram_bytes']=='1073741824'
assert manifest['policy']['mode']=='exact-replay' and manifest['policy']['clock']=={'mode':'icount','divider':64,'timebase_hz':'10000000','interactive':None}
config=json.loads(read(next(asset['content'] for asset in manifest['assets'] if asset['role']=='vm')))
assert config['runtime']=='rv64-linux-gpu-exact-session-v1' and config['providersComplete']
assert config['renderer']['buildId'] and config['networkPolicy']['replay']=='zero-egress'
for asset in manifest['assets']:read(asset['content'])
witnesses=json.loads(bytes(next(x['bytes'] for x in manifest['extensions'] if x['kind']=='e9-exact-state-witnesses-v1')))
assert witnesses[0]['transition']=='0' and witnesses[-1]['transition']==manifest['end']['transition']
ram=bytearray(1<<30);view=memoryview(ram);frames=[];previous=None
for point in manifest['checkpoints']:
    data=read(point['machine']);delta=None
    if data[:8]==b'WVKEYF01':
        delta=json.loads(data[8:]);assert delta['parent']==previous and delta['ramBytes']=='1073741824'
        count=0;last=-1
        for ref in delta['chunks']:
            chunk=read(ref);assert chunk[:8]==b'WVRAMD01' and u32(chunk,8)==1 and u64(chunk,12)==len(ram)
            at=24
            for _ in range(u32(chunk,20)):
                page,length=u32(chunk,at),u16(chunk,at+4);at+=6
                assert last<page<len(ram)//4096 and length==4096
                view[page*4096:page*4096+length]=chunk[at:at+length];at+=length;last=page;count+=1
            assert at==len(chunk)
        assert count==delta['dirtyPages'] and sha(view)==delta['ramSha256']
        data=read(delta['frame'])
    assert data[:8]==(b'WVGPUD01' if delta else b'WVGPUB01') and u32(data,8)==1
    header,native_len,pending_len,output_len=u32(data,12),u64(data,16),u32(data,24),u32(data,28)
    assert 32+header+native_len+pending_len+output_len==len(data)
    meta=json.loads(data[32:32+header]);native=data[32+header:32+header+native_len]
    assert meta['position']==point['position'] and meta['runtime']==manifest['machine']['vm_build']
    assert meta['rendererSha256']==point['gpu']['sha256'] and sha(read(point['gpu']))==meta['rendererSha256']
    assert native[:8]==b'WVMRESU1' and native[-84:-76]==b'WVGRESU1'
    assert u32(native,len(native)-76)==1 and u64(native,len(native)-72)==len(native)-84
    assert native[-64:-32].hex()==meta['rendererSha256'] and sha(native[:-32])==native[-32:].hex()
    sections={};at=84
    while at<len(native)-84:
        tag,length=u32(native,at),u32(native,at+4);at+=8
        assert tag not in sections and at+length<=len(native)-84
        sections[tag]=native[at:at+length];at+=length
    assert at==len(native)-84 and {1,4,6,12,18,19,20,21,22}<=sections.keys()
    assert (2 in sections)==(delta is None)
    if not delta:
        encoded=sections[2];at=0;offset=0
        while at<len(encoded):
            kind,length=encoded[at],u32(encoded,at+1);at+=5
            assert kind in (0,1) and 0<length<=len(ram)-offset
            if kind:
                assert len(encoded[at:at+length])==length;view[offset:offset+length]=encoded[at:at+length];at+=length
            elif frames:
                for start in range(offset,offset+length,1<<20):view[start:min(start+(1<<20),offset+length)]=bytes(min(1<<20,offset+length-start))
            offset+=length
        assert at==len(encoded) and offset==len(ram)
    assert sha(view)==meta['ramSha256']
    clock=sections[18]
    assert (u64(clock,12),u64(clock,20),u64(clock,28),u64(clock,36))==tuple(int(point['position'][k]) for k in ['transition','retired','ordinal','sequence'])
    committed=next(x for x in witnesses if x['transition']==point['position']['transition'] and x['sequence']==point['position']['sequence'])
    assert bytes(committed['digest']).hex()==meta['stateSha256']
    gpu=sections[12];inner=gpu.index(b'WVGPU3D1');assert u32(gpu,inner+8)==2 and sha(gpu[inner:-32])==gpu[-32:].hex()
    frontier=sections[22];assert frontier[:8]==b'WVGFRNT1' and frontier[8:40].hex()==sha(gpu) and sha(frontier[:-32])==frontier[-32:].hex()
    at=inner+48;parts=[]
    for _ in range(6):length=u32(gpu,at);parts.append(gpu[at+4:at+4+length]);at+=4+length
    assert at==len(gpu)-32
    pending=parts[-1][0]==1
    if point['id'].startswith('pending-'):assert pending,'genuine native pending job required'
    device=sections[20];guest=device[4:4+u32(device,0)];assert guest[:8]==b'WVDEVST1'
    offset=12+u32(guest,8)+32
    assert u32(guest,offset)==0;offset+=4 # no pending external device reads
    residents=u32(guest,offset);offset+=4
    for _ in range(residents):
        offset+=12;size=u32(guest,offset);offset+=4+size
    failures=u32(guest,offset);offset+=4+failures*5
    reads=u32(guest,offset);offset+=4
    for _ in range(reads):offset+=12;count=u32(guest,offset);offset+=4+count*4
    sectors=u32(guest,offset);offset+=4;overlay={}
    for _ in range(sectors):
        sector=u64(guest,offset);offset+=8;overlay[sector]=guest[offset:offset+512];offset+=512
    assert u64(guest,offset)==0 and guest[offset+8]==0 and offset+9==len(guest)
    if frames:
        assert overlay=={8:bytes([0x4d])*512}
    if point['id']=='green':
        for name in ['pixels','queryData','diskBytes']:
            symbol=report['fixture']['symbols'][name];start=int(symbol['address'],16)-0x80000000
            body=bytes(view[start:start+symbol['bytes']])
            expected={'pixels':bytes([0,255,0,255])*4096,'queryData':struct.pack('<IIIIIIIIIIIIIIII',1,4,1,0,0,0,0,0,1,4,0,0,0,0,0,0),'diskBytes':bytes([0x4d])*512}[name]
            assert body==expected,name+' guest RAM differs from literal GPU/disk expectations'
    frames.append({'id':point['id'],'position':point['position'],'ramSha256':meta['ramSha256'],'stateSha256':meta['stateSha256'],
                   'pending':pending,'sections':{str(tag):sha(body) for tag,body in sections.items() if tag!=2}})
    previous=point['machine']
rows=[];last_sequence=0;result_bodies=[];failures=0
for chunk in manifest['events']:
    records=json.loads(read(chunk['content']))
    for record in records:
        assert int(record['sequence'])==last_sequence+1;last_sequence+=1
        if record['kind']!='gpu':continue
        intent=json.loads(bytes(record['intent']));header=bytes(intent['header'])
        if intent['channel']==22:
            assert header[:8]==b'WVGPUR01' and header[8] in (1,2,3)
            if header[8]==2:
                ref=record['payload']['content'];body=read(ref)
                assert header[106:138].hex()==ref['sha256'] and u32(header,138)==len(body)
                result_bodies.append(body)
            if record['status']=='failed':failures+=1
        else:assert intent['channel']==23 and len(header)==40
        rows.append(record)
assert last_sequence==int(manifest['end']['sequence']) and failures>=1
assert bytes([0,255,0,255])*4096 in result_bodies
query=[b for b in result_bodies if len(b)==32]
assert any(struct.unpack_from('<IIII',b)==(1,4,1,0) for b in query)
assert any(struct.unpack_from('<IIII',b)==(1,4,0,0) for b in query)
assert report['replay']['digest']==bytes(report['run']['end']['digest']).hex()
source=bytes(report['run']['stateBytes']);replayed=bytes(report['replay']['stateBytes'])
assert source==replayed and report['run']['ramDigest']==report['replay']['ramDigest']
expected=sha(b'wasm-vm-gpu-guest-state-v1\0'+struct.pack('<Q',len(source))+source+bytes.fromhex(report['run']['ramDigest']))
assert expected==report['replay']['digest']
assert report['run']['trace']['dropped']==0 and len(report['run']['trace']['records'])>=25
assert sum(row['type']==0x206 for row in report['run']['trace']['records'])==3
assert report['run']['trace']['records'][-1]['response']==0x1205
assert report['run']['pixel']==[0,255,0,255] and report['replay']['pixel']==[0,255,0,255]
result={'status':'passed','chunks':len(storage['stores']['chunks']),'objects':len(objects),'frames':frames,
        'gpuEvents':len(rows),'failedCompletions':failures,'bodies':[{'bytes':len(b),'sha256':sha(b)} for b in result_bodies],
        'finalStateSha256':report['replay']['digest']}
(root/'independent-bytes.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':result['status'],'frames':len(frames),'gpuEvents':len(rows),'failedCompletions':failures,'bodies':len(result_bodies)}))
