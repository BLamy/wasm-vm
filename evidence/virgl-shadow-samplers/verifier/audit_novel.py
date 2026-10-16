#!/usr/bin/env python3
"""Independently replay critic dual-view cases from original packets and uploads."""
import gzip,hashlib,json,re,struct,sys
from pathlib import Path
from audit_recording import execute,original_state,generics,wf
sha=lambda b:hashlib.sha256(b).hexdigest()
directory=Path(sys.argv[1]);raw_report=(directory/'report.json').read_bytes();report=json.loads(raw_report);assert report['status']=='passed'
assert report['browserErrors']==dict(console=[],page=[],requests=[]);e=report['browserResult']['result'];assert 'Metal' in e['gpu'] and 'M4' in e['gpu'] and not report['browser']['headless']
assert not e['guestExecution'] and not e['productionNegotiation'];fault=e['fault'];blobs={}
for ref in e['blobs']:
 zipped=(directory/ref['path']).read_bytes();raw=gzip.decompress(zipped);assert sha(zipped)==ref['gzipSha256'] and len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];blobs[ref['key']]=raw
def body(ref):
 raw=blobs[ref['key']];assert len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];return raw
citations=[];total_words=0;total_miss=0
for ref in e['runs']:
 raw=(directory/ref['path']).read_bytes();assert sha(raw)==ref['sha256'] and len(raw)==ref['bytes'];row=json.loads(raw);allocation={a['metadata']['id']:a for a in row['allocations']};inputs=[body(r) for r in row['inputs']];used_syncs=set()
 for a in row['nativeObjects']:assert a['deleted']==1
 for a in row['fenceObjects']:assert a['deleted']==1
 for side in ['renderer','resources']:assert all(v==0 for v in row['final'][side]['budgets'].values())
 for original in row['depthInputs']:
  a=allocation[original['id']];fmt=original['format'];raw=body(original['input']);assert a['metadata']['format']==fmt and a['metadata']['width']==4 and a['metadata']['height']==2
  upload=[u for u in row['uploads'] if u['name']=='texSubImage2D' and u['texture']==a['texture']];assert len(upload)==1 and body(upload[0]['bytes'])==raw;assert upload[0]['args']==[3553,0,0,0,4,2,6402,5123 if fmt==16 else 5126]
 for i,raw in enumerate(inputs):
  a=allocation[[3,4][i]];uploads=[u for u in row['uploads'] if u['name']=='bufferSubData' and u.get('buffer')==a['buffer']];assert uploads and all(body(u['bytes'])==raw for u in uploads)
 for frame in row['frames']:
  shaders,views,samplers,transfers=original_state(row['history'][:frame['historyIndex']+1]);assert shaders=={0:row['vertexText'],1:row['fragmentText']};owner=0 if row['stage']=='vertex' else 1;bindings=[{},{}]
  state=[s for s in row['shadowStates'] if s['eventSequence']<frame['completion']['sequence']][-1];native={s['name']:s for s in state['before']['samplers']};uniforms={u['name']:u for u in state['before']['uniforms']};prefix='vs' if owner==0 else 'fs'
  for slot in [1,13]:
   vw,sw=views[owner,slot],samplers[owner,slot];fmt=vw[2]&0xffffff;res=vw[1];swizzle=[vw[5]>>(3*i)&7 for i in range(4)];assert sw[1]>>15&1==1 and sw[1]>>16&7==2 and vw[4]==0
   original=next(x for x in row['depthInputs'] if x['id']==res);raw=body(original['input']);vals=list(struct.unpack('<8H' if fmt==16 else '<8f',raw));vals=[v/65535 for v in vals] if fmt==16 else vals;assert len(set(vals))==1
   bindings[owner][slot]=sw,swizzle,[dict(width=4,height=2,value=vals[0])],fmt
   transfer=next(w for w in transfers if w[0]==res);assert transfer==[res,0,0,8 if fmt==16 else 16,16 if fmt==16 else 32,0,0,0,4,2,1,0,1]
   n=native[prefix+'samp'+str(slot)];assert n['type']==35682 and n['unit']==slot+16*int(owner==0) and n['texture']==allocation[res]['texture'];p=n['parameters'];assert p['TEXTURE_COMPARE_MODE']==34894 and p['TEXTURE_MAG_FILTER']==9729 and p['TEXTURE_MIN_FILTER']==9729
   assert p['TEXTURE_COMPARE_FUNC']==(512 if frame['corrupted'] and fault=='compare' else 514)
   for semantic,values in [('mask',[int(c<4) for c in swizzle]),('add',[int(c==5) for c in swizzle])]:
    u=uniforms[prefix+'shad'+semantic+str(slot)];assert u['type']==35666 and u['size']==1
    if frame['corrupted'] and fault=='mask' and semantic=='mask':values[0]=0
    assert u['value']==values
  expected=[]
  for i in range(row['width']*row['height']):
   vi={j:list(struct.unpack_from('<4I',b,i*16)) for j,b in enumerate(inputs)};vo=execute(shaders[0],vi,bindings[0]);vdecl=generics(shaders[0],'OUT');fdecl=generics(shaders[1],'IN');fi={j:vo[next(k for k,s in vdecl.items() if s==sem)] for j,sem in fdecl.items()};expected.extend(execute(shaders[1],fi,bindings[1])[0])
  rawexpected=struct.pack('<'+'I'*len(expected),*expected);assert rawexpected==body(frame['expected']);observed=body(frame['native']);words=struct.unpack('<'+'I'*len(expected),observed);miss=[dict(word=i,expected=b,observed=a) for i,(a,b) in enumerate(zip(words,expected)) if a!=b];assert miss==frame['differences'];assert bool(miss)==frame['corrupted'];total_words+=len(expected);total_miss+=len(miss)
  sync=frame['completion']['sync'];assert sync not in used_syncs;used_syncs.add(sync);events=row['events'];writer=state['eventSequence'];create=next(e for e in events if e['name']=='fenceSync' and e['sync']==sync);wait=next(e for e in events if e['name']=='clientWaitSync' and e['sync']==sync and e['delivered'] in [37146,37148]);delete=next(e for e in events if e['name']=='deleteSync' and e['sync']==sync);read=next(e for e in row['readbacks'] if e['name']=='readPixels' and e['cpu'] and e['bytes']['sha256']==frame['native']['sha256'] and e['sequence']>delete['sequence']);assert wait['actual'] in [37146,37148] and writer<create['sequence']<=wait['sequence']<delete['sequence']<read['sequence']
  citations.append(dict(run=row['name'],record=ref['path'],recordSha256=sha((directory/ref['path']).read_bytes()),frame=frame['label'],writer=writer,sync=sync,created=create['sequence'],consumed=wait['sequence'],deleted=delete['sequence'],read=read['sequence'],expectedSha256=sha(rawexpected),nativeSha256=sha(observed),mismatches=miss))
 assert len(row['frames'])==(3 if fault else 2)
assert total_miss==({'compare':72,'mask':12}.get(fault,0))
result=dict(status='passed',fault=fault,reportSha256=sha(raw_report),frames=len(citations),words=total_words,wrongWords=total_miss,oracleImportsProduct=False,citations=citations)
Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='citations'}))
