from pathlib import Path
import hashlib,json,gzip,struct,subprocess
ROOT=Path(__file__).resolve().parents[3]; V=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def need(v,m):
 if not v: raise AssertionError(m)
def packets(encoded):
 data=bytes.fromhex(encoded); at=0; out=[]
 while at<len(data):
  h,=struct.unpack_from('<I',data,at); n=h>>16; end=at+4*(n+1)
  need(end<=len(data),'packet boundary')
  out.append({'op':h&255,'kind':(h>>8)&255,'offset':at,'raw':data[at:end],'w':list(struct.unpack_from('<'+'I'*n,data,at+4))}); at=end
 return out
CAP=ROOT/'evidence/virgl-workload-inventory/captures/es2gears'
sourceHead='365b3cf3d076637c347c7e9802420f847d09fbed'
def original_packet(cite):
 raw=gzip.decompress((CAP/'blobs'/(cite['blobSha256']+'.bin.gz')).read_bytes())
 need(sha(raw)==cite['blobSha256'],'original command blob digest')
 at=cite['offset']; h,=struct.unpack_from('<I',raw,at); packet=raw[at:at+4*((h>>16)+1)]
 need(sha(packet)==cite['packetSha256'],'original packet digest')
 return h&255,list(struct.unpack_from('<'+'I'*(h>>16),packet,4))
