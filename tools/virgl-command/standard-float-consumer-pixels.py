#!/usr/bin/env python3
"""Independent complete original packet/TGSI/finite-plane inverse."""
import gzip,hashlib,json,math,re,struct,sys
from pathlib import Path
sha=lambda b:hashlib.sha256(b).hexdigest()
FORMATS={**{91+i:(16,i+1)for i in range(4)},**{28+i:(32,i+1)for i in range(4)}}
shrink=lambda n,l:max(1,n//2**l)
f32=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
def immediates(text):
 result={}
 for i,kind,body in re.findall(r'^IMM\[(\d+)\] (FLT32|UINT32|INT32) \{([^}]+)\}$',text,re.M):result[int(i)]=[f32(float(n))if kind=='FLT32'else int(n)for n in body.split(',')]
 return result

def unpack(base,result):
 blobs={}
 for row in result['blobs']:
  packed=(base/row['path']).read_bytes();assert sha(packed)==row['gzipSha256'];raw=gzip.decompress(packed);assert len(raw)==row['bytes']and sha(raw)==row['sha256'];assert row['key']not in blobs;blobs[row['key']]=raw
 return blobs

def values(raw,fmt):
 bits,components=FORMATS[fmt];unit=bits//8;assert len(raw)%(unit*components)==0
 words=struct.unpack('<'+('e'if bits==16 else'f')*(len(raw)//unit),raw)
 return [list(words[i:i+components])+([0.]*(3-components)+[1.]if components<4 else[])for i in range(0,len(words),components)]

def original_color(run,blobs,frame):
 text=run[run['stage']];imm=immediates(text);op,args=re.search(r'^\d+: (TEX|TXL|TXF|TXD|TXB|TXQ) (.*)$',text,re.M).groups();assert op==run['opcode'];assert int(re.search(r'SAMP\[(\d+)\], 2D$',args)[1])==run['slot']
 first,last=run['range'];levels=last-first+1;source=run['source'];w,h=shrink(source['width'],first),shrink(source['height'],first)
 planes=[(p['width'],p['height'],values(blobs[p['input']['key']],source['format']))for p in run['planes'][first:last+1]]
 if frame.get('sourceClear'):
  change=frame['sourceClear'];local=change['level']-first;pw,ph,_=planes[local];color=stored(change['values'],source['format']);planes[local]=(pw,ph,[color]*(pw*ph))
 if op=='TXQ':assert re.match(r'TEMP\[0\]\.xyw, IMM\[1\]',args);lod=imm[1][0];assert 'U2F TEMP[0], TEMP[0]'in text;return[shrink(w,lod),shrink(h,lod),0,levels]
 def texel(l,x,y):
  pw,ph,data=planes[l];assert 0<=x<pw and 0<=y<ph;return data[y*pw+x]
 def sample(l,u,v,linear):
  pw,ph,_=planes[l];clamp=lambda n,maxn:max(0,min(maxn-1,n))
  if not linear:return texel(l,clamp(math.floor(u*pw),pw),clamp(math.floor(v*ph),ph))
  px,py=u*pw-.5,v*ph-.5;x,y=math.floor(px),math.floor(py);a,b=px-x,py-y
  A,B,C,D=[texel(l,clamp(x+dx,pw),clamp(y+dy,ph))for dx,dy in[(0,0),(1,0),(0,1),(1,1)]]
  return[(A[k]*(1-a)+B[k]*a)*(1-b)+(C[k]*(1-a)+D[k]*a)*b for k in range(4)]
 if op=='TXF':ix,iy,_,lod=imm[1];color=texel(lod,ix,iy)
 else:
  u,v,_,lod=imm[0]
  if op in['TEX','TXB']:lod=0
  elif op=='TXD':dx,dy=imm[2],imm[3];lod=math.log2(max(math.hypot(dx[0]*w,dx[1]*h),math.hypot(dy[0]*w,dy[1]*h)))
  parameters=run['parameters'];lod=max(parameters['minLod'],min(parameters['maxLod'],lod));filter=parameters['mag']if lod<=0 else parameters['min']
  if lod<=0 or parameters['mip']==2:color=sample(0,u,v,filter)
  elif parameters['mip']==0:color=sample(max(0,min(levels-1,math.floor(lod+.5))),u,v,filter)
  else:
   lod=max(0,min(levels-1,lod));a=math.floor(lod);b=min(levels-1,a+1);f=lod-a;A,B=sample(a,u,v,filter),sample(b,u,v,filter);color=[n*(1-f)+B[k]*f for k,n in enumerate(A)]
 return[0 if k==4 else 1 if k==5 else color[k]for k in run['swizzle']]

def stored(color,fmt):
 precision,count=FORMATS[fmt];code='e'if precision==16 else'f';return[struct.unpack('<'+code,struct.pack('<'+code,color[k]))[0]if k<count else 1. if k==3 else 0.0 for k in range(4)]

def audit_frame(run,frame,blobs,fault=False):
 fmt=run['target']['format'];width,height=run['width'],run['height'];components=width*height*4;color=run['clearColor']if frame['kind']=='clear'else original_color(run,blobs,frame);previous=frame['previous']or[0]*4
 if frame['kind']!='clear':color=[n+(previous[k]if frame['blend']else 0)if frame['mask']&(1<<k)else previous[k]for k,n in enumerate(color)]
 expected=stored(color,fmt);raw=blobs[frame['pixels']['key']];assert len(raw)==components*4;actual=struct.unpack('<'+'f'*components,raw);mismatch=[]
 for i,value in enumerate(actual):
  e=expected[i%4];budget=2e-6*max(1,abs(e))
  if(not math.isfinite(value)or abs(value-e)>budget)and len(mismatch)<8:mismatch.append(dict(at=i,expected=e,actual=value,budget=budget))
 record=run['history'][frame['historyIndex']];assert record['label']==frame['label'];assert(record['result']['ok']and record['result']['gpuComplete'])or(frame.get('retired')and record['result']['error']['code']=='cancelled');assert any(e['name']=='clientWaitSync'and e['label']==frame['label']and e['delivered']in[37146,37148]for e in run['events'])
 assert struct.unpack('<24f',blobs[run['positions']['key']])==(-1.,-1.,0.,1.,1.,-1.,0.,1.,1.,1.,0.,1.,-1.,-1.,0.,1.,1.,1.,0.,1.,-1.,1.,0.,1.)
 if fault:return dict(held=not mismatch,components=components,mismatches=mismatch)
 assert not mismatch,(run['name'],frame['label'],mismatch)
 if frame.get('boundary'):
  if frame.get('sourceClear'):assert blobs[run['backingAfter']['key']]==blobs[run['backing']['key']]
  return dict(held=True,components=components,nativeComponents=0,publicBytes=0,paddingBytes=0)
 assert len(frame['outputs'])==run['target']['lastLevel']+1
 for plane in frame['outputs']:
  data=struct.unpack('<'+'f'*(plane['width']*plane['height']*4),blobs[plane['native']['key']]);assert plane['width']==shrink(run['target']['width'],plane['level'])and plane['height']==shrink(run['target']['height'],plane['level'])
  if plane['level']==run['outputLevel']:assert data==actual
  else:assert list(data)==[0,0,0,1 if FORMATS[fmt][1]<4 else 0]*(plane['width']*plane['height'])
 native_count=0
 for binding in frame['bindings']:
  assert binding['range']==run['range'];assert len(binding['planes'])==run['range'][1]-run['range'][0]+1
  for plane in binding['planes']:
   p=run['planes'][plane['original']];original=values(blobs[p['input']['key']],run['source']['format']);native=struct.unpack('<'+'f'*(p['width']*p['height']*4),blobs[plane['native']['key']]);assert list(native)==[n for color in original for n in color];native_count+=len(native)
 if frame['kind']!='clear':
  native=next(row for row in run['draws']if row['label']==frame['label']);assert native['name']=='drawArrays'and native['args']==[4,0,6];assert native['native']['level']==run['outputLevel'];assert native['native']['viewport']==[0,0,width,height]
  for query in native['queries']:assert query['type']==5124 and query['size']==1 and query['value']==run['range'][1]-run['range'][0]+1
 read=run['history'][frame['publicHistory']];assert read['result']['ok']and read['result']['gpuComplete'];packet=bytes.fromhex(read['hex']);words=struct.unpack('<14I',packet);bits,count=FORMATS[fmt];row_bytes=width*count*bits//8;stride=row_bytes+3;assert words==(43|13<<16,1,run['outputLevel'],0,stride,0,0,0,0,width,height,1,5,2)
 exchange=next(e for e in run['exchanges']if e['label']==read['label']and e['direction']=='readback');public=blobs[exchange['blob']['key']];code='e'if bits==16 else'f';expected_public=b''.join(struct.pack('<'+code,actual[i*4+k])for i in range(width*height)for k in range(count));assert public==expected_public
 backing=blobs[frame['outputBacking']['key']];owned=set()
 for row in range(height):a=5+row*stride;assert backing[a:a+row_bytes]==public[row*row_bytes:(row+1)*row_bytes];owned.update(range(a,a+row_bytes))
 assert all(value==0x2e for i,value in enumerate(backing)if i not in owned)
 return dict(held=True,components=components,nativeComponents=native_count,publicBytes=len(public),paddingBytes=len(backing)-len(owned))

def main(directory):
 directory=Path(directory).resolve();rows=[];faults=[]
 for base in sorted(directory.glob('hardware-*'))+sorted(directory.glob('fault-*')):
  record=json.loads((base/'report.json').read_text());fault=base.name.startswith('fault-');result=record.get('partial')if fault else record['browserResult']['result'];blobs=unpack(base,result);assert record['browserErrors']==dict(console=[],page=[],requests=[])
  for frame in result['frames']:
   run=result['runs'][frame['run']];audit=audit_frame(run,frame,blobs,fault)
   if fault:
    if not audit['held']:assert result['sabotage']['fenceCompleted'];faults.append(dict(control=base.name,label=frame['label'],**audit))
   else:rows.append(dict(record=base.name,label=frame['label'],**audit))
  if not fault:
   for run in result['runs']:assert all(row['deleted']==1 for row in run['nativeObjects']);assert all(n==0 for n in run['final']['resources']['budgets'].values());assert all(n==0 for n in run['final']['renderer']['budgets'].values())
 assert rows and all(row['held']for row in rows);assert {row['control']for row in faults}=={'fault-storage-precision','fault-linear-filter','fault-implicit-alpha'}
 report=dict(status='passed',rows=rows,faults=faults,originalInputReconstruction=True,**{key:sum(row.get(key,0)for row in rows)for key in['components','nativeComponents','publicBytes','paddingBytes']});(directory/'physical-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k not in['rows','faults']}))
if __name__=='__main__':main(sys.argv[1])
