#!/usr/bin/env python3
"""Reconstruct retained original image operations without emitted GLSL authority."""
import gzip,hashlib,json,math,re,struct,sys
from pathlib import Path
sha=lambda raw:hashlib.sha256(raw).hexdigest()
shrink=lambda n,l:max(1,n//2**l)

def immediates(text):
 result={}
 for i,kind,body in re.findall(r'^IMM\[(\d+)\] (FLT32|UINT32|INT32) \{([^}]+)\}$',text,re.M):
  vals=[float(n) if kind=='FLT32' else int(n) for n in body.split(',')]
  if kind=='FLT32':vals=list(struct.unpack('<4f',struct.pack('<4f',*vals)))
  result[int(i)]=vals
 return result

def unpack(base,result):
 blobs={}
 for row in result['blobs']:
  packed=(base/row['path']).read_bytes();assert sha(packed)==row['gzipSha256'];raw=gzip.decompress(packed);assert len(raw)==row['bytes'] and sha(raw)==row['sha256'];assert row['key'] not in blobs;blobs[row['key']]=raw
 return blobs

def original_matrix(run,frame,blobs,fault=False,retired=False):
 source=run['vertex'] if run['stage']=='vertex' else run['fragment'];imm=immediates(source)
 op,operands=re.search(r'^\d+: (TEX|TXL|TXF|TXD|TXB|TXQ) (.*)$',source,re.M).groups();assert op==run['opcode']
 index=int(re.search(r'SAMP\[(\d+)\], 2D$',operands)[1]);assert index==run['slot']
 first,last=run['range'];meta=run['source'];w,h=shrink(meta['width'],first),shrink(meta['height'],first);levels=last-first+1
 planes=[(p['width'],p['height'],blobs[p['input']['key']]) for p in run['planes'][first:last+1]]
 if frame.get('sourceClear'):
  changed=frame['sourceClear'];local=changed['level']-first;pw,ph,_=planes[local];pixel=bytes(math.floor(v*255+.5) for v in changed['values']);planes[local]=(pw,ph,pixel*(pw*ph))
 positions=struct.unpack('<24f',blobs[run['positions']['key']]);assert positions==(-1.,-1.,0.,1.,1.,-1.,0.,1.,-1.,1.,0.,1.,-1.,1.,0.,1.,1.,-1.,0.,1.,1.,1.,0.,1.)
 if '-IMM[0]' in operands:imm[0]=[-n for n in imm[0]]
 def texel(level,x,y):
  pw,ph,raw=planes[level];assert 0<=x<pw and 0<=y<ph
  result=[]
  for k,b in enumerate(raw[(y*pw+x)*4:(y*pw+x)*4+4]):
   n=max(-1,(b-256 if b>=128 else b)/127) if run['kind']=='snorm' else b/255
   if run['kind']=='srgb' and k<3:n=n/12.92 if n<=.04045 else ((n+.055)/1.055)**2.4
   result.append(n)
  return result
 def sample(level,u,v):
  pw,ph,_=planes[level];clamp=lambda n,maxn:max(0,min(maxn-1,n))
  if not run['parameters']['min']:return texel(level,clamp(math.floor(u*pw),pw),clamp(math.floor(v*ph),ph))
  px,py=u*pw-.5,v*ph-.5;x,y=math.floor(px),math.floor(py);a,b=px-x,py-y
  A,B,C,D=[texel(level,clamp(x+dx,pw),clamp(y+dy,ph)) for dx,dy in [(0,0),(1,0),(0,1),(1,1)]]
  return[(A[k]*(1-a)+B[k]*a)*(1-b)+(C[k]*(1-a)+D[k]*a)*b for k in range(4)]
 dead='/dead-query' in run['name'];dual='/two-retained-queries' in run['name'];pixels=blobs[frame['pixels']['key']];assert len(pixels)==256
 # Complete native plane custody is independent of the sample's output color.
 texels=0
 for binding in frame.get('bindings',[]):
  for plane in binding['planes']:
   original=blobs[run['planes'][plane['original']]['input']['key']];native=blobs[plane['native']['key']];assert len(native)==len(original)
   if run['kind']=='snorm':normalize=lambda b:max(-1,(b-256 if b>=128 else b)/127);assert all(normalize(a)==normalize(b) for a,b in zip(original,native))
   else:assert native==original
   texels+=plane['width']*plane['height']
 mismatch=[]
 for y in range(8):
  for x in range(8):
   if dead:
    output=[.125,.375,.625,.875]
   elif op=='TXQ':
    lod=int(imm[0][0]);assert 0<=lod<levels;output=list(imm[1]);mask=re.match(r'TEMP\[0\]\.([xyw]+),',operands)[1]
    defined=[shrink(w,lod),shrink(h,lod),None,levels]
    for lane in mask:output['xyzw'.index(lane)]=defined['xyzw'.index(lane)]
    if dual:output[3]+=run['views'][1]['last']-run['views'][1]['first']+1
    scales=next(values for i,values in imm.items() if i>1 and values==[.03125,.03125,.015625,.015625]);output=[v*s for v,s in zip(output,scales)]
   else:
    if op=='TXF':
     ix,iy,_,lod=imm[0];output=texel(int(lod),int(ix),int(iy))
    else:
     u,v,_,lod=imm[0]
     if op=='TXB':
      coords=struct.unpack('<24f',blobs[run['coordinates']['key']]);assert coords[:2]==(0.,0.) and coords[4:6]==(1.,0.) and coords[8:10]==(0.,1.)
      lod=math.log2(max(w/8,h/8))+coords[3];u,v=(x+.5)/8,(y+.5)/8
     elif op=='TXD':
      dx,dy=imm[1],imm[2];lod=math.log2(max(math.hypot(dx[0]*w,dx[1]*h),math.hypot(dy[0]*w,dy[1]*h)))
     elif op=='TEX':lod=0
     output=sample(max(0,min(levels-1,math.floor(lod+.5))),u,v)
    output=[0 if k==4 else 1 if k==5 else output[k] for k in run['swizzle']]
    if run['kind']=='snorm':output=[v*.5+.5 for v in output]
   expected=[max(0,min(255,math.floor(v*255+.5))) for v in output]
   for k,e in enumerate(expected):
    actual=pixels[(y*8+x)*4+k]
    if abs(actual-e)>2 and len(mismatch)<8:mismatch.append(dict(x=x,y=y,lane=k,expected=e,actual=actual))
 record=run['history'][frame['historyIndex']]
 if not retired:assert record['result']['ok'] and record['result']['gpuComplete']
 else:assert record['result']['ok'] or record['result']['error']['code']=='cancelled'
 assert record['hex']==frame['dump']['submissionHex'] if 'submissionHex' in frame['dump'] else True
 native=next(d for d in run['draws'] if d['label']==frame['label']);assert native['name']=='drawArrays' and native['args']==[4,0,6]
 for query in native['queries']:
  idx=int(re.search(r'(\d+)$',query['name'])[1]);count=(run.get('queryLevelCounts') or {}).get(str(idx),levels)
  assert query['type']==5124 and query['size']==1
  if not fault:assert query['value']==count
 return dict(name=run['name'],pixels=64,nativeTexels=texels,held=not mismatch,mismatches=mismatch)

def composition(run,frame,blobs):
 data={row['id']:blobs[row['bytes']['key']] for row in run['data']}
 for row in run['rawBufferReads']:assert blobs[row['bytes']['key']]==data[row['id']]
 assert {r['id'] for r in run['rawBufferReads']}==set(data)
 imm=immediates(run['fragment']);total=[0]*4
 for bank in run['banks']:
  source=data[bank['id']];words=struct.unpack_from('<4I',source,bank['offset']+3*16)
  for k in range(4):total[k]=(total[k]+2*words[k])&0xffffffff
  native=next(d for d in run['draws'] if d['label']==frame['label'])
  for block in native['blocks']:
   if block['name'] in ['VirglVSConst'+str(bank['slot']),'VirglFSConst'+str(bank['slot'])]:
    raw=blobs[block['bytes']['key']];assert raw==source and block['start']==bank['offset'] and block['length']==bank['length']
 extra=data[4];signed=struct.unpack_from('<4i',extra,0);unsigned=struct.unpack_from('<4I',extra,16)
 def packed(at,normalized):
  word=struct.unpack_from('<I',extra,at)[0];values=[]
  for k in range(4):
   bits=2 if k==3 else 10;n=(word>>(k*10))&((1<<bits)-1)
   if n&(1<<(bits-1)):n-=1<<bits
   if normalized:n=max(-1,n/((1<<(bits-1))-1))
   f32=struct.pack('<f',n);values.append(struct.unpack('<I',f32)[0])
  return values
 for contribution in [signed,unsigned,packed(32,False),packed(36,True),[4]*4]:
  total=[(a+b)&0xffffffff for a,b in zip(total,contribution)]
 shift=imm[0][0];assert shift in [0,8,16,24];color=bytes((word>>shift)&255 for word in total);expected=color*256;actual=blobs[frame['pixels']['key']];assert actual==expected
 queries=native['queries'];assert queries==[dict(name='fssamplevels3',type=5124,size=1,value=4)]
 assert run['history'][frame['historyIndex']]['result']['gpuComplete']
 return dict(pixels=256,nativeTexels=0,held=True,originalComposition=True)

def main(directory):
 directory=Path(directory).resolve();rows=[];faults=[]
 for base in sorted(directory.glob('hardware-*'))+sorted(directory.glob('fault-*')):
  record=json.loads((base/'report.json').read_text());fault=base.name.startswith('fault-');result=record.get('partial') if fault else record['browserResult']['result'];blobs=unpack(base,result)
  assert record['browserErrors']==dict(console=[],page=[],requests=[])
  if not fault:
   for run in result['runs']:
    if 'retiredExpected' not in run:continue
    original_draw=run['draws'][-1];plane=next(p for p in run['retiredPlanes'] if p['texture']==original_draw['native']['attachment']);assert plane['fencePoint']['delivered'] in [37146,37148]
    history_index=next(i for i,h in enumerate(run['history']) if h['label']==original_draw['label']);held=dict(run,name='retired-original-output')
    frame=dict(label=original_draw['label'],historyIndex=history_index,pixels=plane['pixels'],dump={})
    audit=original_matrix(held,frame,blobs,retired=True);assert audit['held'];rows.append(dict(record=base.name,retired=True,**audit))
  for frame in result['frames']:
   run=result['runs'][frame['run']]
   if 'name' not in run:
    if run.get('kind')=='query-uniform-vertex-composition':audit=composition(run,frame,blobs)
    else:audit=original_matrix(dict(run,name='retained-original-boundary'),frame,blobs)
    rows.append(dict(record=base.name,boundary=True,**audit));continue
   if fault:
    audit=original_matrix(run,frame,blobs,fault=True);assert not audit['held'] and result['sabotage']['fenceCompleted'];faults.append(dict(control=base.name,fenceCompleted=True,**audit));continue
   rows.append(dict(record=base.name,**original_matrix(run,frame,blobs)))
 assert rows and all(r['held'] for r in rows);assert len(faults)==3
 report=dict(status='passed',rows=rows,faults=faults,pixels=sum(r['pixels'] for r in rows),texels=sum(r['nativeTexels'] for r in rows),originalInputReconstruction=True)
 (directory/'physical-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ['rows','faults']}))
if __name__=='__main__':main(sys.argv[1])