audit={'schema':1,'head':sourceHead,'status':'running','recordings':{}}
for prefix in ['hot','cold']:
 D=V/'unpacked'/prefix; r=json.loads((D/'hardware/report.json').read_text()); b=r['browserResult']['result']
 need(r['browserErrors']=={'console':[],'page':[],'requests':[]},'browser errors')
 need(len(b['frames'])==55 and all(p['held'] for p in b['predictions']),'physical predictions')
 source_pairs={}
 for name,base,stride,vc,fc in [('geometry',72,656,16,148),('c580',8,592,12,136)]:
  raw=(D/(name+'.bin')).read_bytes(); provenance=json.loads((D/(name+'.json')).read_text())
  need(sha(raw)==provenance['binarySha256'],'original generated bank custody')
  for i,p in enumerate(provenance['pairs']):
   banks=[]
   for stage,k in enumerate(['vertexSet','fragmentSet']):
    op,words=original_packet(p[k]); need(op==12 and words[:2]==[stage,0],'original bank packet')
    banks.append(words[2:])
   combined=struct.pack('<'+'I'*(vc+fc),*banks[0],*banks[1]); need(sha(combined)==p['sha256'],'original paired bank digest')
   need(combined==raw[base+i*stride:base+(i+1)*stride],'sealed original banks equal literal original packets')
   source_pairs[(name,i)]=banks
 rows=[]; fence_rows=[]; rejected=[]
 for run_index,run in enumerate(b['runs']):
  syncs={}; lastReadReady={}
  for event_index,e in enumerate(run.get('events',[])):
   cite={'record':prefix+'/hardware/report.json','run':run_index,'event':event_index,'label':e.get('label'),'turn':e['turn']}
   if e['name']=='fenceSync': syncs[e['sync']]={'issued':e['turn'],'polls':[],'ready':None}
   if e['name']=='clientWaitSync':
    owned=syncs[e['sync']]; need(e['turn']>owned['issued'],'later task fence')
    need(not owned['polls'] or owned['polls'][-1]<e['turn'],'one poll per task')
    owned['polls'].append(e['turn']); need(e['actual'] in [37146,37147,37148],'actual physical fence code')
    if e['delivered'] in [37146,37148]:
     owned['ready']=e['turn']; lastReadReady[e['label']]=e['turn']; fence_rows.append(cite)
    else: need(e['delivered']==37147,'only delayed timeout')
   if e['name']=='getBufferSubData':
    need(e['label'] in lastReadReady and lastReadReady[e['label']]<=e['turn'],'PBO extraction escaped completion fence')
  for row in run.get('history',[]):
   if not row['result']['ok']:
    need(row['result']['draws']==[],'rejected path drew'); rejected.append({'label':row['label'],'error':row['result']['error']})
 for frame_index,f in enumerate(b['frames']):
  run=next(run for run in b['runs'] if any(h['label']==f['label'] for h in run['history']))
  draw=f['dump']['draws'][-1]; ctx=draw['command']['contextId']; banks=[[],[]]; shaders={}; selected=[None,None]; boundViews=[{},{}]
  for row in f['history']:
   if row['ctx']!=ctx: continue
   need(row['result']['ok'],'frame history includes failed mutation')
   for p in packets(row['hex']):
    w=p['w']
    if p['op']==12 and w[0]<2 and w[1]==0: banks[w[0]]=w[2:]
    elif p['op']==1 and p['kind']==4:
     need(len(p['raw'])>=24+w[2] and p['raw'][24+w[2]-1]==0,'shader literal terminator')
     shaders[w[0]]={'stage':w[1],'source':p['raw'][24:24+w[2]-1]}
    elif p['op']==31: selected[w[1]]=shaders.get(w[0])
    elif p['op']==3 and p['kind']==4: shaders.pop(w[0],None)
  prog=next(p for p in f['dump']['programs'] if p['generation']==draw['programGeneration'])
  for stage,key in enumerate(['vertexTGSI','fragmentTGSI']): need(selected[stage]['source']==prog[key].encode(),'owned selected original shader source')
  for u in f['native']['uniforms']:
   need(u['activeCount']<=u['declaredCount']<=512 and u['activeCount']*4<=b['limits']['MAX_VERTEX_UNIFORM_COMPONENTS' if u['stage']==0 else 'MAX_FRAGMENT_UNIFORM_COMPONENTS'],'actual reflected host bound')
   wanted=(banks[u['stage']]+[0]*(u['activeCount']*4))[:u['activeCount']*4]
   need(wanted==u['words'],'read native raw words vs literal banks')
   uploaded=next(v for v in draw['uploads'] if v['stage']==u['stage']); need(uploaded['words']==wanted,'native planned upload vs observed')
   need(any(e['name']=='uniform4uiv' and e['label']==f['label'] and e['words']==wanted for e in run['events']),'actual uniform API call missing')
  for a in f['native']['attributes']:
   inputs=[e for e in run.get('exchanges',[]) if e['direction']=='upload' and e['resource']['id']==a['resourceId'] and e['resource']['generation']==a['generation'] and any(h['label']==e['label'] for h in f['history'])]
   need(inputs and inputs[-1]['hex']==a['hex'],'actual native vertex bytes vs owned exchange')
   fetch=next(v for v in draw['command']['vertexFetches'] if v['location']==a['location'])
   need(fetch['resourceGeneration']==a['generation'] and fetch['requiredEnd']<=len(bytes.fromhex(a['hex'])),'actual native fetch ownership/bounds')
  need(prog['reflection']['uniformBlocks']==[{'name':'VirglBlock','index':0,'byteLength':656,'binding':0,'members':[{'name':'winsys_adjust_y','offset':640,'type':5126,'value':1}]}],'system block')
  if f['label'].startswith('full-original-'):
   name='geometry' if f['fixture']['kind']=='original92' else 'c580'; i=f['fixture']['bank']; need(banks==source_pairs[(name,i)],'original banks in queued draws')
   for stage,digest in enumerate([('7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e','92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba') if name=='geometry' else ('403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c','c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f')][0]):
    need(sha(selected[stage]['source'])==digest,'complete original TGSI source')
  raw=gzip.decompress((D/'hardware'/f['pixels']['path']).read_bytes()); need(sha(raw)==f['pixels']['sha256'],'raw pixel digest')
  rows.append({'frame':frame_index,'label':f['label'],'wireSha256':sha(bytes.fromhex(f['history'][-1]['hex'])),'nativeCounts':[[u['stage'],u['declaredCount'],u['activeCount']] for u in f['native']['uniforms']],'sourceSha256':[sha(s['source']) for s in selected],'pixelSha256':sha(raw),'firstPixel':list(raw[:4])})
 need(len(fence_rows)==73,'completed actual fence count')
 need(len(rejected)==12,'structured rejected job count')
 for c in b['cancelledJobs']:
  need(c['result']['error']['code']=='cancelled' and c['result']['gpuComplete'] and len(c['result']['draws'])==1,'real drawn cancellation drained')
  need(not any(e['name']=='getBufferSubData' and e['label'].startswith('cancel-drain') for e in c['events']),'cancelled readback escaped')
 audit['recordings'][prefix]={'frames':rows,'completedFences':fence_rows,'rejectedJobs':rejected,'cancelledJobs':[{'delay':c['delay'],'result':c['result']['error'],'gpuComplete':c['result']['gpuComplete']} for c in b['cancelledJobs']]}
audit['status']='passed'; (V/'recording-audit.json').write_text(json.dumps(audit,indent=2)+'\n'); print('Literal/native custody held for 110 recorded frames, 146 completed fences and all original banks.')
