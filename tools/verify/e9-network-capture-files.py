#!/usr/bin/env python3
"""Independent struct/hashlib oracle for guest queues, recorded network bytes and immutable CAS."""
import argparse,gzip,hashlib,json,re,struct
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);p.add_argument('--browser',action='store_true');a=p.parse_args();root=a.directory
sha=lambda b:hashlib.sha256(b).hexdigest()
u16=lambda b,i=0:struct.unpack_from('<H',b,i)[0]
u32=lambda b,i=0:struct.unpack_from('<I',b,i)[0]
u64=lambda b,i=0:struct.unpack_from('<Q',b,i)[0]
def frame(raw):
 assert raw[:12]==b'WVMRESU1\1\0\0\0';at=84;sections={}
 while at<len(raw):
  tag,n=struct.unpack_from('<II',raw,at);at+=8;assert tag not in sections and at+n<=len(raw);sections[tag]=raw[at:at+n];at+=n
 assert at==len(raw) and {1,2,3,4,7,9,18,21}<=sections.keys()
 ram=bytearray();at=0;data=sections[2]
 while at<len(data):
  kind,n=struct.unpack_from('<BI',data,at);at+=5;assert kind in (0,1) and n>0 and len(ram)+n<=16<<20
  if kind:assert at+n<=len(data);ram.extend(data[at:at+n]);at+=n
  else:ram.extend(bytes(n))
 assert len(ram)in(1<<20,16<<20)
 clock=sections[18];assert clock[:12]==b'WVCLK001\1\0\0\0' and len(clock)==58 and u32(clock,54)==0
 t,r,o,s,ticket=struct.unpack_from('<QQQQQ',clock,12);assert r<=t and o<=s<=ticket
 net=sections[21];assert net[:8]==b'WVNETS01';next_id,cursor,sent=struct.unpack_from('<QQQ',net,8);assert cursor<=s and sent<=cursor and sent<=next_id
 return dict(sha256=sha(raw),transition=t,retired=r,sequence=s,cursor=cursor,next_id=next_id,sent=sent),ram,sections
def event(raw):
 assert raw[:8]==b'WVNETE01';tag=raw[8];request=0;result=0;at=9;length=0
 if tag==1:result=raw[9];assert result<=2;request=u64(raw,10);assert request>0;length=u32(raw,18);at=22
 elif tag==2:length=u32(raw,9);at=13
 elif tag==3:request=raw[9];result=u32(raw,10);assert request in(1,2,3) and(request!=1 or result==0);at=14
 elif tag==4:result=raw[9];assert result in(0,1);at=10
 else:raise AssertionError('unknown event')
 payload=raw[at:];assert len(payload)==length<=65535
 return dict(tag=tag,id=request,result=result,payload=payload,header=raw[:at])
initial,_,_=frame((root/'initial.resume').read_bytes());pending,pram,_=frame((root/'pending.resume').read_bytes());final,ram,sections=frame((root/'final.resume').read_bytes())
assert initial['transition']==initial['sequence']==initial['cursor']==0
assert (pending['transition'],pending['retired'],pending['sequence'],pending['cursor'])==(1024,1024,1,1)
assert (final['transition'],final['retired'],final['sequence'],final['cursor'],final['next_id'],final['sent'])==(9216,9216,5,5,1,1)
assert (u16(pram,0x22002),u16(pram,0x12002))==(1,0)
assert (u16(ram,0x22002),u16(ram,0x12002))==(1,1)
assert [u64(ram,0x40000+i*8)for i in range(3)]==[1,1,1]
guest=(root/('guest.bin'if a.browser else'guest-report.bin')).read_bytes();assert guest==ram[0x40000:0x40420]
rx=(root/'receive-frame.bin').read_bytes();http=(root/'http-response.bin').read_bytes();assert rx[14:]==http
assert rx[:14]==bytes.fromhex('52540012345602000000000188b5')
head,body=http.split(b'\r\n\r\n',1);assert head.startswith(b'HTTP/1.1 200 OK\r\n') and b'Connection: close'in head
assert int(re.search(rb'Content-Length: (\d+)',head)[1])==len(body)
response=json.loads(body);assert response.get('count')==1 or response.get('source')=='safe-demo-response'
assert ram[0x14000:0x1400c]==bytes(10)+b'\1\0' and ram[0x1400c:0x1400c+len(rx)]==rx
assert guest[44:44+len(rx)]==rx
program=(Path(__file__).resolve().parents[2]/'web/assets/e9-network-capture.bin').read_bytes()
traces=(root/'original.trace').read_text().splitlines();assert len(traces)==9216
for i,line in enumerate(traces):
 match=re.match(r'core 0: 0x([0-9a-f]+) \(0x([0-9a-f]+)\)',line);assert match
 index=i if i<390 else 390+(i-390)%2087;pc=0x80000000+index*4
 assert int(match[1],16)==pc and int(match[2],16)==u32(program,index*4),(i,line)
