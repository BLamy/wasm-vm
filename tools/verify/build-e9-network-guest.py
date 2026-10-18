#!/usr/bin/env python3
"""Reproduce the pinned RV64 virtio-net HTTP-bridge guest without a cross compiler."""
from pathlib import Path
import hashlib,json,struct
root=Path(__file__).resolve().parents[2]
words=[];listing=[]
def emit(w,comment):
 words.append(w&0xffffffff);listing.append(f"{0x80000000+(len(words)-1)*4:08x} {w&0xffffffff:08x}  {comment}")
def addi(rd,rs,n):emit((n&4095)<<20|rs<<15|rd<<7|0x13,f"addi x{rd},x{rs},{n}")
def li(rd,n):
 n&=0xffffffff;hi=((n+0x800)>>12)&0xfffff;lo=((n-(hi<<12)+2048)&4095)-2048
 emit(hi<<12|rd<<7|0x37,f"lui x{rd},0x{hi:x}");addi(rd,rd,lo)
 emit(32<<20|rd<<15|1<<12|rd<<7|0x13,f"slli x{rd},x{rd},32");emit(32<<20|rd<<15|5<<12|rd<<7|0x13,f"srli x{rd},x{rd},32")
def load(rd,base,offset,width=6):emit((offset&4095)<<20|base<<15|width<<12|rd<<7|3,f"load{width} x{rd},{offset}(x{base})")
def store(rs,base,offset,width=2):emit(((offset&4095)>>5)<<25|rs<<20|base<<15|width<<12|(offset&31)<<7|0x23,f"store{width} x{rs},{offset}(x{base})")
def write(base,offset,n,width=2):li(5,n);store(5,base,offset,width)
def memory(address,fields):
 li(10,address)
 for offset,n,width in fields:write(10,offset,n,width)
def queue(slot,q,desc,avail,used):
 li(3,slot)
 for offset,n in [(0x30,q),(0x38,16),(0x80,desc),(0x84,0),(0x90,avail),(0x94,0),(0xa0,used),(0xa4,0),(0x44,1)]:write(3,offset,n)
def descriptor(table,i,addr,length,flags):
 memory(table+i*16,[(0,addr,2),(4,0,2),(8,length,2),(12,flags,1),(14,0,1)])
B=0x80000000;net=0x10002000
rd,ra,ru=B+0x10000,B+0x11000,B+0x12000
td,ta,tu=B+0x20000,B+0x21000,B+0x22000
tx=B+0x23000;rx=B+0x14000;report=B+0x40000
# Experimental Ethernet type0x88b5 carries an HTTP request to the bounded proof bridge.
# The core adapter itself owns arbitrary Ethernet bytes; Linux/Slirp assembly is T14.
request=b"GET /network-probe-response.json HTTP/1.1\r\nHost: session-probe\r\nConnection: close\r\n\r\n"
ethernet=bytes.fromhex("02000000000152540012345688b5")
frame=ethernet+request;packet=bytes(12)+frame
li(3,net)
for off,n in [(0x70,1),(0x70,3),(0x24,0),(0x20,1<<5),(0x24,1),(0x20,1),(0x70,11)]:write(3,off,n)
queue(net,0,rd,ra,ru);queue(net,1,td,ta,tu);li(3,net);write(3,0x70,15)
memory(tx,[(i,int.from_bytes(packet[i:i+4].ljust(4,b"\0"),"little"),2)for i in range(0,len(packet),4)])
descriptor(td,0,tx,len(packet),0);descriptor(rd,0,rx,2048,2)
memory(ra,[(4,0,1),(2,1,1)]);memory(ta,[(4,0,1),(2,1,1)])
li(3,net);write(3,0x50,0);write(3,0x50,1)
ready=len(words);loop=ready
for i,(address,width)in enumerate([(tu+2,5),(ru+2,5),(net+0x60,6)]):
 li(10,address);load(6,10,0,width);li(11,report);store(6,11,i*8,3)
li(10,rx);li(11,report)
for i in range(1024):load(6,10,i,4);store(6,11,32+i,0)
delta=(loop-len(words))*4;n=delta&0x1fffff
emit(((n>>20)&1)<<31|((n>>1)&0x3ff)<<21|((n>>11)&1)<<20|((n>>12)&255)<<12|0x6f,"jal x0, guest DMA/IRQ report loop")
body=b"".join(struct.pack("<I",w)for w in words)
meta={"version":1,"readyTransition":str(ready),"loopInstructions":len(words)-ready,"request":request.decode(),"frameHex":frame.hex(),"txAddress":str(tx),"rxAddress":str(rx),"reportAddress":str(report),"reportBytes":1056,"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest(),"scope":"Real RV64 instructions negotiate virtio-net, construct and post Ethernet HTTP-bridge TX/RX descriptors, then repeatedly observe actual queue/interrupt/DMA bytes. The bridge forwards the exact HTTP request to the acceptance counter server; production uses a safe fixed same-origin GET. This is a network boundary fixture, not full Linux replay."}
out=root/"web/assets";(out/"e9-network-capture.bin").write_bytes(body)
ident=b"\x7fELF"+bytes([2,1,1])+bytes(9)
header=ident+struct.pack("<HHIQQQIHHHHHH",2,243,1,B,64,0,0,64,56,1,0,0,0)
program=struct.pack("<IIQQQQQQ",1,7,120,B,B,len(body),len(body),4096)
(out/"e9-network-capture.elf").write_bytes(header+program+body)
(out/"e9-network-capture.json").write_text(json.dumps(meta,indent=2)+"\n")
(root/"tools/verify/e9-network-guest.listing").write_text("\n".join(listing)+"\n")
print(json.dumps(meta,indent=2))
