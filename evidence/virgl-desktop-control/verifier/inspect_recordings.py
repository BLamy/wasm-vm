#!/usr/bin/env python3
import hashlib,json,pathlib,re,struct,collections
repo=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent
w=repo/'target/evidence/virgl-desktop-control-verifier/reopened/worker'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def decode(row):
 raw=bytes.fromhex(row['transportCanonical']);assert sha(raw)==row['transportDigest'];assert raw[:8]==b'WV3DCTL2';pos=8
 def take(fmt):
  nonlocal pos
  v=struct.unpack_from('<'+fmt,raw,pos);pos+=struct.calcsize('<'+fmt);return v[0] if len(v)==1 else v
 epoch,gen,bgen,logical,gpu,backing=take('6Q');poison=take('B');ctx={};resources={}
 for _ in range(take('I')):
  cid,cgen=take('IQ');length=take('I');name=raw[pos:pos+length];pos+=length
  members=dict(take('IQ') for _ in range(take('I')));assert cid not in ctx
  ctx[cid]={'generation':cgen,'name':name.hex(),'members':members}
 for _ in range(take('I')):
  rid,rgen=take('IQ');meta=take('11I');entries=None;bg=None
  if take('B'):bg=take('Q');entries=[take('QI') for _ in range(take('I'))]
  assert rid==meta[0] and rid not in resources
  resources[rid]={'generation':rgen,'metadata':list(meta),'backing':entries,'backingGeneration':bg}
 assert pos==len(raw)
 assert all(0<r['generation']<gen for r in resources.values()) and all(0<c['generation']<gen for c in ctx.values())
 assert all(m in resources and resources[m]['generation']==mg for c in ctx.values() for m,mg in c['members'].items())
 calc_log=sum(r['metadata'][4]*(r['metadata'][5]*4 if r['metadata'][1]==2 else 1) for r in resources.values())
 calc_gpu=sum(r['metadata'][4]*(r['metadata'][5]*4 if r['metadata'][1]==2 else 1) for r in resources.values() if r['metadata'][3]!=524288)
 calc_back=sum(length for r in resources.values() for addr,length in (r['backing'] or []))
 assert (logical,gpu,backing)==(calc_log,calc_gpu,calc_back)
 assert gpu<=33554432 and backing<=33554432
 assert all(r['backingGeneration'] is None or 0<r['backingGeneration']<bgen for r in resources.values())
 return {'epoch':epoch,'nextGeneration':gen,'nextBackingGeneration':bgen,'logical':logical,'gpu':gpu,'backing':backing,'poisoned':poison,'contexts':ctx,'resources':resources}
def read_log(path):
 rows=[];traces=[]
 for lineno,line in enumerate(path.read_text().splitlines(),1):
  if line.startswith(('CONTROL3D_RECORD ','CONTROL3D_PORTABLE_RECORD ')):
   row=json.loads(line.split(' ',1)[1]);row['line']=lineno
   if row['transportCanonical']:row['state']=decode(row)
   rows.append(row)
  elif line.startswith('CONTROL3D_GUEST_TRACE '):traces.append({'line':lineno,'text':line})
 return rows,traces
def validate_record(row):
 req=bytes.fromhex(row['request']);rep=bytes.fromhex(row['response']);assert len(rep)==24
 expected_tail=struct.pack('<IQIB3x',int.from_bytes(req[4:8],'little')&1,int.from_bytes(req[8:16],'little') if req[4]&1 else 0,int.from_bytes(req[16:20],'little'),req[20])
 assert rep[4:]==expected_tail and row['responseGuard']=='a5'*40
 assert re.fullmatch('[0-9a-f]{64}',row['machineDigest'])
 used=bytes.fromhex(row['ring']['used']);avail=bytes.fromhex(row['ring']['avail']);desc=bytes.fromhex(row['ring']['descriptors']);assert len(desc)==256 and len(used)==136 and len(avail)==40
 idx=row['usedIndex'];slot=(idx-1)%16;assert struct.unpack_from('<H',used,2)[0]==idx and struct.unpack_from('<H',avail,2)[0]==idx
 assert struct.unpack_from('<II',used,4+8*slot)==(0,24) and struct.unpack_from('<H',avail,4+2*slot)[0]==0
 nxt=0;visited=set();rsegments=[];wsegments=[]
 while True:
  assert nxt not in visited;visited.add(nxt);addr,length,flags,nex=struct.unpack_from('<QIHH',desc,16*nxt)
  assert 0<length and flags&~3==0
  (wsegments if flags&2 else rsegments).append((addr,length))
  if flags&1:nxt=nex
  else:break
 assert sum(l for a,l in rsegments)==len(req) and sum(l for a,l in wsegments)==24
 assert rsegments[0][0]==0x80010000 and wsegments[0][0]==0x80014000
 return {'requestSegments':rsegments,'responseSegments':wsegments}
