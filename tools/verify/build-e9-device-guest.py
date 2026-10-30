#!/usr/bin/env python3
"""Assemble the bounded RV64 asynchronous device completion fixture (no toolchain needed)."""
from pathlib import Path
import hashlib,json,struct
root=Path(__file__).resolve().parents[2]
words=[];listing=[];labels={}
def emit(w,comment):
 words.append(w&0xffffffff);listing.append(f'{0x80000000+(len(words)-1)*4:08x} {w&0xffffffff:08x}  {comment}')
def addi(rd,rs,n):emit((n&4095)<<20|rs<<15|rd<<7|0x13,f'addi x{rd},x{rs},{n}')
def li(rd,n):
 n&=0xffffffff;hi=((n+0x800)>>12)&0xfffff;lo=((n-(hi<<12)+2048)&4095)-2048
 emit(hi<<12|rd<<7|0x37,f'lui x{rd},0x{hi:x}');addi(rd,rd,lo)
 emit(32<<20|rd<<15|1<<12|rd<<7|0x13,f'slli x{rd},x{rd},32');emit(32<<20|rd<<15|5<<12|rd<<7|0x13,f'srli x{rd},x{rd},32')
def load(rd,base,offset,width=6):emit((offset&4095)<<20|base<<15|width<<12|rd<<7|3,f'load{width} x{rd},{offset}(x{base})')
def store(rs,base,offset,width=2):emit(((offset&4095)>>5)<<25|rs<<20|base<<15|width<<12|(offset&31)<<7|0x23,f'store{width} x{rs},{offset}(x{base})')
def write(base,offset,n,width=2):li(5,n);store(5,base,offset,width)

def memory(address,fields):
 li(10,address)
 for offset,n,width in fields:write(10,offset,n,width)
def queue(slot,q,desc,avail,used):
 li(3,slot)
 for offset,n in [(0x30,q),(0x38,16),(0x80,desc),(0x84,0),(0x90,avail),(0x94,0),(0xa0,used),(0xa4,0),(0x44,1)]:write(3,offset,n)
def transport(slot,features=0):
 li(3,slot)
 for offset,n in [(0x70,1),(0x70,3),(0x24,0),(0x20,features),(0x24,1),(0x20,1),(0x70,11)]:write(3,offset,n)
def descriptor(table,i,addr,length,flags,next=0):
 memory(table+i*16,[(0,addr,2),(4,0,2),(8,length,2),(12,flags,1),(14,next,1)])
def publish(slot,q,avail,index,head):
 memory(avail,[(4+index*2,head,1),(2,index+1,1)]);li(3,slot);write(3,0x50,q)
# Fixed page layout independently decoded by the native and browser oracles.
B=0x80000000;blk=0x10001000;snd=0x10007000;con=0x10008000
bd,ba,bu=B+0x10000,B+0x11000,B+0x12000
transport(blk,1<<9);queue(blk,0,bd,ba,bu);li(3,blk);write(3,0x70,15)
for i in range(2):
 hdr=B+0x13000+i*0x100;data=B+0x14000+i*0x400;status=B+0x15000+i
 memory(hdr,[(0,0,2),(4,0,2),(8,i,3)])
 descriptor(bd,i*3,hdr,16,1,i*3+1);descriptor(bd,i*3+1,data,512,3,i*3+2);descriptor(bd,i*3+2,status,1,2)
 publish(blk,0,ba,i,i*3)
# Real named-port console handshake and one posted agent receive buffer.
cd,ca,cu=B+0x20000,B+0x21000,B+0x22000
transport(con,2)
for q in [2,3,4]:queue(con,q,cd+q*0x100,ca+q*0x100,cu+q*0x100)
li(3,con);write(3,0x70,15)
for i,(port,event) in enumerate([(0,0),(1,3),(1,6)]):
 addr=B+0x23000+i*0x20
 memory(addr,[(0,port,2),(4,event,1),(6,1,1)])
 descriptor(cd+3*0x100,i,addr,8,0)
 # Advertise a writable control buffer for the named-port add/name/open notifications.
 descriptor(cd+2*0x100,i,B+0x23400+i*0x80,128,2)
 publish(con,2,ca+2*0x100,i,i);publish(con,3,ca+3*0x100,i,i)
