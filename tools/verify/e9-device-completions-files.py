#!/usr/bin/env python3
"""Independent native/browser guest DMA, completion envelope and persisted-CAS oracle."""
import argparse,hashlib,json,struct
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);p.add_argument('--browser',action='store_true');a=p.parse_args();root=a.directory
sha=lambda b:hashlib.sha256(b).hexdigest()
u16=lambda b,i=0:struct.unpack_from('<H',b,i)[0]
u32=lambda b,i=0:struct.unpack_from('<I',b,i)[0]
u64=lambda b,i=0:struct.unpack_from('<Q',b,i)[0]
def frame(path):
 raw=path.read_bytes();assert raw[:12]==b'WVMRESU1\1\0\0\0';at=84;sections={}
 while at<len(raw):
  tag,n=struct.unpack_from('<II',raw,at);at+=8;assert tag not in sections and at+n<=len(raw);sections[tag]=raw[at:at+n];at+=n
 assert at==len(raw) and {1,2,3,4,6,9,11,16,18,20}<=sections.keys()
 ram=bytearray();at=0;data=sections[2]
 while at<len(data):
  kind,n=struct.unpack_from('<BI',data,at);at+=5;assert kind in (0,1) and n>0 and len(ram)+n<=16<<20
  if kind:assert at+n<=len(data);ram.extend(data[at:at+n]);at+=n
  else:ram.extend(bytes(n))
 assert len(ram) in (1<<20,16<<20)
 clock=sections[18];assert len(clock)==58 and clock[:12]==b'WVCLK001\1\0\0\0' and u32(clock,54)==0
 t,r,o,s,ticket=struct.unpack_from('<QQQQQ',clock,12);assert r<=t and o<=s<=ticket
 devices=sections[20];size=u32(devices);hub=devices[4:4+size];assert hub[:8]==b'WVDEVST1';cfgsize=u32(hub,8);at=12+cfgsize
 next_id,cursor,clock_ns,capture_epoch=struct.unpack_from('<QQQQ',hub,at)
 return {'file':path.name,'sha256':sha(raw),'bytes':len(raw),'transition':t,'retired':r,'sequence':s,'cursor':cursor,'next_id':next_id,'capture_epoch':capture_epoch,'clock_ns':clock_ns},ram,sections
def completion(raw):
 assert raw[:8]==b'WVDEVC01';request=u64(raw,8);kind=raw[16];at=17;intent={}
 if kind==1:
  chunk=u32(raw,at);digest=raw[at+4:at+36].hex();length=u32(raw,at+36);intent={'chunk':chunk,'sha256':digest,'length':length};at+=40
 elif kind==2:intent={'generation':u64(raw,at),'maximum':u32(raw,at+8)};at+=12
 elif kind==3:intent={'samples':u32(raw,at),'rate':u32(raw,at+4),'channels':raw[at+8]};at+=9
 else:raise AssertionError('unknown adapter')
 status=raw[at];frames=u32(raw,at+1);length=u32(raw,at+5);at+=9;payload=raw[at:];assert length==len(payload) and status in (0,1,2)
 if status:assert frames==0 and payload==b''
 elif kind==1:assert frames==0 and length==intent['length'] and sha(payload)==intent['sha256']
 elif kind==2:assert frames==0 and length<=intent['maximum']
 else:assert intent['rate']==48000 and intent['channels'] in (1,2) and length==frames*intent['channels']*2 and frames<=intent['samples']//intent['channels']
 return dict(request=request,kind=kind,intent=intent,status=status,frames=frames,payload=payload)