positions=[(0,0,1,1),(1024,1024,1,2),(1024,1024,2,3),(1121,1121,1,4),(1137,1137,1,5)]
if a.browser:
 report=json.loads((root/'probe.json').read_text());rows=[]
 for receipt,position in zip(report['receipts'],positions):
  raw=(root/receipt['bytes']['file']).read_bytes();assert sha(raw)==receipt['bytes']['sha256'];rows.append(event(raw))
  assert(receipt['transition'],receipt['retired'],receipt['ordinal'],receipt['sequence'],receipt['phase'])==(str(position[0]),str(position[1]),position[2],str(position[3]),'before')
 manifest=json.loads((root/'manifest.json').read_text());assert 'network'in manifest['policy']['required_inputs'] and manifest['policy']['mode']=='capture-prefix'
 for object in report['persisted']['objects']:
  raw=(root/object['bytes']['file']).read_bytes();assert sha(raw)==object['ref']['sha256'] and str(len(raw))==object['ref']['length']
 encoded=[]
 for index in manifest['events']:
  raw=(root/'objects'/index['content']['sha256']).read_bytes();assert sha(raw)==index['content']['sha256'];encoded+=json.loads(raw)
 assert len(encoded)==len(rows)==5
 for encoded,row in zip(encoded,rows):
  intent=json.loads(bytes(encoded['intent']));assert intent['channel']==20 and encoded['kind']=='network' and encoded['device']=='virtio-net'
  if encoded['payload']['storage']=='blob':
   ref=encoded['payload']['content'];payload=(root/'objects'/ref['sha256']).read_bytes();assert sha(payload)==ref['sha256'] and str(len(payload))==ref['length']
  else:payload=bytes(encoded['payload']['bytes'])
  assert bytes(intent['header'])+payload==row['header']+row['payload']
 witness=(root/'objects'/manifest['checkpoints'][0]['machine']['sha256']).read_bytes();assert witness[:12]==b'WVINPUT1\1\0\0\0' and witness[28:]==(root/'initial.resume').read_bytes()
 for replay in report['replays']:
  assert(root/replay['frame']['file']).read_bytes()==(root/'final.resume').read_bytes()
  lines=(root/replay['trace']['file']).read_text().splitlines();assert lines==traces[1024 if replay['fromPending']else 0:]
 browser_report=json.loads((root/'report.json').read_text());assert browser_report['status']=='passed'and not browser_report['errors']
 for target in(5000,5001,5002):
  frames=[gzip.decompress((root/f'jit/target{target}-q{q}.resume.gz').read_bytes())for q in(31,1,8,4096)]
  assert all(raw==frames[0]for raw in frames);value,_,_=frame(frames[0]);assert value['transition']==value['retired']==target and value['cursor']==1
else:
 raw=(root/'network-envelopes.bin').read_bytes();at=0;rows=[]
 while at<len(raw):n=u32(raw,at);at+=4;rows.append(event(raw[at:at+n]));at+=n
 assert at==len(raw);assert[list(map(int,line.split()))for line in(root/'network-positions.tsv').read_text().splitlines()]==[list(p)for p in positions]
 for q in(1,7,4096):
  for pending_start in(False,True):assert(root/f'replay-{q}-pending-{str(pending_start).lower()}.trace').read_text().splitlines()==traces[1024 if pending_start else 0:]
 schedules=(root/'schedule-witness.txt').read_text().splitlines();assert len(schedules)==32
 for target in(5000,5001,5002):
  frames=[(root/f'jit-network-target{target}-q{q}.resume').read_bytes()for q in(31,1,8,4096)];assert all(raw==frames[0]for raw in frames)
assert[row['tag']for row in rows]==[3,1,4,2,3]
assert rows[0]['id']==1 and rows[1]['id']==1 and rows[1]['result']==0 and rows[2]['result']==1 and rows[4]['id']==2
assert rows[1]['payload']==bytes.fromhex('02000000000152540012345688b5')+b'GET /network-probe-response.json HTTP/1.1\r\nHost: session-probe\r\nConnection: close\r\n\r\n'
assert rows[3]['payload']==rx
result={'status':'passed','independent':'Python struct/hashlib only, pinned RV64 words checked for every retirement; no emulator codec imported','initial':initial,'pending':pending,'final':final,'events':[dict(tag=r['tag'],id=r['id'],result=r['result'],bytes=len(r['payload']),sha256=sha(r['payload']))for r in rows],'traceInstructions':len(traces)}
(root/'network-oracle.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