descriptor(cd+4*0x100,0,B+0x24000,256,2);publish(con,4,ca+4*0x100,0,0)
# Capture-only sound, one S16 mono period. Playback is outside this adapter profile.
sd,sa,su=B+0x30000,B+0x31000,B+0x32000
transport(snd)
for q in [0,1,3]:queue(snd,q,sd+q*0x100,sa+q*0x100,su+q*0x100)
li(3,snd);write(3,0x70,15)
for i,command in enumerate([0x101,0x102,0x104]):
 addr=B+0x33000+i*0x100
 fields=[(0,command,2),(4,1,2)]
 length=8
 if i==0:
  fields += [(8,16,2),(12,4,2),(16,0,2),(20,1,0),(21,5,0),(22,7,0),(23,0,0)];length=24
 memory(addr,fields);descriptor(sd,i*2,addr,length,1,i*2+1);descriptor(sd,i*2+1,addr+0x80,4,2);publish(snd,0,sa,i,i*2)
memory(B+0x34000,[(0,1,2)])
descriptor(sd+3*0x100,0,B+0x34000,4,1,1);descriptor(sd+3*0x100,1,B+0x34100,4,3,2);descriptor(sd+3*0x100,2,B+0x34200,8,2);publish(snd,3,sa+3*0x100,0,0)
labels['ready']=len(words)
# Read queue indices, real interrupt status and all DMA payloads repeatedly from guest code.
loop=len(words)
for i,address in enumerate([bu+2,cu+4*0x100+2,su+3*0x100+2,blk+0x60,con+0x60,snd+0x60]):
 li(10,address);load(6,10,0,5 if i<3 else 6);li(11,B+0x40000);store(6,11,i*8,3)
for address,length,dest in [(B+0x14000,512,64),(B+0x14400,512,576),(B+0x24000,32,1088),(B+0x34100,4,1120),(B+0x34200,8,1124)]:
 li(10,address);li(11,B+0x40000)
 for i in range(length):load(6,10,i,4);store(6,11,dest+i,0)
delta=(loop-len(words))*4
# JAL's signed 21-bit immediate.
n=delta&0x1fffff;emit(((n>>20)&1)<<31|((n>>1)&0x3ff)<<21|((n>>11)&1)<<20|((n>>12)&255)<<12|0x6f,'jal x0, report loop')
body=b''.join(struct.pack('<I',w) for w in words)
meta={'version':1,'readyTransition':str(labels['ready']),'reportAddress':str(B+0x40000),'reportBytes':1132,'loopInstructions':len(words)-loop,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'scope':'Guest configures and posts two virtio-blk reads, named file-agent receive and running mono S16 audio capture; report observes actual DMA/used/IRQ state.'}
out=root/'web/assets'
(out/'e9-device-completions.bin').write_bytes(body)
# Minimal independent ELF container, loaded by the ordinary bare-metal WasmMachine API.
ident=b'\x7fELF'+bytes([2,1,1])+bytes(9)
header=ident+struct.pack('<HHIQQQIHHHHHH',2,243,1,B,64,0,0,64,56,1,0,0,0)
segment=struct.pack('<IIQQQQQQ',1,7,120,B,B,len(body),len(body),4)
(out/'e9-device-completions.elf').write_bytes(header+segment+body);(out/'e9-device-completions.json').write_text(json.dumps(meta,indent=2)+'\n')
(root/'tools/verify/e9-device-guest.listing').write_text('\n'.join(listing)+'\n')
print(json.dumps(meta))
