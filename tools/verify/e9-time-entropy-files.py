#!/usr/bin/env python3
"""Independent WVOBLOG1/TLV/RAM/RTC/ICount oracle; no emulator codec is imported."""
import argparse,gzip,hashlib,json,re,struct
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);p.add_argument('--browser',action='store_true');a=p.parse_args();root=a.directory.resolve()
sha=lambda b:hashlib.sha256(b).hexdigest()
u64=lambda b,i=0:struct.unpack_from('<Q',b,i)[0]
u32=lambda b,i=0:struct.unpack_from('<I',b,i)[0]
MASK=(1<<64)-1

def tape(raw):
 assert raw[:12]==b'WVOBLOG1\1\0\0\0' and len(raw)>=32
 policy=struct.unpack_from('<IIQ',raw,12);assert policy==(1,5,10000000)
 out=[];at=32;last=None
 for _ in range(u32(raw,28)):
  assert at+38<=len(raw)
  t,r,s,o,k,status,n,length=struct.unpack_from('<QQQIBBII',raw,at);at+=38
  assert k in range(1,7) and status in (0,1) and 0<n<=1048576 and r<=t and o>0 and s>0
  assert length==(n if status==0 else 0) and (k==6 or n==8) and at+length<=len(raw)
  key=(t,o,s);assert last is None or key>last;last=key
  out.append(dict(transition=str(t),retired=str(r),phase='observe',ordinal=o,sequence=str(s),kind=k,status=status,requested=n,bytes=raw[at:at+length]));at+=length
 assert len(out)<=256 and at==len(raw);return out

def frame(file):
 raw=file.read_bytes();assert raw[:12]==b'WVMRESU1\1\0\0\0';at=84;sections={}
 while at<len(raw):
  tag,n=struct.unpack_from('<II',raw,at);at+=8;assert tag not in sections and at+n<=len(raw);sections[tag]=raw[at:at+n];at+=n
 assert at==len(raw) and {1,2,3,8,9,18,19}<=sections.keys()
 ram=bytearray();data=sections[2];at=0
 while at<len(data):
  kind,n=struct.unpack_from('<BI',data,at);at+=5;assert kind in (0,1) and n>0 and len(ram)+n<=16<<20
  if kind:assert at+n<=len(data);ram.extend(data[at:at+n]);at+=n
  else:ram.extend(bytes(n))
 assert len(ram)==16<<20
 clock=sections[18];assert len(clock)==58 and clock[:12]==b'WVCLK001\1\0\0\0' and u32(clock,54)==0
 t,r,o,s,ticket=struct.unpack_from('<QQQQQ',clock,12);assert r<=t and o<=s<=ticket
 source=sections[19];assert len(source)==32 and source[:8]==b'WVOBS001' and struct.unpack_from('<IIQ',source,8)==(1,5,10000000)
 assert u64(source,24)<=s
 mtime,deadline,msip=struct.unpack('<QQB',sections[3]);residue,divider,stimecmp=struct.unpack('<QQQ',sections[9]);assert divider==5 and residue==r%5
 return {'file':file.name,'sha256':sha(raw),'bytes':len(raw),'transition':t,'retired':r,'sequence':s,'ordinal':o,'source_cursor':u64(source,24),'mtime':mtime,'deadline':deadline,'residue':residue,'pc':u64(sections[1])},ram,sections

def normalize(receipts,browser):
 rows=[]
 for r in receipts:
  k=int(r['outcome'][1]) if browser and r['channel']>=17 else (16 if browser else r['kind'])
  rows.append({**{f:r[f] for f in ['transition','retired','phase','ordinal','sequence']},'kind':k,'status':int(r['outcome'][0])if browser and k!=16 else r.get('status',0),'requested':int(r['outcome'][2])if browser and k!=16 else r.get('requested',len(r.get('bytes',[]))),'bytes':bytes(r['bytes'])if browser else bytes.fromhex(r['hex'])})
 return rows

