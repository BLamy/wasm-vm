#!/usr/bin/env python3
"""Independent byte/trace witness checks; does not import the Rust result codec."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);a=p.parse_args()
root=a.directory.resolve();report={'status':'running','cases':[]}
sha=lambda b:hashlib.sha256(b).hexdigest()
u16=lambda b,at:struct.unpack_from('<H',b,at)[0]
u32=lambda b,at:struct.unpack_from('<I',b,at)[0]
u64=lambda b,at:struct.unpack_from('<Q',b,at)[0]
for name,length,failed in [('small',64,False),('production-32m',32<<20,False),('recorded-failure',64,True),('automatic-before',64,False)]:
    case=root/name;ram=(case/'record.ram').read_bytes();cpu=(case/'cpu.bin').read_bytes();gpu=(case/'virtual-gpu.bin').read_bytes()
    trace=(case/'record.trace').read_text();lines=trace.splitlines()
    end=int(re.search(r'end=(\d+)',(case/'state.txt').read_text())[1]);assert len(lines)==end
    # The CPU really published five available heads and notified slot7 MMIO.
    notifications=[(i+1,line) for i,line in enumerate(lines) if re.search(r'mem 0x0000000010008050 0x00000000$',line)]
    assert len(notifications)==5,notifications
    available=[(i+1,line) for i,line in enumerate(lines) if re.search(r'mem 0x0000000080011002 0x000[1-5]$',line)]
    assert len(available)==5,available
    expected=bytes([0x6d])*length if failed else bytes((i*29+7)%251 for i in range(length))
    assert ram[0x40000:0x40000+length]==expected
    assert sha(ram)==re.search(r'mem_digest: ([0-9a-f]+)',(case/'state.txt').read_text())[1]
    assert u16(ram,0x12002)==5
    for i in range(5):
        assert (u32(ram,0x12004+i*8),u32(ram,0x12008+i*8))==(2*i,24)
        status=0x1201 if failed and i==4 else 0x1100
        assert u64(ram,0x18000+i*8)==status
        request=ram[0x14000+i*256:0x14000+i*256+24]
        reply=bytearray(request);struct.pack_into('<I',reply,0,status)
        assert ram[0x16000+i*64:0x16000+i*64+24]==reply
        assert ram[0x16000+i*64+24:0x16000+(i+1)*64]==bytes([0xa5])*40
    assert u64(ram,0x18080)==u64(expected,0)==u64(cpu,10*8)
    assert u64(ram,0x18088)==u64(expected,length-8)==u64(cpu,11*8)
    assert u64(ram,0x18090)==u64(cpu,12*8)==0x123456789abcdef0
    assert u64(ram,0x18098)==1
    frames=sorted(case.glob('result-*.bin'));assert len(frames)==(1 if failed else 3)
    intent=None
    for index,file in enumerate(frames):
        body=file.read_bytes();assert body[:8]==b'WVGPUR01';tag=body[8]
        assert tag==(3 if failed else index+1);assert (u64(body,41),u64(body,49))==(1,1)
        if intent is None:intent=body[9:41]
        assert body[9:41]==intent and intent!=bytes(32)
        if tag in (1,2):
            assert len(body)==142 and body[105]==0
            assert (u64(body,57),u64(body,65),u64(body,73),u64(body,81))==(tag,2,1,0)
            assert (u32(body,89),u32(body,93),u32(body,97),u32(body,101))==(3,length,length,1)
            contents=bytes([0x6d])*length if tag==1 else expected
            assert body[106:138]==hashlib.sha256(contents).digest() and u32(body,138)==length
            if tag==2:assert (case/(body[106:138].hex()+'.payload')).read_bytes()==contents
        else:
            assert len(body)==75 and u64(body,57)==(0 if failed else 2)
            assert body[65:67]==bytes([4 if failed else 0,1])
            assert (u32(body,67),u32(body,71))==(0 if failed else 1,0)
    replays=sorted(case.glob('replay*.trace'));assert len(replays)==(3 if name in ('small','production-32m') else 1)
    for replay in replays:
        assert replay.read_text()==trace
        assert replay.with_suffix('.cpu').read_bytes()==cpu
        assert replay.with_suffix('.ram').read_bytes()==ram
        assert replay.with_suffix('.gpu').read_bytes()==gpu
    report['cases'].append({'name':name,'bytes':length,'instructions':end,'notifications':[i for i,_ in notifications],
        'ram_sha256':sha(ram),'cpu_sha256':sha(cpu),'gpu_sha256':sha(gpu),'trace_sha256':sha(trace.encode()),'replays':len(replays)})
for job in [1,2,3]:
    case=root/f'original-kind-{job}'
    for extension in ['trace','cpu','ram','gpu']:assert (case/f'record.{extension}').read_bytes()==(case/f'replay.{extension}').read_bytes()
    report['cases'].append({'name':case.name,'cpu_sha256':sha((case/'record.cpu').read_bytes()),'trace_sha256':sha((case/'record.trace').read_bytes())})
report['status']='passed';print(json.dumps(report,indent=2))
