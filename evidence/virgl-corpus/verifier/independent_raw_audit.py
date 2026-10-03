from pathlib import Path
from collections import Counter,defaultdict
import json,gzip,hashlib,re,struct
R=Path(__file__).resolve().parents[3]
BASE=R/'evidence/virgl-corpus/captures'
def h(b): return hashlib.sha256(b).hexdigest()
def jd(b):
 def u(pairs):
  d={}
  for k,v in pairs:
   assert k not in d,('duplicate',k)
   d[k]=v
  return d
 return json.loads(b,object_pairs_hook=u)
p=(R/'renderer/virgl-shader/vendor/src/virgl_protocol.h').read_text()
def enum(n,prefix):
 section=p.split('enum '+n+' {')[1].split('};')[0]
 section=re.sub(r'/\*.*?\*/','',section,flags=re.S)
 out={}; value=0
 for part in section.split(','):
  part=part.strip()
  if not part: continue
  if '=' in part:
   name, val=part.split('='); value=int(val.strip()); name=name.strip()
  else: name=part
  if name.startswith(prefix): out[value]=name[len(prefix):]
  value+=1
 return out
OP=enum('virgl_context_cmd','VIRGL_CCMD_'); OB=enum('virgl_object_type','VIRGL_OBJECT_')
ST=['VERT','FRAG','GEOM','TESS_CTRL','TESS_EVAL','COMP']
reports={}
for name in ['textured-scene','kmscube','glmark2-es2','compositor']:
 d=BASE/name; mb=(d/'manifest.json').read_bytes(); m=jd(mb); s=jd((d/'summary.json').read_bytes())
 checked_art=[]
 for f in [m['events']]+m['artifacts']:
  b=(d/f['path']).read_bytes(); assert len(b)==f['bytes'] and h(b)==f['sha256'],f
  checked_art.append(f['path'])
 assert s['manifestSha256']==h(mb)
 eb=(d/'events.jsonl').read_bytes(); assert eb.endswith(b'\n'); ev=[jd(l) for l in eb.splitlines()]
 assert [e['seq'] for e in ev]==list(range(1,len(ev)+1))
 assert ev[0]['type']=='begin' and ev[-1]['type']=='end' and ev[-1]['complete'] and ev[-1]['normalExit']
 assert ev[-1]['openCalls']==ev[-1]['droppedRecords']==0
 blobs={}; refs=Counter(); firsts={}; api=Counter(); results=Counter(); op=Counter(); objects=Counter(); shaderops=Counter(); submissions=[]; subctx={}; pending={}; shaders={}; resources=[]; capsets=[]
 stacks=defaultdict(list); active={}; backing={}; snap={}; fence_ids=set(); complete_fences=set(); matched=0; contexts={}; commands_by_ctx=defaultdict(Counter); shapes=Counter()
 for e in ev:
  n=e['seq']; typ=e['type']; data={}
  firsts.setdefault(typ,n)
  for ref in e['blobs']:
   dg=ref['sha256']; fp=d/'blobs'/f'{dg}.bin.gz'; raw=d/'blobs'/f'{dg}.bin'
   assert fp.exists()!=raw.exists()
   if dg not in blobs:
    blobs[dg]=gzip.decompress(fp.read_bytes()) if fp.exists() else raw.read_bytes()
   b=blobs[dg]; assert h(b)==dg and len(b)==ref['bytes']; assert ref['role'] not in data
   data[ref['role']]=b; refs[ref['role']]+=1
  if typ=='backing_snapshot':
   assert sum(e['iovLengths'])==len(data['backing'])
   if e['reason']=='submit':
    assert e['resourceId'] not in snap
    snap[e['resourceId']]=e['iovLengths']
   else:
    owners=[c for c in active.values() if c.get('resourceId')==e['resourceId']]
    assert len(owners)==1,(n,typ,owners)
    owners[0].setdefault('_snapshots',{})[e['reason']]=e['iovLengths']
  elif e.get('phase')=='enter':
   thread=e['threadId']; st=stacks[thread]; assert e['parentCallSeq']==(st[-1] if st else 0),(n,st)
   st.append(n); active[n]=dict(e); api[typ]+=1
   if typ=='submit_cmd':
    assert snap=={rid:v for rid,v in backing.items() if v},(n,'backing')
    snap={}; b=data['command']; assert len(b)==4*e['ndw']; words=struct.unpack('<%dI'%(len(b)//4),b); i=0; nc=0
    while i<len(words):
     header=words[i]; code=header&255; obj=(header>>8)&255; nwords=header>>16; end=i+1+nwords
     assert code in OP and obj in OB and end<=len(words),(name,n,i,code,obj,nwords)
     cmd=OP[code]; op[cmd]+=1; firsts.setdefault('opcode:'+cmd,[n,4*i,h(b)]); nc+=1; commands_by_ctx[e['ctxId']][cmd]+=1
     w=words[i:end]
     if cmd=='SET_SUB_CTX': assert len(w)==2; subctx[e['ctxId']]=w[1]
     if cmd=='CREATE_OBJECT':
      objects[OB[obj]]+=1; firsts.setdefault('object:'+OB[obj],[n,4*i,h(b)])
      if obj==4:
       assert len(w)>=7
       handle,stage,offlen,tokens,so=w[1:6]; so=0 if stage==5 else so
       key=(e['ctxId'],subctx.get(e['ctxId'],0),stage); cont=bool(offlen>>31); val=offlen&0x7fffffff
       start=6+(4+2*so if so else 0); frag=b[(i+start)*4:end*4]; shapes[(stage,so,cont)]+=1
       if not cont:
        assert key not in pending; pending[key]={'handle':handle,'length':val,'tokens':tokens,'so':so,'data':bytearray(),'packets':[]}
       sh=pending[key]
       if cont: assert val==len(sh['data']) and handle==sh['handle'] and tokens==sh['tokens'] and so==0
       sh['data'].extend(frag); sh['packets'].append({'event':n,'byteOffset':i*4,'fragmentBytes':len(frag),'continuation':cont})
       full=sh['data']; assert len(full)<=((sh['length']+3)//4)*4
       if len(full)==((sh['length']+3)//4)*4:
        text=bytes(full[:sh['length']-1]); assert full[sh['length']-1]==0 and b'\0' not in text; txt=text.decode('ascii'); assert txt.splitlines()[0]==ST[stage]
        # Literal opcode token immediately following instruction-number colon.
        ins=Counter(line.split(':',1)[1].strip().split()[0] for line in txt.splitlines() if re.match(r'^\s*[0-9]+:',line))
        assert ins['END']; dg=h(text); assert (d/'shaders'/f'{dg}.tgsi').read_bytes()==text
        occ={'context':key[0],'subcontext':key[1],'stage':ST[stage],'handle':handle,'declaredBytes':sh['length'],'declaredTokens':tokens,'streamoutOutputs':sh['so'],'packets':sh['packets']}
        if dg not in shaders:
         shaders[dg]={'stage':ST[stage],'instructions':dict(ins),'bytes':len(text),'occurrences':[]}; shaderops.update(ins)
        shaders[dg]['occurrences'].append(occ); del pending[key]
     i=end
    assert i==len(words)
    submissions.append({'event':n,'context':e['ctxId'],'bytes':len(b),'sha256':h(b),'commands':nc})
   elif typ=='create_fence': fence_ids.add(e['fenceId'])
   elif typ=='write_fence': assert e['fenceId'] in fence_ids; complete_fences.add(e['fenceId'])
   elif typ=='context_create': contexts[e['ctxId']]=data['context_name'].decode(errors='replace')
  elif e.get('phase')=='return':
   c=active.pop(e['callSeq']); assert c['type']==typ and c['threadId']==e['threadId'] and c['parentCallSeq']==e['parentCallSeq']
   assert stacks[e['threadId']].pop()==e['callSeq']; assert e['result']==0; matched+=1; results[f'{typ}:{e["result"]}']+=1
   if typ=='resource_create':
    backing[c['resourceId']]=c.get('_snapshots',{}).get('create',[]); assert len(backing[c['resourceId']])==c['iovCount']
    fields=['resourceId','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags']; resources.append({'event':c['seq'],**{k:c[k] for k in fields}})
   elif typ=='resource_attach_iov':
    backing[c['resourceId']]=c.get('_snapshots',{}).get('attach',[]); assert len(backing[c['resourceId']])==c['iovCount']
   elif typ=='resource_detach_iov': backing[c['resourceId']]=[]
   elif typ=='resource_unref': del backing[c['resourceId']]
   elif typ in ['cleanup','reset']: backing={}
   elif typ=='fill_caps': capsets.append({'event':n,'set':c['set'],'version':c['version'],'bytes':len(data['capset']),'sha256':h(data['capset'])})
  else: assert typ in ['begin','end'],e
 assert not active and not pending and not snap and all(not st for st in stacks.values())
 assert set(p.name.split('.')[0] for p in (d/'blobs').iterdir())==set(blobs)
 assert sum(len(b) for b in blobs.values())==ev[-1]['blobBytes']
 computed={'events':len(ev),'blobs':len(blobs),'blobBytes':sum(map(len,blobs.values())),'apiCalls':dict(api),'apiResults':dict(results),'opcodes':dict(op),'objects':dict(objects),'shaderInstructions':dict(shaderops),'submissions':submissions,'shaders':shaders,'resourceCreates':resources,'resourceFormats':dict(Counter(str(x['format']) for x in resources)),'capsets':capsets,'shaderStageCounts':dict(Counter(x['stage'] for x in shaders.values()))}
 for k,v in computed.items(): assert s[k]==v,(name,k,'summary mismatch')
 assert set(x.name for x in (d/'shaders').iterdir())=={dg+'.tgsi' for dg in shaders}
 serial=(d/'guest-serial.log').read_text().splitlines(); markers=[]
 for marker in [f'VIRGL_CORPUS_BEGIN {name}',f'VIRGL_CORPUS_END {name} status=0']:
  assert serial.count(marker)==1; markers.append(serial.index(marker)+1)
 assert markers[0]<markers[1]; assert (d/'guest-exit-code.txt').read_text().strip()=='0'
 pkg=(d/'guest-packages.txt').read_text().splitlines(); assert 'mesa 1:26.2.2-1' in pkg and 'hyprland 0.56.2-3' in pkg
 logs=['workload.log']+(['hyprland.log'] if name in ['glmark2-es2','compositor'] else [])
 relevant=[]
 for lf in logs:
  for lineno,line in enumerate((d/lf).read_text().splitlines(),1):
   if re.search(r'GL_RENDERER|Renderer:|renderer:|PIXELS_PASS|SCENE_END|Rendered \d+|Validation:',line): relevant.append([lf,lineno,line])
 assert any(re.search(r'(?i)(?:GL_RENDERER|renderer)\s*[:=]\s*"?virgl\b',line) for lf,ln,line in relevant if lf==('hyprland.log' if name=='compositor' else 'workload.log'))
 for src in ['recorder.c','recorder.build.sh','capture.py']:
  assert (d/'payload'/src).read_bytes()==(R/'tools/virgl-capture'/src).read_bytes()
 build=jd((d/'payload/workloads-build-manifest.json').read_bytes())
 binary={'textured-scene':'bin/virgl-textured-scene','kmscube':'bin/kmscube','glmark2-es2':'usr/bin/glmark2-es2-wayland'}.get(name)
 if binary: assert h((d/'payload'/Path(binary).name).read_bytes())==build['binaries'][binary]
 report={'manifestSha256':h(mb),'eventsSha256':h(eb),'events':len(ev),'apiPairs':matched,'blobs':len(blobs),'blobBytes':computed['blobBytes'],'referencedBlobRoles':dict(refs),'submissions':len(submissions),'commands':sum(op.values()),'opcodes':dict(sorted(op.items())),'objects':dict(sorted(objects.items())),'shaders':len(shaders),'shaderBytes':sum(x['bytes'] for x in shaders.values()),'shaderInstructions':dict(sorted(shaderops.items())),'shaderStages':computed['shaderStageCounts'],'shaderShapes':{str(k):v for k,v in shapes.items()},'contexts':contexts,'commandsByContext':{k:dict(v) for k,v in commands_by_ctx.items()},'resourceFormats':computed['resourceFormats'],'fencesCreated':len(fence_ids),'fencesCompleted':len(complete_fences),'firsts':firsts,'guestMarkerLines':markers,'versionsLines':{'mesa':pkg.index('mesa 1:26.2.2-1')+1,'hyprland':pkg.index('hyprland 0.56.2-3')+1},'workloadMarkers':relevant,'allSummaryFieldsRecomputed':list(computed),'artifactsHashed':len(checked_art),'footer':ev[-1]}
 reports[name]=report
print(json.dumps(reports,indent=2,sort_keys=True))