def workload(label,framefile,pausedfile,tapefile,tracefile,uartfile,receipts,seed=None):
 w,ram,sec=frame(framefile);paused,_,_=frame(pausedfile);records=tape(tapefile.read_bytes());report=uartfile.read_bytes();trace=tracefile.read_text().splitlines()
 assert len(report)==113 and report==ram[0x5000:0x5071] and len(trace)==522 and (w['transition'],w['retired'])==(523,522)
 assert w['source_cursor']==len(records) and paused['source_cursor']==sum(int(r['sequence'])<=paused['sequence'] for r in records)
 assert [r for r in receipts if r['kind']!=16]==records
 assert w['sequence']==len(receipts)==len(records)+5
 assert [(r['transition'],r['bytes'])for r in receipts if r['kind']==16]==[('0',b'\1'),('133',b'\0'),('133',b'\1'),('523',b'\0'),('523',b'\2')]
 for i,r in enumerate(receipts):assert int(r['sequence'])==i+1 and r['phase']==('before'if r['kind']==16 else'observe')
 rng=[r for r in records if r['kind']==6];assert [r['requested']for r in rng]==[16,33]
 assert rng[0]['bytes']==ram[0x4000:0x4010]==report[64:80] and rng[1]['bytes']==ram[0x4100:0x4121]==report[80:113]
 assert struct.unpack_from('<H',ram,0x3002)[0]==2 and u32(ram,0x3008)==16 and u32(ram,0x3010)==33
 if seed is not None:
  for j,r in enumerate(rng):assert r['bytes']==bytes((seed*13+j*37+i*11)&255 for i in range(r['requested']))
 # Model Goldfish state entirely from external samples and guest-written time halves.
 offset=0;latch=0;alarm=None;armed=False;fired=False;reads=[];samples=[]
 for r in records:
  assert r['status']==0
  if r['kind']==6:continue
  host=u64(r['bytes']);now=(host+offset)&MASK;k=r['kind'];ret=int(r['retired'])
  if k==1:
   reads.append(now);latch=now>>32
   assert f'x5 0x{now&0xffffffff:016x} mem 0x0000000000101000' in trace[ret]
   assert f'x5 0x{latch:016x} mem 0x0000000000101004' in trace[ret+2]
  elif k==3:
   offset=(((now&0xffffffff)|(0x12345678<<32))-host)&MASK
   assert 'mem 0x0000000000101004 0x12345678' in trace[ret]
  elif k==2:
   offset=(((now&0xffffffff00000000)|0x9abcdef0)-host)&MASK
   assert 'mem 0x0000000000101000 0x9abcdef0' in trace[ret]
  elif k==4:
   alarm=(reads[0]+100000000)&MASK;armed=now<alarm;fired=not armed
  elif k==5:
   assert armed
   if now>=alarm:armed=False;fired=True
  samples.append({'sequence':r['sequence'],'kind':k,'raw_ns':str(host),'guest_ns':str(now),'trace_line':ret+1})
 assert len(reads)==4 and reads==[u64(report,i) for i in [0,56,8,16]]
 assert sec[8]==struct.pack('<QI QI BBB',offset,latch,alarm,alarm>>32,int(armed),1,int(fired))
 assert report[48:56]==bytes(8) and not armed and fired
 # rdtime before WFI uses retired instructions/divider; idle advances to the written deadline.
 rd=[i for i,l in enumerate(trace)if '(0xc0102373)' in l];idle=next(i+1 for i,l in enumerate(trace)if '(0x10500073)'in l)
 assert len(rd)==3 and idle==186
 before=u64(report,32);deadline=before+1000
 expected=[rd[0]//5,rd[1]//5,deadline+rd[2]//5-idle//5]
 assert [u64(report,i)for i in [24,32,40]]==expected
 assert w['deadline']==deadline and w['mtime']==deadline+w['retired']//5-idle//5
 return {'label':label,'frame':w,'paused':paused,'observations':len(records),'entropy_sha256':[sha(r['bytes'])for r in rng],'rtc_samples':samples,'trace':{'lines':len(trace),'sha256':sha(tracefile.read_bytes())},'uart_sha256':sha(report),'icount':{'read_values':expected,'idle_after_retired':idle,'deadline':deadline}}

def reference(item):
 file=root/item['file'];raw=file.read_bytes();assert len(raw)==item['bytes'] and sha(raw)==item['sha256'];return file

result={'status':'running','scope':__doc__,'workloads':[]}
if not a.browser:
 for seed in [0x9e3779b9,0xa409a563]:
  name=f'seed-{seed:08x}';rows=normalize([json.loads(l)for l in(root/(name+'.receipts.jsonl')).read_text().splitlines()],False)
  w=workload(name,root/(name+'-record.resume'),root/(name+'-paused.resume'),root/(name+'.observations'),root/(name+'-record.trace'),root/(name+'.uart.bin'),rows,seed);result['workloads'].append(w)
  for q in [1,7,64]:
   assert(root/(name+f'-q{q}-replay.resume')).read_bytes()==(root/(name+'-record.resume')).read_bytes()
   assert(root/(name+f'-q{q}-replay.trace')).read_bytes()==(root/(name+'-record.trace')).read_bytes()
 assert(root/'cursor-source.final.resume').read_bytes()==(root/'restored-source-cursor.resume').read_bytes()
 first=tape((root/'bounded-rtc-budget.observations').read_bytes());rest=tape((root/'bounded-rtc-budget-suffix.observations').read_bytes());assert(len(first),len(rest))==(252,248)
 for i,r in enumerate(first+rest):assert (int(r['transition']),int(r['retired']),int(r['sequence']),r['kind'],u64(r['bytes']))==(i*2,i*2,i+1,1,1700000000123456789+i*17)
 bw,_,_=frame(root/'bounded-rtc-budget.resume');ew,_,_=frame(root/'bounded-rtc-budget-final.resume');assert(bw['transition'],bw['retired'],bw['source_cursor'])==(503,503,252) and (ew['transition'],ew['retired'],ew['source_cursor'])==(1000,1000,500)
 assert len((root/'bounded-rtc-budget.trace').read_text().splitlines())==1000
 failure=tape((root/'unavailable-entropy.observations').read_bytes());assert failure[-1]['kind']==6 and failure[-1]['status']==1 and failure[-1]['bytes']==b''
 quota=[json.loads(l)for l in(root/'entropy-chain-quota.receipts.jsonl').read_text().splitlines()];assert len(quota)==256 and [r['kind']for r in quota[-5:]]==[6]*5
else:
 data=json.loads((root/'probe/probe.json').read_text());assert data['status']=='passed'
 result['workloads'].append(workload('browser',reference(data['finalFrame']),reference(data['pausedFrame']),reference(data['tape']),reference(data['trace']),reference(data['guestBytes']),normalize(data['receipts'],True)))
 for replay in data['replays']:
  assert replay['hostReads']=={'rtc':0,'entropy':0}
  for key,original in [('frame','finalFrame'),('trace','trace'),('guestBytes','guestBytes')]:assert reference(replay[key]).read_bytes()==reference(data[original]).read_bytes()
  assert replay['receipts']==data['receipts']
 assert [r['code']for r in data['refusals']]==['ClockPolicyMismatch','MissingRecord','MalformedObservation','Length','Kind','Position','ExtraRecords']
 for unavailable in data['unavailable']:
  records=tape(reference(unavailable['tape']).read_bytes());assert records[-1]['status']==1 and unavailable['replayHostReads']=={'rtc':0,'entropy':0} and unavailable['point']==unavailable['replayPoint']
 crypto=json.loads((root/'crypto-unavailable.json').read_text());assert crypto['code']==crypto['replayCode']=='ProviderUnavailable' and crypto['receipts']==crypto['replayed'] and crypto['replayHostReads']=={'rtc':0,'entropy':0};assert tape(reference(crypto['tape']).read_bytes())[-1]['status']==1
 result['prefixes']=[]
 for label in ['direct-prefix','worker-prefix']:
  folder=root/label;data=json.loads((folder/'prefix.json').read_text());reopened=json.loads((root/(label+'-reopened')/'prefix.json').read_text());assert data==reopened
  manifest=json.loads((folder/'manifest.json').read_text());assert manifest==data['manifest'] and manifest['policy']['mode']=='capture-prefix'
  objects={}
  for ref in data['files']:
   raw=gzip.decompress((folder/(ref['sha256']+'.gz')).read_bytes());assert len(raw)==int(ref['length']) and sha(raw)==ref['sha256'];objects[ref['sha256']]=raw
   assert gzip.decompress((root/(label+'-reopened')/(ref['sha256']+'.gz')).read_bytes())==raw
  config=json.loads(objects[next(a['content']['sha256']for a in manifest['assets']if a['role']=='vm')]);assert config['timeEntropyPolicy']=={'version':1,'divider':5,'timebase_hz':'10000000','rtc':'external-nanoseconds-v1','entropy':'exact-fill-bytes-v1'}
  rows=[];seq=0;previous=None
  for chunk in manifest['events']:
   entries=json.loads(objects[chunk['content']['sha256']]);assert entries
   for event in entries:
    seq+=1;assert event['sequence']==str(seq)
    intent=json.loads(bytes(event['intent']));payload=event['payload'];raw=bytes(payload['bytes'])if payload['storage']=='inline'else objects[payload['content']['sha256']]
    row={**{k:event[k]for k in ['transition','retired','phase','ordinal','sequence']},'channel':intent['channel'],'outcome':intent['outcome'],'bytes':list(raw)};rows.append(row)
    assert event['phase']==('observe'if intent['channel']>=17 else'before')
    key=(int(event['transition']),int(event['phase']=='observe'),event['ordinal']);assert previous is None or key>previous;previous=key
  assert rows==data['receipts'] and seq==int(manifest['end']['sequence'])
  output=(folder/'guest.uart.bin').read_bytes();assert len(output)==113 and [bytes(r['bytes'])for r in rows if r['channel']==18]==[output[64:80],output[80:113]]
  assert rows[0]['channel']==rows[-1]['channel']==16 and rows[0]['bytes']==[1] and rows[-1]['bytes']==[2]
  capture=json.loads((folder/'capture.json').read_text());assert capture['done']=='poweroff' and capture['errors']==[] and sha((folder/'kernel.bin').read_bytes())==capture['kernel']['sha256']
  whole=(root/('worker-whole-uart.bin'if label.startswith('worker')else'direct-whole-uart.bin')).read_bytes();assert whole[:113]==output and sha(whole)==capture['output']['sha256'] and len(whole)==capture['output']['bytes']
  assert whole[113:]==b'' or re.fullmatch(rb'\r\nstate sha256=[0-9a-f]{64}\r\n',whole[113:])
  result['prefixes'].append({'label':label,'events':seq,'end':manifest['end'],'objects':len(objects),'output_sha256':sha(output)})
result['status']='passed';(root/'source-oracle.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','workloads':len(result['workloads']),'prefixes':len(result.get('prefixes',[]))}))