rows,traces=read_log(w/'hot/native-control.stderr');cold,cold_traces=read_log(w/'cold/recording/native-control.stderr')
assert len(rows)==608 and len(traces)==632 and rows==cold and traces==cold_traces
assert all(t['text']=='CONTROL3D_GUEST_TRACE core 0: 0x0000000080200000 (0x0000006f)' for t in traces)
for r in rows:r['segmentation']=validate_record(r)
fixture=(repo/'tools/virgl-desktop-control/packets.rs').read_text();original=[]
for name,count_expected,peak_expected,refusal in [('compositor',56,24,None),('kmscube',8,4,None),('glmark2-es2',33,25,3025)]:
 manifest=(w/'hot/original'/name/'manifest.json').read_bytes();m=json.loads(manifest);raw=(w/'hot/original'/name/m['events']['path']).read_bytes()
 assert sha(raw)==m['events']['sha256'] and len(raw)==m['events']['bytes']
 assert raw==(repo/'evidence/virgl-corpus/captures'/name/m['events']['path']).read_bytes()
 events=list(map(json.loads,raw.splitlines()));pending={};calls=[]
 for e in events:
  if e['type'] not in ('resource_create','resource_unref'):continue
  if e['phase']=='enter':assert e['seq'] not in pending;pending[e['seq']]=e
  else:
   assert e['phase']=='return' and e['callSeq'] in pending
   entered=pending.pop(e['callSeq']);assert e['type']==entered['type'] and e['result']==0
   calls.append({'enter':entered,'return':e})
 assert not pending
 bootstrap=[c for c in calls if c['enter']['resourceId']==2]
 assert len(bootstrap)==1 and bootstrap[0]['enter']['seq']==10 and bootstrap[0]['enter']['flags']==1 and bootstrap[0]['enter']['type']=='resource_create'
 accepted=[c for c in calls if c not in bootstrap];packets=[]
 for c in accepted:
  e=c['enter']
  if e['type']=='resource_create':
   fields=[e[k] for k in ('resourceId','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags')]
   packet=bytearray(72);struct.pack_into('<I',packet,0,0x204)
   for i,val in enumerate(fields):struct.pack_into('<I',packet,24+4*i,val)
  else:packet=bytearray(32);struct.pack_into('<I',packet,0,0x102);struct.pack_into('<I',packet,24,e['resourceId'])
  c['packet']=packet.hex();packets.append((e['seq'],bytes(packet)))
 block=fixture.split('pub const '+name.upper().replace('-','_')+':',1)[1].split('pub const ',1)[0]
 literals=[(int(match[1]),bytes(int(x) for x in re.findall(r'\d+',match[2]))) for match in re.finditer(r'\(\s*(\d+),\s*&\[(.*?)\],\s*\)',block,re.S)]
 assert packets==literals,(name,'complete literal packets differ')
 model={};generation=1;peak=0;successful=0;points=[];previous=None
 for c in accepted:
  e=c['enter'];observed=[r for r in rows if r['case']==f"desktop-{name}-original-{e['seq']}"];assert len(observed)==1
  r=observed[0];assert r['request']==c['packet'];code=int.from_bytes(bytes.fromhex(r['response'])[:4],'little')
  if e['seq']==refusal:
   assert e['format']==17 and code==0x1205
   assert r['state']==previous['state'] and r['sinkEvents']==successful
  else:
   assert code==0x1100;successful+=1
   if e['type']=='resource_create':
    assert e['resourceId'] not in model
    meta=[e[k] for k in ('resourceId','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags')]
    model[e['resourceId']]={'generation':generation,'metadata':meta,'backing':None,'backingGeneration':None};generation+=1
   else:assert model.pop(e['resourceId']) is not None
  state=r['state'];assert state['resources']==model and not state['contexts'] and state['nextGeneration']==generation and state['backing']==0 and state['poisoned']==0 and r['sinkEvents']==successful
  peak=max(peak,len(model));points.append({'event':e['seq'],'line':r['line'],'response':hex(code),'resources':len(model),'sinkEvents':r['sinkEvents'],'digest':r['transportDigest']});previous=r
  if e['seq']==refusal:break
 assert successful==count_expected and peak==peak_expected
 if refusal is None:assert not model and len(accepted)==successful
 else:assert all(next(p for p in points if p['event']==s)['response']=='0x1100' for s in [276,463])
 original.append({'workload':name,'manifestSha256':sha(manifest),'eventsSha256':sha(raw),'completeCalls':calls,'soleBootstrap':bootstrap[0],'fixtureCalls':len(packets),'successes':successful,'peak':peak,'refusal':refusal,'points':points})
