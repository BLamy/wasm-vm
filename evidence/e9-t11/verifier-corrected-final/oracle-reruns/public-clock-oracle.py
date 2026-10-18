#!/usr/bin/env python3
"""Independent native TLV/clock/CPU/sparse-RAM oracle; never imports the emulator codec."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);a=p.parse_args()
out=a.directory.resolve();BASE=0x80000000;DATA=0x4000;WIDE=9007199254740993
sha=lambda b:hashlib.sha256(b).hexdigest()
u64=lambda b,at:struct.unpack_from('<Q',b,at)[0]

def decode(file):
    raw=file.read_bytes();assert raw[:12]==b'WVMRESU1\x01\x00\x00\x00'
    sections={};at=84
    while at<len(raw):
        tag,n=struct.unpack_from('<II',raw,at);at+=8;assert tag not in sections and at+n<=len(raw)
        sections[tag]=raw[at:at+n];at+=n
    assert at==len(raw) and set(sections)=={1,2,3,9,18}
    cpu=sections[1];assert len(cpu)>=512
    pc=u64(cpu,0);regs=[0]+[u64(cpu,i*8) for i in range(1,32)]
    ram=bytearray();encoded=sections[2];at=0
    while at<len(encoded):
        kind,n=struct.unpack_from('<BI',encoded,at);at+=5
        assert kind in (0,1) and n>0 and len(ram)+n<=8<<20
        if kind:
            assert at+n<=len(encoded);ram.extend(encoded[at:at+n]);at+=n
        else:ram.extend(bytes(n))
    assert at==len(encoded) and len(ram) in (1<<20,8<<20)
    assert len(sections[3])==17 and len(sections[9])==24
    mtime,deadline=struct.unpack_from('<QQ',sections[3]);phase,divider,_=struct.unpack('<QQQ',sections[9]);assert 1<=divider<=1024 and phase<divider
    clock=sections[18];assert clock[:12]==b'WVCLK001\x01\x00\x00\x00'
    transition,retired,ordinal,sequence,ticket=struct.unpack_from('<QQQQQ',clock,12)
    assert retired<=transition and ordinal<=min(sequence,0xffffffff) and sequence<=ticket
    idle,external,count=struct.unpack_from('<BBI',clock,52);assert idle in (0,1) and external in (0,1) and count<=256 and sequence+count<=0xffffffffffffffff
    pending=[];at=58;owned=0;tickets=set()
    for _ in range(count):
        target,event_ticket,kind=struct.unpack_from('<QQB',clock,at);at+=17
        assert target>=transition and event_ticket<ticket and event_ticket not in tickets;tickets.add(event_ticket)
        if pending:assert (target,event_ticket)>(int(pending[-1]['transition']),int(pending[-1]['ticket']))
        if kind==0:
            address,n=struct.unpack_from('<QI',clock,at);at+=12;assert n<=1<<20 and at+n<=len(clock) and BASE<=address<=BASE+len(ram) and address+n<=BASE+len(ram)
            payload=clock[at:at+n];at+=n
        else:
            assert kind==1;address=0;n=1;payload=clock[at:at+1];at+=1;assert payload in (b'\0',b'\1')
        owned+=n;assert owned<=4<<20
        pending.append({'transition':str(target),'ticket':str(event_ticket),'kind':kind,'address':str(address),'bytes':n,'sha256':sha(payload),'hex':payload.hex()})
    assert at==len(clock) and ordinal+sum(int(q['transition'])==transition for q in pending)<=0xffffffff
    witness={'file':file.name,'bytes':len(raw),'sha256':sha(raw),'sections':{str(k):{'bytes':len(v),'sha256':sha(v)} for k,v in sections.items()},
        'position':{'transition':str(transition),'retired':str(retired),'phase':'before','ordinal':ordinal,'sequence':str(sequence)},
        'next_ticket':str(ticket),'idle_pending':bool(idle),'external_pending':bool(external),'pending':pending,
        'pc':str(pc),'registers':[str(r) for r in regs],'mtime':str(mtime),'divider':divider,'divider_phase':phase,
        'ram':{'bytes':len(ram),'sha256':sha(ram),'data_hex':ram[DATA:DATA+16].hex()}}
    return witness,ram

def pure_loop(w,n):
    assert int(w['pc'])==BASE+(n%6)*4
    for i,weight in enumerate([1,3,5,7,11],1):assert int(w['registers'][i])==weight*(n//6+int(n%6>=i)),(w['file'],i,w['registers'][i],n)

frames=sorted(out.glob('*.resume'));assert frames,'missing original native frames'
report={'status':'running','scope':'Independent native framing, lossless positions, owned queue ordering, CPU witnesses and sparse RAM; no emulator codec used.','frames':[]}
for file in frames:
    w,ram=decode(file);name=file.stem;t=int(w['position']['transition']);r=int(w['position']['retired']);seq=int(w['position']['sequence'])
    m=re.fullmatch(r'jit-(600|601|605)-q(1|7|64)-(before|after)',name)
    if m:
        target=int(m[1]);before=m[3]=='before';assert t==r==target+(0 if before else 4);pure_loop(w,t)
        assert seq==(0 if before else 3) and len(w['pending'])==(3 if before else 0)
        assert ram[DATA:DATA+2]==(b'\0\0' if before else bytes([11 if int(m[2])==64 else 22,33]))
        if before:assert [q['hex'] for q in w['pending']]==(['16','0b','21'] if int(m[2])==64 else ['0b','16','21'])
    m=re.fullmatch(r'jit-target-(600|601|605)-q\d+',name)
    if m:assert t==r==int(m[1])+4 and seq==3;pure_loop(w,t);assert ram[DATA:DATA+2]==bytes([22,33])
    if name.startswith('jit-mailbox-'):assert t==r==1000 and seq==2 and ram[DATA:DATA+5]==b'later' and int(w['registers'][2])==1573
    if name.startswith('jit-timer-'):assert (t,r,int(w['pc']),int(w['mtime']))==(592,591,BASE+0x2000,197) and seq==2 and ram[DATA]==ord('b')
    if name.startswith('owned-cache-'):assert (t,r,seq,int(w['pc']))==(42,42,3,BASE) and int(w['registers'][1])==14 and int(w['registers'][2])==86 and ram[DATA:DATA+6]==b'future'
    if name=='wfi-before-idle' or name.startswith('jit-wfi-before-idle-'):
        expected=601 if name.startswith('jit-') else (10 if len(ram)==1<<20 else 1)
        assert t==r==expected and w['idle_pending'] and int(w['mtime'])==(3 if expected==10 else (200 if expected==601 else 0))
    if name=='wfi-after-idle':assert (t,r,seq,int(w['mtime']),int(w['pc']))==(11,10,2,1000,BASE+40)
    if name=='wfi-after-interrupt':assert (t,r,seq,int(w['mtime']),int(w['pc']))==(12,10,3,1000,BASE+0x2000) and ram[DATA:DATA+2]==bytes([41,42])
    if name=='wfi-held':assert (t,r,seq,int(w['mtime']),int(w['registers'][4]))==(11,11,1,3,1) and w['external_pending']
    if name.startswith('wfi-after-interrupt-q'):assert (t,r,seq,int(w['mtime']),int(w['pc']))==(3,1,2,100,BASE+0x2000) and ram[DATA:DATA+7]==b'idleirq'
    if name.startswith('jit-wfi-after-interrupt-'):assert (t,r,seq,int(w['mtime']),int(w['pc']))==(603,601,1,1000,BASE+0x2000)
    if name=='delivered-trap':assert (t,r,int(w['pc']),int(w['registers'][5]))==(2,1,BASE+0x2004,1)
    if name=='firmware-call':assert (t,r,int(w['pc']))==(1,0,BASE+4)
    if name=='wide-queued':assert (t,r,seq,len(w['pending']))==(WIDE,WIDE,WIDE,1) and w['pending'][0]['transition']==str(WIDE+2)
    if name=='wide-delivered':assert (t,r,seq)==(WIDE+3,WIDE+3,WIDE+1) and ram[DATA:DATA+4] in (b'wide',bytes([91,0,0,0]))
    if name=='paused-control':assert (t,r,seq,w['position']['ordinal'],int(w['pc']),int(w['mtime']))==(0,0,1,1,BASE,0) and ram[DATA]==1
    if name=='paused-controls':assert (t,r,seq,w['position']['ordinal'])==(0,0,3,3) and ram[DATA:DATA+5]==b'three'
    if name=='queue-valid':assert (t,r,seq,len(w['pending']))==(0,0,0,2)
    report['frames'].append(w)

if (out/'probe.json').exists():
    probe=json.loads((out/'probe.json').read_text());assert probe['status']=='passed' and len(probe['cases'])==16 and len(frames)==28
    by_name={row['file'].removesuffix('.resume'):row for row in report['frames']}
    for frame in probe['frames']:assert frame['sha256']==by_name[frame['name']]['sha256']
    for case in probe['cases']:
        if case['kind']=='compiled-fence':
            assert case['jit']['executedBlocks']>0 and 0<case['jit']['retiredViaJit']<=int(case['position']['retired'])
            if case['quantum']>=6:assert case['compiled']>0
    assert len(probe['refusals'])==10
report['status']='passed';Path('/Users/blamy/.codex/worktrees/e9-session-contract/wasm-vm/target/evidence/e9-t11-verifier/corrected/public-clock-oracle.json').write_text(json.dumps(report,indent=2)+'\n');print('Independent clock/CPU/RAM witnesses passed for',len(frames),'native frames.')
