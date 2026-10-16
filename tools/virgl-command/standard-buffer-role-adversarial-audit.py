#!/usr/bin/env python3
"""Original packets and retained bytes determine expectations; observations never do."""
import gzip,hashlib,json,math,re,struct,subprocess,sys
from pathlib import Path
from standard_buffer_role_literal_model import model,packets,fw,uw
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'evidence/virgl-standard-buffer-roles/verifier';sha=lambda b:hashlib.sha256(b).hexdigest()
summary={'schema':'fresh-d18-original-byte-audit-v1','status':'running','runs':[],'frames':0,'pixels':0,'nativeDraws':0,'privateDraws':0,'guestBlocks':0,'gpuBytes':0}
HINTS=[0,16,32,48,64,80,96,112]
def audit(directory,label):
 report=json.loads((directory/'report.json').read_bytes());fault=bool(report.get('fault'));result=report.get('partial') if report['status']=='failed' else report['browserResult']['result'];cache={};blobs={r['key']:r for r in result['blobs']};rows=[]
 def raw(ref):
  assert ref is not None
  if ref['key'] not in cache:
   row=blobs[ref['key']];z=(directory/row['path']).read_bytes();data=gzip.decompress(z)
   assert sha(z)==row['gzipSha256'] and sha(data)==row['sha256']==ref['sha256'] and len(data)==row['bytes']==ref['bytes'];cache[ref['key']]=data
  return cache[ref['key']]
 for ordinal,f in enumerate(result['frames']):
  uploads={};byId={}
  for created in f['created']:
   m=created['metadata'];g=created['generation'];assert all(m[k]==v for k,v in {'depth':1,'arraySize':1,'lastLevel':0,'nrSamples':0,'flags':0}.items())
   if m['target']==0:assert m['format']==64 and m['height']==1 and m['bind'] in HINTS
   else:assert m['target']==2 and m['format']==67 and m['bind']==2
   uploads[g]=bytearray(m['width']*(1 if m['target']==0 else m['height']*4));byId[m['id']]=g
  for transfer in f['inputs']:
   data=raw(transfer['blob']);layout=transfer['layout'];assert layout['rowCount']==1 and layout['rowBytes']==len(data);assert layout['offset']+len(data)<=len(uploads[transfer['resource']['generation']]);at=layout['offset'];uploads[transfer['resource']['generation']][at:at+len(data)]=data
  for write in f.get('gpuWrites',[]):
   assert write['beforeSubmission']<len(f['history']);data=raw(write['source']);at=write['offset'];assert at+len(data)<=len(uploads[write['generation']]);uploads[write['generation']][at:at+len(data)]=data
  s=model(f,uploads);fields=s['fields'];ids=s['indices'];indexed=bool(fields[3]);assembled=f['assembly'] and fields[2] in [2,6];restart=bool(fields[7]);marker=fields[8]
  nativeWords=[]
  if assembled:
   segments=[[]]
   for index in ids:
    if restart and index==marker:segments.append([])
    else:segments[-1].append(index)
   for seg in segments:
    if fields[2]==2 and len(seg)>=2:
     for i,index in enumerate(seg):nativeWords.extend([index,seg[(i+1)%len(seg)]])
    if fields[2]==6:
     for i in range(1,len(seg)-1):nativeWords.extend([seg[0],seg[i],seg[i+1]])
  else:nativeWords=[0xffffffff if restart and n==marker else n for n in ids]
  nativeIndexed=indexed or assembled;nativeMode=(1 if fields[2]==2 else 4) if assembled else fields[2];instances=max(1,fields[4]);nativeCount=len(nativeWords) if assembled else fields[1]
  draw=f['dump']['draws'][-1]['command'];program=f['dump']['programs'][-1]
  assert [program['vertexTGSI'],program['fragmentTGSI']]==s['shaders']
  requested={'vertexText':s['shaders'][0],'fragmentText':s['shaders'][1],'signedMask':0,'unsignedMask':0,'packedSignedMask':0,'packedNormalizedMask':0,'bufferZeroMask':s['zeroMask']}
  for n,e in enumerate(s['elements']):
   if e['format']==200:requested['signedMask']|=1<<n
   if e['format']==196:requested['unsignedMask']|=1<<n
   if e['format'] in [172,173]:requested['packedSignedMask']|=1<<n
   if e['format']==173:requested['packedNormalizedMask']|=1<<n
  if not fault:
   paired=[q for run in result['runs'] for q in run.get('requests',[]) if q['request']==requested]
   assert paired and any(q['result']['vertex']['glsl']==program['vertexESSL300'] and q['result']['fragment']['glsl']==program['fragmentESSL300'] for q in paired),(label,f['label'],'literal original request/actual native C output')
  assert [draw['normalizedIndices'],draw['nativeIndexSize'],draw['nativeIndexOffset'],draw['normalizedIndexBytes']]==[nativeIndexed,4 if nativeIndexed else 0,0,len(nativeWords)*4 if nativeIndexed else 0]
  if indexed:
   i=s['index'];assert [draw['indexResourceId'],draw['indexResourceGeneration'],draw['indexOffset'],draw['indexByteLength']]==[i['id'],i['generation'],i['offset'],fields[1]*i['size']]
   assert i['offset']+fields[1]*i['size']<=len(uploads[i['generation']])
  assert f['history'][-1]['result']['gpuComplete'] is True and f['native']
  calls=[call for run in result['runs'] for call in run['calls'] if call['label']==f['label']]
  if not fault:
   assert len(calls)==len(f['native'])
   for call in calls:
    for a in call['attributes']:
     if a['location']<0:continue
     ix=int(a['name'].split('_')[1]);e=s['elements'][ix];buf=s['buffers'][e['buffer']]
     assert a['divisor']==(min(e['divisor'],65536) if buf['stride'] else 0)
     if a['enabled']:assert [a['stride'],a['offset'],a['components']]==[buf['stride'],buf['offset']+e['offset'],e['format']-27 if e['format'] in [28,29,30,31] else 4]
  sourceDifferences=indexDifferences=0;nativeIds=[]
  for native in f['native']:
   assert native['name']==('drawElements' if nativeIndexed else 'drawArrays')+('Instanced' if instances>1 else '')
   assert native['args']==([nativeMode,nativeCount,5125,0]+([instances] if instances>1 else []) if nativeIndexed else [nativeMode,fields[0],nativeCount]+([instances] if instances>1 else []))
   assert {r['stage']:r['glsl'] for r in native['shaders']}=={35633:program['vertexESSL300'],35632:program['fragmentESSL300']}
   sysblock=[b for b in native['blocks'] if b['name']=='VirglBlock'];assert len(sysblock)==1;b=sysblock[0];expected=bytearray(656);struct.pack_into('<I',expected,640,fw(1));assert raw(b['storage'])==expected
   assert [b['binding'],b['bytes'],b['vertex'],b['fragment']]==[0,656,True,False]
   assert [[m[k] for k in ['name','type','count','offset','stride']] for m in b['members']]==[['clipp[0]',35666,8,0,16],['stipple_pattern[0]',5125,32,128,16],['winsys_adjust_y',5126,1,640,0],['alpha_ref_val',5126,1,644,0],['clip_plane_enabled',35670,1,648,0],['drawid_base',5124,1,652,0]]
   for block in native['blocks']:
    if block is b:continue
    match=re.fullmatch(r'Virgl(VS|FS)Const(\d+)',block['name']);assert match;stage=0 if match[1]=='VS' else 1;slot=int(match[2]);bank=s['banks'][stage][slot];vectors=s['declared'][stage][slot]
    assert [block['binding'],block['bytes'],block['start'],block['length'],block['resourceId'],block['generation'],block['vertex'],block['fragment']]==[1+stage*13+slot,vectors*16,bank['offset'],bank['length'],bank['id'],bank['generation'],stage==0,stage==1]
    assert [[m[k] for k in ['name','type','count','offset','stride','blockIndex']] for m in block['members']]==[[('vs' if stage==0 else 'fs')+'const'+str(slot)+'[0]',36296,vectors,0,16,block['index']]]
    data=raw(block['storage']);sourceDifferences+=data!=uploads[bank['generation']];summary['gpuBytes']+=len(data);summary['guestBlocks']+=1
   for a in native['attributes']:
    ix=int(a['name'].split('_')[1]);e=s['elements'][ix];buf=s['buffers'][e['buffer']];assert a['enabled']==(buf['stride']!=0)
    assert a['shaderType']==(35669 if e['format']==200 else 36296 if e['format']==196 else 35666)
    assert a['integer']==(e['format'] in [196,200] and a['enabled'])
    if a['enabled']:
     assert [a['resourceId'],a['generation'],a['stride'],a['offset']]==[buf['id'],buf['generation'],buf['stride'],buf['offset']+e['offset']]
     assert a['type']=={28:5126,29:5126,30:5126,31:5126,196:5125,200:5124,172:36255,173:36255}[e['format']]
     data=raw(a['storage']);sourceDifferences+=data!=uploads[buf['generation']];summary['gpuBytes']+=len(data)
   if nativeIndexed:
    p=native['privateIndex'];assert p['originalResource'] is None;data=raw(p['storage']);expected=struct.pack('<'+'I'*len(nativeWords),*nativeWords)
    assert p['bytes']==len(data)==len(expected);indexDifferences+=data!=expected;nativeIds.append(p['nativeId']);summary['privateDraws']+=1
   else:assert native['privateIndex'] is None
  pixels=raw(f['pixels']);assert len(pixels)==f['width']*f['height']*4
  misses=None
  if not f['assembly']:
   assert f['expected']==s['expected'];misses=sum(v!=s['expected'][i%4] for i,v in enumerate(pixels));assert (misses>0)==fault,(label,f['label'],misses)
  if not fault:assert sourceDifferences==indexDifferences==0,(label,f['label'],sourceDifferences,indexDifferences)
  else:
   assert 'independent original buffer pixels after completed fence' in report['browserResult']['error']['message']
   if report['fault']=='source-word':assert sourceDifferences>0 and indexDifferences==0
   if report['fault']=='private-index':assert indexDifferences>0
  rows.append({'record':directory.as_posix()+'/report.json','jsonPoint':'/'+('partial' if fault else 'browserResult/result')+'/frames/'+str(ordinal),'label':f['label'],'literalIndices':ids,'privateWords':nativeWords if nativeIndexed else None,'nativeIds':nativeIds,'pixelSha256':sha(pixels),'pixels':len(pixels)//4,'expected':s.get('expected'),'sourceDifferences':sourceDifferences,'indexDifferences':indexDifferences,'pixelMismatches':misses})
  summary['frames']+=1;summary['pixels']+=len(pixels)//4;summary['nativeDraws']+=len(f['native'])
 for run in result['runs']:
  for owner in ['renderer','resources']:assert all(v==0 for v in run['final'][owner]['budgets'].values())
  assert run['final']['uniformAccess']['pending']==run['final']['uniformAccess']['submitted']==0
  assert all(row['deleted']==1 for row in run['privateBuffers'])
  assert all(row['sourceClass']==row['destinationClass']=='other' for row in run['classEvents'])
  for call in run['calls']:
   for a in call['attributes']:
    if a['location']>=0:assert a['divisor']>=0
 for n,suspension in enumerate(result['suspensions']):
  if 'action' not in suspension:continue
  healthy=suspension['action'] in ['unref-reuse','detach','backing'];record=suspension['record'];jobs=suspension['point']['before']['jobs']
  assert jobs['status']==suspension['phase'] and jobs['uniformPending']==2 and jobs['draws']==0
  assert record['result']['ok']==healthy and len(record['result']['draws'])==(1 if healthy else 0)
  run=next(r for r in result['runs'] if any(h['label']==record['label'] for h in r['history']));assert len([call for call in run['calls'] if call['label']==record['label']])==(1 if healthy else 0)
 for ownership in result['ownership']:
  if ownership['kind']=='three-private-streams':assert [ownership['point']['jobs'][k] for k in ['status','normalizedBuffers','normalizedBytes','draws','uniformHolds']]==['finishing',3,36,3,1]
  elif ownership['kind']=='renderer-disposal':assert ownership['point']['jobs']['normalizedBuffers']==1 and ownership['point']['jobs']['normalizedBytes']==12
 # Authenticate every captured native blob even if an unreferenced report field exists.
 for row in result['blobs']:raw(row)
 summary['runs'].append({'label':label,'reportSha256':sha((directory/'report.json').read_bytes()),'frames':rows,'runs':len(result['runs']),'suspensions':len(result['suspensions']),'allBlobs':len(cache)})
 print(label,'frames',len(rows),'pixels',sum(r['pixels'] for r in rows),'held')
if __name__=='__main__':
 OUT=Path(sys.argv[1]).resolve()
 for directory in sorted(OUT.glob('gpu-*')):audit(directory,directory.name)
 for name in ['sabotage-source-word','sabotage-private-index']:audit(OUT/name,name)
 summary['status']='passed';(OUT/'adversarial-audit.json').write_text(json.dumps(summary,indent=2)+'\n')
