"""Fresh verifier: decode actual bytes/clock/trace without product or worker codecs."""
from pathlib import Path
import hashlib,json,re,struct
ROOT=Path.cwd(); OUT=ROOT/'target/evidence/e9-t10-verifier';BASE=0x80000000
sha=lambda b:hashlib.sha256(b).hexdigest()
word=lambda t,c,v:struct.pack('<HHi',t,c,v)
pos=lambda r:tuple(r[k]for k in ('transition','phase','ordinal','sequence','retired'))
def native(raw):
 assert raw[:12]==b'WVMRESU1\1\0\0\0';p=84;sections={}
 while p<len(raw):
  tag,n=struct.unpack_from('<II',raw,p);p+=8;assert tag not in sections and p+n<=len(raw);sections[tag]=raw[p:p+n];p+=n
 encoded=sections[2];ram=bytearray();p=0
 while p<len(encoded):
  mode,n=struct.unpack_from('<BI',encoded,p);p+=5;assert mode in (0,1)and n>0
  ram.extend(encoded[p:p+n]if mode else bytes(n));p+=n if mode else 0
 assert p==len(encoded)
 clk=sections.get(18);clock=None
 if clk:
  assert clk[:12]==b'WVCLK001\1\0\0\0';t,r,o,s,ticket=struct.unpack_from('<5Q',clk,12);idle,external,count=struct.unpack_from('<BBI',clk,52);clock=(t,r,o,s,ticket,count)
 return sections,ram,clock
