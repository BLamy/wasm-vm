#!/usr/bin/env python3
"""Independent guest trace/native RAM/input-prefix oracle; never imports an emulator codec."""
import argparse, hashlib, json, re, struct
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);a=p.parse_args();directory=a.directory.resolve()
BASE=0x80000000;COPY=0x24000;BUF=0x14000;sha=lambda b:hashlib.sha256(b).hexdigest();u64=lambda b,at:struct.unpack_from('<Q',b,at)[0]
def frame(path):
    raw=path.read_bytes();assert raw[:12]==b'WVMRESU1\1\0\0\0';at=84;sections={}
    while at<len(raw):
        tag,n=struct.unpack_from('<II',raw,at);at+=8;assert tag not in sections and at+n<=len(raw);sections[tag]=raw[at:at+n];at+=n
    assert at==len(raw) and {1,2,3,9,18}<=sections.keys()
    ram=bytearray();encoded=sections[2];at=0
    while at<len(encoded):
        kind,n=struct.unpack_from('<BI',encoded,at);at+=5;assert kind in (0,1) and n>0 and len(ram)+n<=16<<20
        if kind:assert at+n<=len(encoded);ram.extend(encoded[at:at+n]);at+=n
        else:ram.extend(bytes(n))
    assert at==len(encoded) and len(ram) in (16384,16<<20)
    clock=sections[18];assert clock[:12]==b'WVCLK001\1\0\0\0';transition,retired,ordinal,sequence,ticket=struct.unpack_from('<QQQQQ',clock,12);assert retired<=transition and ordinal<=min(sequence,0xffffffff) and sequence<=ticket
    idle,external,count=struct.unpack_from('<BBI',clock,52);assert idle in (0,1) and external in (0,1) and count<=256
    cpu=sections[1];result={'file':path.name,'sha256':sha(raw),'bytes':len(raw),'sections':sorted(sections),'transition':str(transition),'retired':str(retired),'sequence':str(sequence),'ordinal':ordinal,'pc':str(u64(cpu,0)),'pending':count,'ram_sha256':sha(ram)}
    return result,ram,clock,cpu

def event(t,c,v):return struct.pack('<HHi',t,c,v)
def expected(name):
    if name.startswith('keyboard-focus-release'):return b''.join(event(1,c,v)+bytes(8)for c,v in [(42,1),(30,1),(30,0),(42,0)])
    if name.startswith('tablet-same-position'):return b''.join(event(t,c,v)+bytes(8)for t,c,v in [(3,0,125),(3,0,125),(3,1,711),(1,272,1),(1,272,0)])
    if name.startswith('relative-mouse'):return b''.join(event(t,c,v)+bytes(8)for t,c,v in [(2,0,-7),(2,1,3),(1,272,1),(1,272,0)])
    if name.startswith('rapid-typing-'):return (event(1,30,1)+bytes(8)+event(1,30,0)+bytes(8))*32
    if name=='agent-clipboard-prefix':return b'cli'
    if name.startswith('dropped-frame'):return b''
    raise AssertionError('unclassified guest evidence '+name)

def trace_bytes(path,values,source,increment=True):
    lines=path.read_text().splitlines();nop=int(increment);assert len(lines)==len(values)*2+nop
    if nop:assert lines[0]=='core 0: 0x0000000080000000 (0x00000013)'
    for i,value in enumerate(values):
        load=lines[nop+2*i];store=lines[nop+2*i+1]
        assert f'x5 0x{value:016x} mem 0x{source+(i if increment else 0):016x}' in load,(path.name,i,load)
        assert f'mem 0x{BASE+COPY+i:016x} 0x{value:02x}' in store,(path.name,i,store)
    return len(lines)

report={'status':'running','scope':'Independent sparse native RAM, exact guest load/store trace points, frame bytes and durable input keys; no emulator codec imported.','frames':[],'traces':[]}
frames=sorted(directory.glob('*.resume'));assert frames,'missing original native evidence'
for path in frames:
    w,ram,clock,cpu=frame(path);name=path.stem;t=int(w['transition']);r=int(w['retired']);seq=int(w['sequence'])
    if name=='host-mailbox-pending':
        assert(t,r,seq,w['pending'])==(7,7,0,1);assert len(clock)==84
        target,ticket,kind,channel,n=struct.unpack_from('<QQBHI',clock,58);assert(target,ticket,kind,channel,n,clock[81:])==(7,0,2,3,3,b'\7\10\11')
    elif name=='uart-final':assert(t,r,seq,w['pending'])==(154,154,6,0)
    else:
        wanted=expected(name);actual=(directory/(name+'.bin')).read_bytes();assert actual==wanted and ram[COPY:COPY+len(wanted)]==wanted
        if wanted:assert u64(cpu,5*8)==wanted[-1]
        steps=trace_bytes(directory/(name+'.trace'),wanted,BASE+BUF);report['traces'].append({'file':name+'.trace','lines':steps,'sha256':sha((directory/(name+'.trace')).read_bytes())})
        if name.startswith('rapid-typing-'):n=int(name.rsplit('-',1)[1])+1;assert(t,r,seq)==(n*2049,n*2049,n*128)
        elif name=='agent-clipboard-prefix':assert(t,r,seq)==(11,11,3)
        elif name.startswith('dropped-frame'):assert(t,r,seq)==(1,1,2) and struct.unpack_from('<H',ram,0x12002)[0]==0
        else:assert(t,r,seq)==(len(wanted)*2+1,len(wanted)*2+1,11 if name.startswith('tablet')else 9)
        digest=directory/(name+'.sha256');assert digest.read_text().strip()==sha(wanted)
    report['frames'].append(w)
for name in ['keyboard-focus-release','tablet-same-position','relative-mouse','dropped-frame']:
    assert(directory/(name+'.resume')).read_bytes()==(directory/(name+'-replay.resume')).read_bytes()
original=bytes((i*13)&255 for i in range(77));assert(directory/'uart-guest.bin').read_bytes()==original
for i in range(5):
    wanted=original[i*16:i*16+16];path=directory/f'uart-{i}.trace';lines=trace_bytes(path,wanted,0x10000000,False);report['traces'].append({'file':path.name,'lines':lines,'sha256':sha(path.read_bytes())})
assert len(frames)==17,(len(frames),[p.name for p in frames])
report['status']='passed';(directory/'input-oracle.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'passed','frames':len(frames),'traces':len(report['traces'])}))
