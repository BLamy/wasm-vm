#!/usr/bin/env python3
import collections,hashlib,json,pathlib,struct
out=pathlib.Path(__file__).resolve().parent
namespace={'__file__':str(out/'inspect_recordings.py')}
exec((out/'inspect_recordings.py').read_text().split('rows,traces=read_log(',1)[0],namespace)
decode=namespace['decode'];rows,traces=namespace['read_log'](out/'novel/stderr.log')
assert rows and len(traces)==len(rows)
model=None;last=None;publications=0;two_d=set();points=[]
def empty(epoch=1,gen=1,bgen=1):return {'epoch':epoch,'nextGeneration':gen,'nextBackingGeneration':bgen,'logical':0,'gpu':0,'backing':0,'poisoned':0,'contexts':{},'resources':{}}
for r in rows:
 req=bytes.fromhex(r['request']);rep=bytes.fromhex(r['response']);word=lambda off:struct.unpack_from('<I',req,off)[0];op=word(0);code=int.from_bytes(rep[:4],'little')
 if last is None or (r['usedIndex']==1 and r['state']['epoch']==1):model=empty();publications=0;two_d=set()
 elif r['usedIndex']==1:
  assert r['state']['epoch']==model['epoch']+1
  model=empty(model['epoch']+1,model['nextGeneration'],model['nextBackingGeneration']);two_d=set();publications+=1
 if r['case']=='critic-short-response':
  assert rep==b'\xa5'*24
  desc=bytes.fromhex(r['ring']['descriptors']);write_capacity=sum(struct.unpack_from('<I',desc,16*i+8)[0] for i in range(3) if struct.unpack_from('<H',desc,16*i+12)[0]&2)
  assert 1<=write_capacity<=23
  used=bytes.fromhex(r['ring']['used']);assert struct.unpack_from('<II',used,4+((r['usedIndex']-1)%16)*8)==(0,0)
 else:
  namespace['validate_record'](r)
  if code==0x1100:
   if op==0x200:
    cid=word(16);assert cid not in model['contexts'];model['contexts'][cid]={'generation':model['nextGeneration'],'name':req[32:32+word(24)].hex(),'members':{}};model['nextGeneration']+=1;publications+=1
   elif op==0x204:
    rid=word(24);meta=list(struct.unpack_from('<11I',req,24));target,fmt,bind,width,height=meta[1:6]
    assert rid not in model['resources'] and rid not in two_d and len(model['resources'])<64
    assert meta[6:]==[1,1,0,0,0] and width>0 and height>0 and word(68)==0
    assert (target==0 and fmt==64 and bind in [16,32,524288] and height==1) or (target==2 and fmt in [1,2,67] and bind&10 and bind&~(10|1<<18|1<<20)==0 and max(width,height)<=16384) or (target==2 and fmt==20 and bind in [1,8,9] and max(width,height)<=16384)
    size=width*height*4 if target==2 else width;gpu=size if bind!=524288 else 0
    assert size<=4194304 and model['gpu']+gpu<=33554432
    model['resources'][rid]={'generation':model['nextGeneration'],'metadata':meta,'backing':None,'backingGeneration':None};model['nextGeneration']+=1;publications+=1
   elif op in [0x202,0x203]:
    ctx=model['contexts'][word(16)];rid=word(24);gen=model['resources'][rid]['generation']
    if op==0x202:assert rid not in ctx['members'];ctx['members'][rid]=gen
    else:assert ctx['members'].pop(rid)==gen
    publications+=1
   elif op==0x106:
    rid=word(24);resource=model['resources'][rid];assert resource['backing'] is None
    entries=[struct.unpack_from('<QI',req,32+i*16) for i in range(word(28))];total=sum(length for addr,length in entries)
    assert total<=4194304 and total+model['backing']<=33554432 and all(0x80000000<=addr and addr+length<=0x80400000 and length>0 for addr,length in entries)
    resource['backing']=entries;resource['backingGeneration']=model['nextBackingGeneration'];model['nextBackingGeneration']+=1;publications+=1
   elif op==0x102:
    rid=word(24)
    if rid in two_d:two_d.remove(rid)
    else:
     assert model['resources'].pop(rid) is not None
     for ctx in model['contexts'].values():ctx['members'].pop(rid,None)
     publications+=1
   elif op==0x101:
    rid=word(24);assert rid not in two_d and rid not in model['resources'];two_d.add(rid)
   else:raise AssertionError(('unmodeled successful operation',hex(op)))
  else:
   label=r['case']
   assert code in [0x1201,0x1203,0x1205]
   expected=0x1201 if any(x in label for x in ['plus-one','65-refusal','host-failure']) else 0x1203 if any(x in label for x in ['collision','duplicate-live-ID']) else 0x1205
   if label=='critic-color-boundary-refusal':expected=0x1201 if (word(40),word(44))==(1024,1025) else 0x1205
   assert code==expected,(label,hex(code),hex(expected))
 resources=model['resources'];model['logical']=sum(a['metadata'][4]*(a['metadata'][5]*4 if a['metadata'][1]==2 else 1) for a in resources.values());model['gpu']=sum(a['metadata'][4]*(a['metadata'][5]*4 if a['metadata'][1]==2 else 1) for a in resources.values() if a['metadata'][3]!=524288);model['backing']=sum(size for a in resources.values() for addr,size in (a['backing'] or []))
 assert r['state']==model,(r['case'],r['line'],'native state deviates from independent ownership model')
 assert r['sinkEvents']==publications,(r['case'],r['line'],r['sinkEvents'],publications)
 points.append({'case':r['case'],'line':r['line'],'response':hex(code),'resources':len(resources),'sinkEvents':publications,'epoch':model['epoch'],'generation':model['nextGeneration'],'logicalBytes':model['logical'],'gpuBytes':model['gpu'],'backingBytes':model['backing'],'transportDigest':r['transportDigest']});last=r
raw=(out/'novel/stderr.log').read_bytes();counts=collections.Counter(r['case'] for r in rows)
assert counts['critic-shuffled64']==192 and counts['critic-independent65-refusal']==3 and counts['critic-short-response']==23 and counts['critic-positive-color']==36 and counts['critic-positive-depth']==3
assert '2 passed; 0 failed; 0 ignored' in (out/'novel/stdout.log').read_text()
assert counts['critic-create-host-failure']==3 and counts['critic-unref-host-failure']==3 and counts['critic-reset-retains-selected']==3
report={'schema':'desktop-control-critic-novel-audit-v1','records':len(rows),'guestInstructions':len(traces),'fullSequentialStateModelHeld':True,'stderrSha256':hashlib.sha256(raw).hexdigest(),'cases':dict(counts),'points':points,'seeds':[0x31c7,0xb92d,0xe563],'guestExecution':False,'productionAuthority':False}
(out/'novel-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'records':len(rows),'guestInstructions':len(traces),'independentOwnershipSchedules':3,'fullSequentialStateModelHeld':True}))
