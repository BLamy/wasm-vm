#!/usr/bin/env python3
"""Assemble the bounded RV64 RTC/virtio-rng/CLINT observation fixture (no toolchain needed)."""
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
def sample_rtc(offset):load(5,2,0);store(5,11,offset);load(5,2,4);store(5,11,offset+4)
def sample_time(offset):emit(0xc0102373,'rdtime x6');store(6,11,offset,3)
# Fixed register roles: x1 UART, x2 RTC, x3 rng MMIO, x4 descriptor, x8 avail, x11 report RAM.
for reg,value in [(1,0x10000000),(2,0x101000),(3,0x10003000),(4,0x80001000),(8,0x80002000),(11,0x80005000)]:li(reg,value)
sample_rtc(0);sample_time(24)
# Real queue-0 descriptor 0 (16 writable bytes); later reuse it with a different buffer/length.
for offset,n,width in [(0,0x80004000,2),(4,0,2),(8,16,2),(12,2,1),(14,0,1)]:write(4,offset,n,width)
write(8,2,1,1);write(8,4,0,1)
for offset,n in [(0x30,0),(0x38,8),(0x80,0x80001000),(0x84,0),(0x90,0x80002000),(0x94,0),(0xa0,0x80003000),(0xa4,0),(0x44,1),(0x50,0)]:write(3,offset,n)
# Arm the RTC 100 ms beyond its initial sample; preserve carry from the low word.
# The initial read is reconstructed as u64 from adjacent report words via ld.
load(6,11,0,3);li(7,100000000);emit(7<<20|6<<15|6<<7|0x33,'add x6,x6,x7')
emit(32<<20|6<<15|5<<12|7<<7|0x13,'srli x7,x6,32');store(7,2,12);store(6,2,8);write(2,16,1)
sample_rtc(56) # RTC poll and MMIO read share an observe phase, with distinct ordinals.
labels['pause']=len(words)
emit(0x53100013,'pause marker: addi x0,x0,1329')
# After an explicit host pause/background interval, sample the same RTC and make another request.
sample_rtc(8)
for offset,n,width in [(0,0x80004100,2),(8,33,2)]:write(4,offset,n,width)
write(8,6,0,1);write(8,2,2,1);write(3,0x50,0)
# A guest time-set is two distinct observations and an offset/latch update.
write(2,4,0x12345678);write(2,0,0x9abcdef0);sample_rtc(16)
# WFI idle advancement is derived from the frozen ICount policy, not elapsed host time.
sample_time(32);addi(6,6,1000);li(9,0x2004000);store(6,9,0,3);emit(0x10500073,'wfi');sample_time(40)
load(5,2,24);store(5,11,48)
# Copy the actual entropy DMA buffers into the report, then dump all report bytes through UART.
for address,length,dest in [(0x80004000,16,64),(0x80004100,33,80)]:
 li(10,address)
 for i in range(length):load(5,10,i,4);store(5,11,dest+i,0)
for i in range(113):load(5,11,i,4);store(5,1,0,0)
labels['end']=len(words)+1 # WFI's distinct idle-advance transition is included.
emit(0x6f,'jal x0,0 (declared end fence is before this loop)')
body=b''.join(struct.pack('<I',w)for w in words)
meta={'version':1,'base':'2147483648','rtc':'1052672','reportAddress':'2147504128','reportBytes':113,'pauseTransition':str(labels['pause']),'endTransition':str(labels['end']),'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'entropyLengths':[16,33],'rtcAlarmDeltaNs':'100000000','scope':'RTC read/latch, alarm arm and background poll, time-set halves, exact RNG DMA and deterministic CLINT/WFI idle advance; all external source observations are recorded.'}
out=root/'web/assets';out.mkdir(exist_ok=True)
(out/'e9-time-entropy.bin').write_bytes(body);(out/'e9-time-entropy.json').write_text(json.dumps(meta,indent=2)+'\n')
(root/'tools/verify/e9-source-guest.listing').write_text('\n'.join(listing)+'\n')
print(json.dumps(meta))
