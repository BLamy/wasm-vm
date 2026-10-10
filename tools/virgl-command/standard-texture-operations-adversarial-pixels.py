#!/usr/bin/env python3
"""Independent reconstruction of original combined TXF/TXQ retained-view proof."""
import gzip,hashlib,json,re,struct,sys
from pathlib import Path
sha=lambda b:hashlib.sha256(b).hexdigest()
def read_blobs(base,result):
 values={}
 for row in result['blobs']:
  compressed=(base/row['path']).read_bytes();assert sha(compressed)==row['gzipSha256']
  raw=gzip.decompress(compressed);assert len(raw)==row['bytes'] and sha(raw)==row['sha256'] and row['key'] not in values
  values[row['key']]=raw
 return values
def plane_source(run,which,values):
 source=run if which=='original' else run['replacement'];metadata=run['source'] if which=='original' else source['metadata']
 backing=values[source['backing']['key']];planes=[]
 for level,p in enumerate(source['planes']):
  w=max(1,metadata['width']>>level);h=max(1,metadata['height']>>level);assert p['level']==level and (p['width'],p['height'])==(w,h)
  raw=values[p['input']['key']];assert len(raw)==w*h*4
  for y in range(h):assert backing[p['offset']+y*p['stride']:p['offset']+y*p['stride']+w*4]==raw[y*w*4:(y+1)*w*4]
  planes.append((w,h,raw))
 return metadata,planes
def generated_plane(width,height,level,state):
 # The independent seed check consumes the exact original xorshift32 input stream.
 output=[]
 for i in range(width*height*4):
  state^=(state<<13)&0xffffffff;state^=state>>17;state^=(state<<5)&0xffffffff;state&=0xffffffff
  output.append((state+i*37+level*71)&255)
 return bytes(output),state
def audit(directory):
 directory=Path(directory).resolve();rows=[];controls=[];reports=[]
 for base in sorted(directory.glob('novel-seed-*'))+sorted(directory.glob('fault-query-levels')):
  capture=json.loads((base/'report.json').read_text());fault=base.name.startswith('fault-');assert capture['status']==('failed' if fault else 'passed')
  assert capture['browserErrors']==dict(console=[],page=[],requests=[])
  result=capture['partial'] if fault else capture['browserResult']['result'];values=read_blobs(base,result)
  assert 'M4' in result['gpu'] and 'Metal' in result['gpu'] and not capture['browser']['headless']
  for run in result['runs']:
   for which in ['original']+(['replacement'] if 'replacement' in run else []):
    metadata,planes=plane_source(run,which,values);seed=run['seed'] if which=='original' else run['seed']^0x8c174e31
    for level,(w,h,raw) in enumerate(planes):expected,seed=generated_plane(w,h,level,seed);assert raw==expected
   text=run['vertex'] if run['stage']=='vertex' else run['fragment']
   assert re.findall(r'^\d+: (TXF|TXQ) ([^\n]+)',text,re.M)==[('TXF','TEMP[0], IMM[0], SAMP[11], 2D'),('TXQ','TEMP[1].w, IMM[1], SAMP[11], 2D')]
   assert 'IMM[0] INT32 {1,0,0,1}' in text and 'IMM[1] INT32 {0,0,0,0}' in text and 'IMM[2] FLT32 {0.0625,0.0625,0.0625,0.0625}' in text
   assert all(o['deleted']==1 for o in run['nativeObjects']) and all(v==0 for v in run['final']['resources']['budgets'].values()) and all(v==0 for v in run['final']['renderer']['budgets'].values())
  for frame_index,frame in enumerate(result['frames']):
   run=result['runs'][frame['run']];metadata,planes=plane_source(run,frame['source'],values);first,last=frame['range'];levels=last-first+1
   w,h,plane=planes[first+1];assert w>1 and h>0;texel=list(plane[4:8]);color=[0 if k==4 else 255 if k==5 else texel[k] for k in run['swizzle']];color[3]=(levels*255+8)//16
   actual=values[frame['pixels']['key']];assert len(actual)==256;mismatches=[dict(byte=i,expected=color[i%4],observed=v) for i,v in enumerate(actual) if abs(v-color[i%4])>1]
   native=next(d for d in run['draws'] if d['label']==frame['label']);queries=native['queries'];name=('vs' if run['stage']=='vertex' else 'fs')+'samplevels11'
   assert queries==[dict(name=name,type=5124,size=1,value=levels+(1 if fault else 0))]
   record=run['history'][frame['historyIndex']];assert record['label']==frame['label'] and record['result']['ok'] and record['result']['gpuComplete'];assert record['hex']==frame['dump']['submissions'][0]['hex']
   fence=next(e for e in reversed(run['events']) if e.get('label')==frame['label'] and e['name']=='clientWaitSync' and e['delivered'] in [37146,37148]);assert fence['actual'] in [37146,37148]
   native_texels=0
   assert len(frame['bindings'])==levels
   for local,binding in enumerate(frame['bindings']):
    pw,ph,raw=planes[first+local];assert (binding['local'],binding['original'],binding['width'],binding['height'])==(local,first+local,pw,ph);assert values[binding['bytes']['key']]==raw;native_texels+=pw*ph
   point=dict(record=base.name,run=frame['run'],frame=frame_index,label=frame['label'],range=frame['range'],source=frame['source'],stage=run['stage'],predicted=color,held=not mismatches,pixels=64,nativeTexels=native_texels,nativeQueries=queries,fence=fence,mismatches=mismatches[:8])
   if fault:assert mismatches and result['sabotage']['fenceCompleted'] and run['faultEvents'];controls.append(point)
   else:assert not mismatches;rows.append(point)
  if not fault:
   assert len(result['runs'])==4 and len(result['frames'])==20
   for i,run in enumerate(result['runs']):
    f=[x for x in result['frames'] if x['run']==i];assert [x['source'] for x in f]==['original']*4+['replacement'];assert [x['range'] for x in f]==[[1,4]]*4+[[0,1]]
    assert f[1]['cache']['work']['programLinks']==f[0]['cache']['work']['programLinks'];assert run['replacement']['generation']>run['sourceGeneration']
  else:assert len(controls)==1 and 'independent original retained fetch/query pixels at completed native fence' in capture['browserResult']['error']['message']
  reports.append(dict(path=base.name,sha256=sha((base/'report.json').read_bytes()),sourceHead=capture['gitHead'],sourceDigests=capture['sources'],served=capture['servedFiles']))
 assert len(rows)==40 and len(controls)==1
 summary=dict(status='passed',originalInputOnly=True,workerOracleImported=False,pixels=sum(r['pixels'] for r in rows),nativeTexels=sum(r['nativeTexels'] for r in rows),rows=rows,controls=controls,reports=reports)
 (directory/'independent-pixels.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({k:v for k,v in summary.items() if k not in ['rows','controls','reports']}))
if __name__=='__main__':audit(sys.argv[1])
