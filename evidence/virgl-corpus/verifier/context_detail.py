from pathlib import Path
from collections import Counter,defaultdict
import json,gzip,struct,hashlib
base=Path(__file__).resolve().parents[1]/'captures'
for name in ['textured-scene','kmscube','glmark2-es2','compositor']:
 d=base/name; ev=[json.loads(x) for x in (d/'events.jsonl').read_text().splitlines()]; sub={}; bound={}; ctxnames={}; draws=defaultdict(list); special=[]; shader_map={}; summary=json.loads((d/'summary.json').read_text())
 for dg,sh in summary['shaders'].items():
  for occ in sh['occurrences']: shader_map[(occ['context'],occ['subcontext'],occ['handle'])]=(dg,sh['stage'])
 for e in ev:
  if e['type']=='context_create' and e['phase']=='enter':
   b=gzip.decompress((d/'blobs'/(e['blobs'][0]['sha256']+'.bin.gz')).read_bytes()); ctxnames[e['ctxId']]=b.decode(); special.append({'event':e['seq'],'contextCreate':e['ctxId'],'contextName':b.decode(),'sha256':e['blobs'][0]['sha256']})
  if e['type']!='submit_cmd' or e['phase']!='enter': continue
  dg=e['blobs'][0]['sha256']; b=gzip.decompress((d/'blobs'/(dg+'.bin.gz')).read_bytes()); w=struct.unpack('<%dI'%(len(b)//4),b); ctx=e['ctxId']; i=0
  while i<len(w):
   cmd=w[i]&255; length=w[i]>>16
   if cmd==28: sub[ctx]=w[i+1]
   sc=sub.get(ctx,0)
   if cmd==31: bound[(ctx,sc,w[i+2])]=w[i+1]
   if cmd==8:
    bindings={str(stage):{'handle':bound.get((ctx,sc,stage)),'shader':shader_map.get((ctx,sc,bound.get((ctx,sc,stage))))} for stage in [0,1]}
    draws[ctx].append({'event':e['seq'],'offset':i*4,'commandBlob':dg,'drawWords':w[i:i+length+1],'bindings':bindings})
   i+=length+1
 own=7 if name=='glmark2-es2' else 5 if name=='compositor' else 2
 shader_ctx=defaultdict(set)
 for dg,sh in summary['shaders'].items():
  for occ in sh['occurrences']:shader_ctx[occ['context']].add(dg)
 report={'workload':name,'contextCreate':special,'drawsByContext':{ctx:len(v) for ctx,v in draws.items()},'ownFirstDraw':draws[own][0],'ownLastDraw':draws[own][-1],'shaderDigestSetsByContext':{ctx:sorted(v) for ctx,v in shader_ctx.items()},'ownDrawEvents':dict(Counter(x['event'] for x in draws[own]))}
 if name=='glmark2-es2':
  report['ownShaders']={dg:summary['shaders'][dg] for dg in sorted(shader_ctx[own])}
 print(json.dumps(report,sort_keys=True))