# Exact success and error points, independent of the worker's audit implementation.
bycase=collections.defaultdict(list)
for r in rows:bycase[r['case']].append(r)
capacity=bycase['desktop-count-admitted'];assert len(capacity)==64
for i,r in enumerate(capacity,1):assert len(r['state']['resources'])==i and r['sinkEvents']==i and (r['state']['logical'],r['state']['gpu'])==(i*8,i*8)
refused=bycase['desktop-count-65-refused'][0];assert refused['response'].startswith('01120000') and refused['state']==capacity[-1]['state'] and refused['sinkEvents']==64
before=bycase['desktop-count-release'][0];fail=bycase['desktop-host-refusal-no-publication'][0];assert fail['state']==before['state'] and fail['sinkEvents']==before['sinkEvents'] and fail['response'].startswith('01120000')
for label in ['desktop-GPU-budget-admitted','desktop-backing-byte-admitted']:
 last=bycase[label][-1];assert last['state']['gpu' if label=='desktop-GPU-budget-admitted' else 'backing']==33554432
for label in ['desktop-GPU-budget-plus-one','desktop-resource-budget-plus-one','desktop-color-resource-budget-plus-one','desktop-backing-byte-plus-one','desktop-backing-resource-plus-one']:
 for r in bycase[label]:assert r['response'].startswith('01120000')
for label in ['desktop-invalid-role','desktop-unqualified-format','desktop-invalid-metadata','desktop-short-metadata','desktop-dimension-plus-one','legacy-color-refusal','legacy-depth-refusal']:
 for r in bycase[label]:assert r['response'].startswith('05120000')
for label in ['desktop-color-role','desktop-depth-role','desktop-dimension-exact','legacy-color-admission','desktop-profile-retained-after-reset']:
 for r in bycase[label]:assert r['response'].startswith('00110000')
assert len(bycase['resource-budget-valid'])==16 and bycase['resource-budget-plus-one'][0]['response'].startswith('01120000')
for prefix in ['hot','cold/recording']:
 stdout=(w/prefix/'native-control.stdout').read_text();assert '12 passed; 0 failed; 0 ignored' in stdout
 for name in ['native-control','native-gpu','native-machine','wasm-core-default','wasm-core-selected']:
  text=(w/prefix/(name+'.stderr')).read_text();assert 'panicked at' not in text and 'FAILED' not in text
browser=[]
for label,p in [('hot',w/'hot/default-demo'),('cold',w/'cold/recording/default-demo'),('live',repo/'evidence/virgl-desktop-control/deployment/final')]:
 report=json.loads((p/'report.json').read_bytes());assert report['status']=='passed' and report['passed']==127 and report['failed']==0 and report['proofExportAbsent'] and not report['errors']
 assert report['roadmapPip']=='cap-pip live' and report['graphicsRoadmapPip']=='cap-pip partial' and report['gitHead']=='e13dddfbb0d955abb268e4b4ac07828cbea35956'
 assert report['servedWasmSha256']=='5ecbc124be68e42a708d18f6aaf49c94793a7d9b1c757f9922dab78c7951c4d8'
 assert sha((p/'browser.png').read_bytes())==report['screenshot']['sha256']
 if label=='live':
  assert report['httpErrors']==[] and len(report['favicon404'])==1 and report['favicon404'][0]['location']['url']=='https://wasm-vm.pages.dev/favicon.ico' and '404' in report['favicon404'][0]['text']
 browser.append({'label':label,'reportSha256':sha((p/'report.json').read_bytes()),'report':{k:v for k,v in report.items() if k!='served'}})
report={'schema':'desktop-control-critic-recording-audit-v1','nativeRecords':len(rows),'guestInstructions':len(traces),'hotColdRecordsEqual':True,'original':original,'selectedBoundaryPoints':[{k:r[k] for k in ('case','line','response','sinkEvents','transportDigest')} for r in [capacity[0],capacity[15],capacity[62],capacity[63],refused,before,fail]],'cases':dict(collections.Counter(r['case'] for r in rows)),'browser':browser,'guestExecution':False,'productionAuthority':False}
(out/'recording-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'nativeRecords':len(rows),'guestInstructions':len(traces),'original':[(o['workload'],o['successes'],o['peak'],o['fixtureCalls'],o['refusal']) for o in original],'browser':[b['label'] for b in browser]}))
