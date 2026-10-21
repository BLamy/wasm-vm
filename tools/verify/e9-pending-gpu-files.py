#!/usr/bin/env python3
"""Independent byte checks for actual pending RV64 GPU keyframes, without Rust codecs."""
import argparse
import hashlib
import json
import struct
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);a=p.parse_args();root=a.directory.resolve()
sha=lambda b:hashlib.sha256(b).digest()
u16=lambda b,at:struct.unpack_from('<H',b,at)[0]
u32=lambda b,at:struct.unpack_from('<I',b,at)[0]
u64=lambda b,at:struct.unpack_from('<Q',b,at)[0]
def unpack(blob):
    assert blob[:8]==b'WVMRESU1' and blob[-84:-76]==b'WVGRESU1' and sha(blob[:-32])==blob[-32:]
    assert u64(blob,len(blob)-72)==len(blob)-84 and blob[-64:-32]==bytes([0xc6])*32
    sections={};at=84
    while at<len(blob)-84:
        tag=u32(blob,at);length=u32(blob,at+4);assert tag not in sections;sections[tag]=blob[at+8:at+8+length];at+=8+length
    assert at==len(blob)-84
    gpu=sections[12];frontier=sections[22];inner=gpu.index(b'WVGPU3D1');assert u32(gpu,inner+8)==2 and sha(gpu[inner:-32])==gpu[-32:]
    assert frontier[:8]==b'WVGFRNT1' and frontier[8:40]==sha(gpu) and sha(frontier[:-32])==frontier[-32:]
    chunks=[];at=inner+48
    for _ in range(6):n=u32(gpu,at);chunks.append(gpu[at+4:at+4+n]);at+=4+n
    assert at==len(gpu)-32
    return sections,gpu,frontier,chunks
report={'status':'running','cases':[]}
for name,used,replays in [('pending-before-scatter',4,['restored','restored-cached']),('pending-after-scatter',4,['restored-0','restored-1']),('pending-after-fence',5,['restored-0','restored-1'])]:
    case=root/name;blob=(case/'keyframe.bin').read_bytes();sections,gpu,frontier,chunks=unpack(blob)
    saved=(case/'saved.ram').read_bytes();ram=(case/'original.ram').read_bytes();cpu=(case/'original.cpu').read_bytes();original_gpu=(case/'original.gpu').read_bytes();suffix=(case/'suffix.trace').read_bytes()
    assert u16(saved,0x12002)==used and u16(ram,0x12002)==5
    assert chunks[5][0]==(0 if used==5 else 1)
    if used==4:
        pending=chunks[5];assert (u64(pending,1),u64(pending,9))==(1,1) and u64(pending,17)>0
        assert u64(pending,41)==0x123456789abcdef0 and u16(pending,57)==8 and u32(pending,59)==2
        assert u64(pending,63)==0x80014400 and u64(pending,76)==0x80016100
        assert u16(saved,0x12002)+1==u16(gpu,gpu.index(b'WVGPU3D1')-9)
        # Genuine guest fence response is still the original sentinel, not a claimed drained queue.
        assert saved[0x16100:0x16118]==bytes([0xa5])*24
    for index in range(5):assert (u32(ram,0x12004+8*index),u32(ram,0x12008+8*index))==(index*2,24)
    assert u64(ram,0x18090)==0x123456789abcdef0
    for replay in replays:
        assert (case/(replay+'.cpu')).read_bytes()==cpu and (case/(replay+'.ram')).read_bytes()==ram
        assert (case/(replay+'.trace')).read_bytes()==suffix
        raw=(case/(replay+'.gpu')).read_bytes();assert u64(raw,8)>u64(original_gpu,8)
        assert raw[:8]==original_gpu[:8] and raw[16:]==original_gpu[16:],'only the declared host epoch may change'
    if name=='pending-before-scatter':
        assert frontier[40]==1 and u64(frontier,73)==1 and u32(frontier,141)==0
        at=145;assert frontier[at]==1;at+=1+28;length=u32(frontier,at);at+=4;result=frontier[at:at+length];at+=length
        assert result[:9]==b'WVGPUR01\x02' and frontier[at]==1;at+=1
        reference=frontier[at:at+32];length=u32(frontier,at+32);at+=36;size=u32(frontier,at);at+=4;payload=frontier[at:at+size]
        assert length==size==64 and reference==sha(payload)==result[106:138]
        assert saved[0x40000:0x40040]==bytes([0x6d])*64 and ram[0x40000:0x40040]==payload
    report['cases'].append({'name':name,'saved_used':used,'final_used':5,'replays':len(replays),'keyframe_sha256':sha(blob).hex(),'suffix_sha256':sha(suffix).hex(),'ram_sha256':sha(ram).hex()})
case=root/'pending-disk';disk=(case/'disk.bin').read_bytes();blob=(case/'keyframe.bin').read_bytes();sections,_,_,_=unpack(blob)
expected=bytearray([0x5b]*4096);expected[1536:2048]=bytes([0x67])*512;assert disk==expected and blob[44:76]==sha(bytes([0x5b])*4096) and u64(blob,76)==7 and 6 in sections
saved=(case/'saved.ram').read_bytes();assert u16(saved,0x22002)==2 and saved[0x25000:0x25200]==bytes([0x67])*512
for extension in ['cpu','ram']:assert (case/('original.'+extension)).read_bytes()==(case/('restored.'+extension)).read_bytes()
trace=(case/'saved.trace').read_text();assert 'mem 0x0000000010001050 0x00000000' in trace
report['cases'].append({'name':'pending-disk','guest_block_used':2,'generation':7,'disk_sha256':sha(disk).hex()})
refusals=root/'pending-refusals';before=(refusals/'incumbent-before.bin').read_bytes()
for file in refusals.glob('*.incumbent'):assert file.read_bytes()==before,file.name
for name in ['clock-queue','erased-pending']:
    assert (refusals/(name+'.before')).read_bytes()==(refusals/(name+'.after')).read_bytes()
    assert (refusals/(name+'.candidate')).read_bytes()!=(refusals/(name+'.before')).read_bytes()
report['refusals']={'rehashed_clock_queue':'unchanged','erased_pending':'unchanged','incumbents':len(list(refusals.glob('*.incumbent')))}
report['status']='passed';print(json.dumps(report,indent=2))