summary={}
for label,folder in [('worker','e9-t10-worker-final-incremental'),('cold','e9-t10-cold-final-incremental/acceptance'),('public','e9-t10-public-final')]:
 d=ROOT/'target/evidence'/folder;nd=d/'native';bd=d/'browser';result={'native':[],'prefixes':{},'files':{},'points':[]}
 if nd.exists():
  for f in sorted(nd.glob('*.resume')):
   raw=f.read_bytes();sections,ram,clock=native(raw);name=f.stem;t,r,o,s,ticket,count=clock;expected=None
   if name=='host-mailbox-pending':
    assert (t,r,o,s,count)==(7,7,0,0,1)
    assert struct.unpack_from('<QQBHI',sections[18],58)==(7,0,2,3,3)and sections[18][81:]==b'\x07\x08\x09'
   elif name=='uart-final':assert (t,r,s,count)==(154,154,6,0)
   else:
    stem=name.removesuffix('-replay')
    if stem=='keyboard-focus-release':ev=[(1,42,1),(1,30,1),(1,30,0),(1,42,0)];expected=b''.join(word(*x)+bytes(8)for x in ev)
    elif stem=='tablet-same-position':ev=[(3,0,125),(3,0,125),(3,1,711),(1,272,1),(1,272,0)];expected=b''.join(word(*x)+bytes(8)for x in ev)
    elif stem=='relative-mouse':ev=[(2,0,-7),(2,1,3),(1,272,1),(1,272,0)];expected=b''.join(word(*x)+bytes(8)for x in ev)
    elif name.startswith('rapid-typing-'):expected=(word(1,30,1)+bytes(8)+word(1,30,0)+bytes(8))*32;n=int(name[-1])+1;assert (t,r,s)==(2049*n,2049*n,128*n)
    elif stem=='agent-clipboard-prefix':expected=b'cli'
    elif stem=='dropped-frame':expected=b'';assert struct.unpack_from('<H',ram,0x12002)[0]==0
    else:raise AssertionError(name)
    assert (nd/(name+'.bin')).read_bytes()==expected
    assert ram[0x24000:0x24000+len(expected)]==expected
    if expected:assert struct.unpack_from('<Q',sections[1],40)[0]==expected[-1]
    trace=nd/(name+'.trace');lines=trace.read_text().splitlines();assert len(lines)==1+2*len(expected)
    for i,v in enumerate(expected):
     load=re.search(r'x5 0x([0-9a-f]+) mem 0x([0-9a-f]+)$',lines[1+2*i]);store=re.search(r'mem 0x([0-9a-f]+) 0x([0-9a-f]+)$',lines[2+2*i]);assert load and store
     assert (int(load[1],16),int(load[2],16),int(store[1],16),int(store[2],16))==(v,BASE+0x14000+i,BASE+0x24000+i,v)
    if name.endswith('-replay'):assert raw==(nd/(stem+'.resume')).read_bytes()
    result['points'].append({'path':str(trace.relative_to(ROOT)),'sha256':sha(trace.read_bytes()),'lines':len(lines),'sample_line':2 if expected else 1})
   result['native'].append({'name':name,'sha256':sha(raw),'clock':clock,'ram_sha256':sha(ram),'pc':struct.unpack_from('<Q',sections[1])[0]})
  original=bytes((13*i)&255 for i in range(77));assert (nd/'uart-guest.bin').read_bytes()==original
  for i in range(5):
   f=nd/f'uart-{i}.trace';lines=f.read_text().splitlines();values=[]
   for j in range(0,len(lines),2):
    l=re.search(r'x5 0x([0-9a-f]+) mem 0x([0-9a-f]+)$',lines[j]);st=re.search(r'mem 0x([0-9a-f]+) 0x([0-9a-f]+)$',lines[j+1]);v=int(l[1],16);assert int(l[2],16)==0x10000000 and int(st[1],16)==BASE+0x24000+j//2 and int(st[2],16)==v;values.append(v)
   assert bytes(values)==original[i*16:i*16+16]
   result['points'].append({'path':str(f.relative_to(ROOT)),'sha256':sha(f.read_bytes()),'lines':len(lines),'sample_line':1})
 for label2 in ['probe-prefix','probe-prefix-after-reload','bulk-prefix','worker-ui-prefix','file-prefix-before-quota','file-prefix-final','file-prefix-fresh-tab']:
  stored=json.loads((bd/(label2+'.json')).read_bytes());manifest=json.loads((bd/(label2+'.manifest.json')).read_bytes());assert stored['manifest']==manifest and manifest['policy']['mode']=='capture-prefix';objects={}
  def read(ref):
   import gzip
   digest=ref['sha256'];raw=gzip.decompress((bd/(label2+'-objects')/(digest+'.gz')).read_bytes());assert sha(raw)==digest and len(raw)==int(ref['length']);objects[digest]=len(raw);return raw
  witness=read(manifest['checkpoints'][0]['machine']);assert witness[:8]==b'WVINPUT1';ver,n,pending_len,output_len=struct.unpack_from('<IQII',witness,8);assert ver==1 and len(witness)==28+n+pending_len+output_len
  pending=bytearray(witness[28+n:28+n+pending_len]);initial_pending=bytes(pending);s=0;t=0;r=0;ordinal=0;receipts=[];frames={3:[],5:[],7:[]};feed=bytearray()
  for idx in manifest['events']:
   events=json.loads(read(idx['content']));assert len(events)==idx['count'] and pos(events[0])==pos(idx['first']) and pos(events[-1])==pos(idx['last'])
   for event in events:
    intent=json.loads(bytes(event['intent']));ch=intent['channel'];out=intent['outcome'];assert intent['version']==1 and len(out)==4 and all(re.fullmatch(r'0|[1-9][0-9]{0,19}',v)and int(v)<=2**64-1 for v in out)
    payload=event['payload'];b=bytes(payload['bytes'])if payload['storage']=='inline'else read(payload['content']);et=int(event['transition']);er=int(event['retired']);es=int(event['sequence']);eo=event['ordinal']
    assert event['phase']=='before'and es==s+1 and et>=t and r<=er<=et and eo==(ordinal+1 if et==t else 1)
    rec={k:event[k]for k in ('transition','phase','ordinal','sequence','retired')};rec.update(channel=ch,outcome=out,bytes=list(b));assert rec==stored['receipts'][len(receipts)]
    if ch==1 and out[0]=='0':pending.extend(b);assert len(pending)==int(out[2])
    if ch==2 and out[0]=='0':assert pending[:len(b)]==b;del pending[:len(b)];feed.extend(b);assert len(pending)==int(out[2])
    if ch in frames and out[0]=='0':assert len(b)==8;frames[ch].append(b)
    if ch in (4,6,8):
     count,retained=struct.unpack_from('<QI',b);assert count==len(frames[ch-1])and retained==count and b[12:]==b''.join(frames[ch-1])+(bytes(8)if count else b'');frames[ch-1].clear()
    receipts.append(rec);s,t,r,ordinal=es,et,er,eo
  assert pos(manifest['end'])==(str(t),'before',ordinal,str(s),str(r))
  if label2=='worker-ui-prefix':assert b'e9_initial=queued-before-recording\n'in initial_pending and bytes(feed[:len(initial_pending)])==initial_pending
  if label2=='bulk-prefix':
   assert len(receipts)==64 and len(manifest['events'])==3
   for i,rec in enumerate(receipts):assert rec['bytes']==[i]*65536 and rec['sequence']==str(i+1)and rec['ordinal']==i+1 and rec['transition']=='0'and rec['outcome'][0]==('0'if i<16 else'1')
  result['prefixes'][label2]={'events':len(receipts),'end':manifest['end'],'objects':len(objects),'initial_pending':len(initial_pending),'initial_pending_sha256':sha(initial_pending),'delivered_uart':len(feed),'manifest_sha256':sha((bd/(label2+'.manifest.json')).read_bytes()),'witness_sha256':sha(witness)}
 for a,b in [('probe-prefix','probe-prefix-after-reload'),('file-prefix-final','file-prefix-fresh-tab')]:assert (bd/(a+'.json')).read_bytes()==(bd/(b+'.json')).read_bytes()
 expected=b'Rclip:\xce\xbb\r\x08'+b''.join(word(1,c,v)+bytes(8)for c,v in [(42,1),(30,1),(30,0),(42,0)])+b'\x04'+(word(3,0,125)+bytes(8))*2+b'\x03'+word(2,0,-7)+word(2,1,3)+bytes(8)+b'D';assert(bd/'probe-guest.bin').read_bytes()==expected
 filebytes=bytes((37*i+71)&255 for i in range(131129))
 for name,wanted in [('linux-guest-file.bin',filebytes),('linux-guest-partial.bin',filebytes[:65528]),('linux-cancelled-private.bin',filebytes[:65528])]:
  actual=(bd/name).read_bytes();assert actual==wanted;result['files'][name]={'bytes':len(actual),'sha256':sha(actual)}
 records=json.loads((bd/'file-prefix-final.json').read_bytes())['receipts'];chunks=[q for q in records if q['channel']==13];assert any(bytes(q['bytes'][5:])==filebytes and q['outcome'][0]=='0'for q in chunks);assert any(q['outcome'][0]=='1'and q['outcome'][3]=='12'for q in chunks);assert any(q['channel']==14 and q['outcome'][0]=='0'for q in records)
 assert records[-1]['channel']==16 and records[-1]['bytes']==[2]and records[-1]['sequence']=='77'
 report=json.loads((bd/'report.json').read_bytes());assert report['checks']['quota']['before']==report['checks']['quota']['after']and report['checks']['quota']['paused']and report['checks']['concurrentStop']['stopped']and pos(report['checks']['concurrentStop'])==pos(records[-1])and report['errors']==[]
 result['status']='HELD';summary[label]=result
(OUT/'state-audit.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({k:{'status':v['status'],'native_frames':len(v['native']),'trace_files':len(v['points']),'prefixes':len(v['prefixes']),'files':v['files']}for k,v in summary.items()},indent=2))