payload=lambda chunk:bytes((n*13+chunk*79+17)%251 for n in range(512))
final,ram,sections=frame(root/'final.resume');pending,pram,_=frame(root/'pending.resume')
assert (final['transition'],final['retired'],final['sequence'],final['cursor'])==(9096,9096,4,4)
assert (pending['transition'],pending['retired'],pending['sequence'],pending['cursor'])==(4096,4096,0,0)
assert u16(pram,0x12002)==u16(pram,0x22402)==u16(pram,0x32302)==0
assert (u16(ram,0x12002),u32(ram,0x12004),u32(ram,0x1200c))==(2,3,0)
assert (u16(ram,0x22402),u16(ram,0x32302))==(1,1)
assert ram[0x14000:0x14200]==payload(0) and ram[0x14400:0x14600]==payload(1)
assert ram[0x24000:0x24017]==b'file-agent-owned-result' and ram[0x34100:0x34104]==bytes.fromhex('3412cdab')
assert u32(ram,0x34200)==0x8000
assert [u64(ram,0x40000+i*8)for i in range(6)]==[2,1,1,1,1,1]
traces=(root/'original.trace').read_text().splitlines();assert len(traces)==9096 and all(line.startswith('core 0: ')for line in traces)
if a.browser:
 report=json.loads((root/'probe.json').read_text());rows=[]
 for index,receipt in enumerate(report['receipts']):
  raw=(root/receipt['bytes']['file']).read_bytes();assert sha(raw)==receipt['bytes']['sha256'];rows.append(completion(raw))
  assert (receipt['transition'],receipt['retired'],receipt['sequence'],receipt['phase'],receipt['ordinal'])==(str(4096+index*173),str(4096+index*173),str(index+1),'before',1)
 manifest=json.loads((root/'manifest.json').read_text());assert manifest['policy']['mode']=='capture-prefix' and 'block-read'in manifest['policy']['required_inputs'] and 'audio-capture'in manifest['policy']['required_inputs']
 for object in report['persisted']['objects']:
  raw=(root/object['bytes']['file']).read_bytes();assert sha(raw)==object['ref']['sha256'] and str(len(raw))==object['ref']['length']
 for asset in manifest['assets']:
  raw=(root/'objects'/asset['content']['sha256']).read_bytes();assert sha(raw)==asset['content']['sha256'] and str(len(raw))==asset['content']['length']
 witness=(root/'objects'/manifest['checkpoints'][0]['machine']['sha256']).read_bytes();assert witness[:12]==b'WVINPUT1\1\0\0\0' and u64(witness,12)==len((root/'initial.resume').read_bytes()) and u32(witness,20)==u32(witness,24)==0 and witness[28:]==(root/'initial.resume').read_bytes()
 encoded=[]
 for index in manifest['events']:
  raw=(root/'objects'/index['content']['sha256']).read_bytes();assert sha(raw)==index['content']['sha256'];encoded+=json.loads(raw)
 assert len(encoded)==4
 for event,row in zip(encoded,rows):
  intent=json.loads(bytes(event['intent']));ref=event['payload']['content'];raw=(root/'objects'/ref['sha256']).read_bytes();assert sha(raw)==ref['sha256'] and str(len(raw))==ref['length'] and raw==row['payload']
  envelope=bytes(intent['header'])+raw;assert completion(envelope)==row
  if row['kind']==1:assert ref['sha256']==row['intent']['sha256'],'base bytes separately addressed from delivery metadata'
 for replay in report['replays']:
  raw=(root/replay['frame']['file']).read_bytes();assert raw==(root/'final.resume').read_bytes()
else:
 raw=(root/'completion-envelopes.bin').read_bytes();at=0;rows=[]
 while at<len(raw):n=u32(raw,at);at+=4;rows.append(completion(raw[at:at+n]));at+=n
 assert at==len(raw)
 positions=[list(map(int,line.split()))for line in(root/'completion-positions.tsv').read_text().splitlines()]
 assert positions==[[4096+i*173,4096+i*173,1,i+1]for i in range(4)]
 for name in ['cancel-before.resume','cancelled.resume','cow.resume','malformed-source.resume','capture-short-ready.resume','capture-short-final.resume','capture-failed-ready.resume','capture-failed-final.resume','capture-stopped.resume']:
  frame(root/name)
 for name,expected,status in [('short',bytes.fromhex('67450000'),0x8000),('failed',bytes(4),0x8003)]:
  value,data,_=frame(root/f'capture-{name}-final.resume');assert data[0x34100:0x34104]==expected and u32(data,0x34200)==status and value['cursor']==1
 for quantum in [1,7,4096]:
  lines=(root/f'replay-{quantum}.trace').read_text().splitlines();assert lines==traces[4096:]
assert [row['kind']for row in rows]==[1,2,3,1] and [row['request']for row in rows]==[2,3,4,1]
assert rows[0]['intent']['chunk']==1 and rows[0]['payload']==payload(1) and rows[3]['intent']['chunk']==0 and rows[3]['payload']==payload(0)
result={'status':'passed','final':final,'pending':pending,'completions':[dict(request=row['request'],kind=row['kind'],status=row['status'],frames=row['frames'],payload_bytes=len(row['payload']),payload_sha256=sha(row['payload']))for row in rows],'trace_instructions':len(traces),'independent':'Python struct/hashlib only; no emulator codec or generated expected output imported'}
(root/'device-oracle.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
