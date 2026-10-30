#!/usr/bin/env python3
"""Verifier's independent raw TLV, CPU and arithmetic/trace audit; reads originals only."""
from pathlib import Path
import hashlib,json,re,struct,sys
ROOT=Path(__file__).resolve().parents[2]
DIRECTORY=Path(sys.argv[1]).resolve()
OUT=Path(sys.argv[2]).resolve()
BASE=0x80000000;DATA=0x4000;WIDE=2**53+1
sha=lambda b:hashlib.sha256(b).hexdigest()
q=lambda b,at:struct.unpack_from('<Q',b,at)[0]
def decode(path):
 raw=path.read_bytes();assert raw[:12]==b'WVMRESU1\x01\0\0\0';at=84;parts={}
 while at<len(raw):
  tag,length=struct.unpack_from('<II',raw,at);at+=8
  assert tag not in parts and length<=len(raw)-at
  parts[tag]=raw[at:at+length];at+=length
 assert at==len(raw) and set(parts)=={1,2,3,9,18}
 cpu=parts[1];pc=q(cpu,0);regs=[0]+[q(cpu,i*8) for i in range(1,32)]
 ram=bytearray();encoded=parts[2];at=0
 while at<len(encoded):
  kind,length=struct.unpack_from('<BI',encoded,at);at+=5
  assert kind in (0,1) and 0<length<=8*2**20-len(ram)
  if kind:assert at+length<=len(encoded);ram+=encoded[at:at+length];at+=length
  else:ram+=bytes(length)
 assert at==len(encoded) and len(ram) in (2**20,8*2**20)
 mtime,deadline=struct.unpack_from('<QQ',parts[3]);phase,divider,stimecmp=struct.unpack('<QQQ',parts[9]);assert phase<divider<=1024
 clock=parts[18];assert clock[:12]==b'WVCLK001\x01\0\0\0'
 t,r,ordinal,seq,ticket=struct.unpack_from('<QQQQQ',clock,12)
 idle,external,count=struct.unpack_from('<BBI',clock,52);assert r<=t and ordinal<=seq<=ticket
 pending=[];at=58
 for i in range(count):
  target,admission,kind=struct.unpack_from('<QQB',clock,at);at+=17
  if kind==0:
   address,n=struct.unpack_from('<QI',clock,at);at+=12;payload=clock[at:at+n];at+=n
  else:
   assert kind==1;address=0;payload=clock[at:at+1];at+=1
  pending.append((target,admission,kind,address,payload.hex()))
 assert at==len(clock)
 row={'file':path.name,'sha256':sha(raw),'transition':str(t),'retired':str(r),'ordinal':ordinal,'sequence':str(seq),'ticket':str(ticket),'pc':str(pc),'registers':[str(v) for v in regs], 'mtime':str(mtime),'phase':phase,'divider':divider,'idle':bool(idle),'external':bool(external),'pending':[list(v) for v in pending],'ram_sha256':sha(ram),'data':ram[DATA:DATA+16].hex()}
 return row,ram
def pure(row,n):
 assert int(row['pc'])==BASE+4*(n%6)
 for i,delta in enumerate([1,3,5,7,11],1):assert int(row['registers'][i])==delta*(n//6+int(n%6>=i)),(row['file'],i)
rows=[]
for f in sorted(DIRECTORY.glob('*.resume')):
 w,ram=decode(f);name=f.stem;t,r,seq=map(int,[w['transition'],w['retired'],w['sequence']])
 match=re.fullmatch(r'jit-target-(600|601|605)-q\d+',name)
 if match:
  n=int(match[1])+4;assert (t,r,seq)==(n,n,3);pure(w,n);assert ram[DATA:DATA+2]==bytes([22,33])
 match=re.fullmatch(r'jit-(600|601|605)-q(1|7|64)-(before|after)',name)
 if match:
  n=int(match[1])+(0 if match[3]=='before' else 4);assert t==r==n;pure(w,n)
  if match[3]=='before':
   assert seq==0 and ram[DATA:DATA+2]==bytes(2)
   assert [x[4] for x in w['pending']]==(['16','0b','21'] if match[2]=='64' else ['0b','16','21'])
  else:assert seq==3 and not w['pending'] and ram[DATA:DATA+2]==bytes([11 if match[2]=='64' else 22,33])
 if name.startswith('jit-mailbox-'):
  assert (t,r,seq,int(w['pc']),int(w['registers'][2]))==(1000,1000,2,BASE+16,1573) and ram[DATA:DATA+5]==b'later'
 if name.startswith('jit-timer-'):
  assert (t,r,seq,int(w['pc']),int(w['mtime']))==(592,591,2,BASE+0x2000,197) and ram[DATA]==98
 if name.startswith('jit-wfi-before-idle-'):assert (t,r,seq,w['idle'],int(w['mtime']))==(601,601,1,True,200)
 if name.startswith('jit-wfi-after-interrupt-'):assert (t,r,seq,w['idle'],int(w['mtime']),int(w['pc']))==(603,601,1,False,1000,BASE+0x2000)
 if name.startswith('owned-cache-'):assert (t,r,seq,int(w['pc']),int(w['registers'][1]),int(w['registers'][2]))==(42,42,3,BASE,14,86) and ram[DATA:DATA+6]==b'future'
 if name=='wfi-before-idle':assert (t,r,seq,w['idle'],int(w['mtime']))==((1,1,0,True,0) if len(ram)==8*2**20 else (10,10,0,True,3))
 if name=='wfi-after-idle':assert (t,r,seq,w['idle'],int(w['mtime']),int(w['pc']))==(11,10,2,False,1000,BASE+40)
 if name=='wfi-after-interrupt':assert (t,r,seq,int(w['mtime']),int(w['pc']))==(12,10,3,1000,BASE+0x2000)
 if name=='wfi-held':assert (t,r,seq,w['external'],int(w['mtime']),int(w['registers'][4]))==(11,11,1,True,3,1)
 if name=='wfi-held-before-wfi':assert (t,r,seq,w['external'],int(w['mtime']))==(0,0,1,True,0)
 if name.startswith('wfi-after-interrupt-q'):assert (t,r,seq,int(w['pc']),int(w['mtime']))==(3,1,2,BASE+0x2000,100) and ram[DATA:DATA+7]==b'idleirq'
 if name=='paused-controls':assert (t,r,seq,w['ordinal'],int(w['mtime']))==(0,0,3,3,0) and ram[DATA:DATA+5]==b'three'
 if name=='queued-pending-flags':assert (t,r,seq)==(0,0,0) and [x[0] for x in w['pending']]==[10,11]
 if name=='delivered-pending-flags':assert (t,r,seq,w['external'])==(12,12,2,False)
 if name=='queue-valid':assert (t,r,seq)==(0,0,0) and [x[0] for x in w['pending']]==[3,3]
 if name=='delivered-trap':assert (t,r,seq,int(w['pc']),int(w['registers'][5]))==(2,1,0,BASE+0x2004,1)
 if name=='firmware-call':assert (t,r,seq,int(w['pc']))==(1,0,0,BASE+4)
 if name=='wide-queued':assert (t,r,seq)==(WIDE,WIDE,WIDE) and w['pending'][0][0]==WIDE+2
 if name=='wide-delivered':assert (t,r,seq)==(WIDE+3,WIDE+3,WIDE+1) and ram[DATA:DATA+4]==(b'wide' if len(ram)==8*2**20 else bytes([91,0,0,0]))
 if name=='paused-control':assert (t,r,seq,w['ordinal'],int(w['mtime']))==(0,0,1,1,0) and ram[DATA]==1
 rows.append(w)
traces=[]
for f in sorted(DIRECTORY.glob('*.trace')):
 lines=f.read_text().splitlines();name=f.stem
 if name.startswith('jit-target-'):
  target=int(name.split('-')[2]);assert len(lines)==target+4-384
  for n,line in enumerate(lines,384):
   pc=int(re.search(r'0x([0-9a-f]{16})',line)[1],16);assert pc==BASE+4*(n%6)
   match=re.search(r' x(\d+) 0x([0-9a-f]{16})',line)
   if n%6<5:
    register=n%6+1;delta=[1,3,5,7,11][register-1]
    assert match and int(match[1])==register and int(match[2],16)==delta*(n//6+1)
   else:assert not match
 match=re.fullmatch(r'jit-(600|601|605)-q(1|7|64)',name)
 if match:
  assert len(lines)==int(match[1])+4
  for n,line in enumerate(lines):
   pc=int(re.search(r'0x([0-9a-f]{16})',line)[1],16);assert pc==BASE+4*(n%6)
   changed=re.search(r' x(\d+) 0x([0-9a-f]{16})',line)
   if n%6<5:
    register=n%6+1;delta=[1,3,5,7,11][register-1]
    assert changed and int(changed[1])==register and int(changed[2],16)==delta*(n//6+1)
   else:assert not changed
 if name.startswith('jit-timer-'):assert len(lines)==591-384 and '0x0000000080000008' in lines[-1]
 if name.startswith('jit-wfi-q'):assert len(lines)==601-384 and '(0x10500073)' in lines[-1]
 traces.append({'file':f.name,'lines':len(lines),'sha256':sha(f.read_bytes())})
OUT.write_text(json.dumps({'status':'passed','frames':rows,'traces':traces},indent=2)+'\n')
print('Independent verifier decoded',len(rows),'native frames and',len(traces),'traces; original bytes unchanged.')
