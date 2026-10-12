#!/usr/bin/env python3
"""Independent original-word interpreter and native-binding/fence critic.

No runtime module or worker oracle is imported. Accepted point instructions are
interpreted as original TGSI word operations, using the uploaded originals and
retained sampler/view packets. ESSL is used only for source custody, never pixels.
"""
import gzip, hashlib, json, math, re, struct
from pathlib import Path
OUT=Path(__file__).resolve().parent
REC=OUT/'unpacked/current'
sha=lambda b:hashlib.sha256(b).hexdigest()
wf=lambda w:struct.unpack('<f',struct.pack('<I',w&0xffffffff))[0]
fw=lambda f:struct.unpack('<I',struct.pack('<f',f))[0]
lanes='xyzw'

def packets(raw):
 at=0
 while at<len(raw):
  head=struct.unpack_from('<I',raw,at)[0];n=head>>16;end=at+4*(n+1);assert end<=len(raw)
  yield head&255,head>>8&255,list(struct.unpack_from('<'+'I'*n,raw,at+4)),raw[at:end]
  at=end
 assert at==len(raw)

def original_state(history):
 objects={};bound={10:{},18:{}};shaders={};transfers=[]
 for h in history:
  for op,kind,w,b in packets(bytes.fromhex(h['hex'])):
   if op==1 and kind in (6,7):objects[kind,w[0]]=w
   elif op==3 and kind in (6,7):objects.pop((kind,w[0]),None)
   elif op==1 and kind==4:
    assert b[24+w[2]-1]==0;objects[kind,w[0]]=(w[1],b[24:24+w[2]-1].decode('ascii'))
   elif op==31 and w[0]:shaders[w[1]]=objects[4,w[0]][1]
   elif op in bound:
    for i,handle in enumerate(w[2:]):bound[op][w[0],w[1]+i]=objects[(6 if op==10 else 7),handle] if handle else None
   elif op==43:transfers.append(w)
 return shaders,bound[10],bound[18],transfers

def compare(fn,r,d):
 return bool((False,r<d,r==d,r<=d,r>d,r!=d,r>=d,True)[fn])

def execute(text,inputs,bindings):
 regs={('IN',i):v for i,v in inputs.items()}
 for m in re.finditer(r'^IMM\[(\d+)\] (FLT32|UINT32|INT32) \{([^}]+)\}',text,re.M):
  regs['IMM',int(m[1])]=[fw(float(x)) if m[2]=='FLT32' else int(x.strip())&0xffffffff for x in m[3].split(',')]
 def src(s):
  neg=s.startswith('-');s=s.removeprefix('-');abs_=s.startswith('|')
  if abs_:assert s.endswith('|');s=s[1:-1]
  m=re.fullmatch(r'(IN|OUT|TEMP|IMM)\[(\d+)\](?:\.([xyzw]{4}))?',s);assert m,s
  result=[regs[m[1],int(m[2])][lanes.index(c)] for c in m[3] or lanes]
  return [(x&0x7fffffff if abs_ else x)^(0x80000000 if neg else 0) for x in result]
 for line in text.splitlines():
  m=re.fullmatch(r'\d+: (\w+)(?: (.*))?',line)
  if not m or m[1]=='END':continue
  op=m[1];args=m[2].split(', ');dest=re.fullmatch(r'(OUT|TEMP)\[(\d+)\](?:\.([xyzw]+))?',args[0]);assert dest,args[0]
  if op=='MOV':v=src(args[1])
  elif op=='XOR':v=[a^b for a,b in zip(src(args[1]),src(args[2]))]
  elif op=='ADD':v=[fw(wf(a)+wf(b)) for a,b in zip(src(args[1]),src(args[2]))]
  else:
   assert op in ('TEX','TXL','TXD','TXP','TXB','TXQ') and args[-1] in ('SHADOW2D','2D'),line
   slot=int(re.fullmatch(r'SAMP\[(\d+)\]',args[-2])[1]);sampler,swizzle,depth,fmt=bindings[slot];coord=[wf(x) for x in src(args[1])]
   if op=='TXQ':
    assert src(args[1])==[0,0,0,0];v=[depth[0]['width'],depth[0]['height'],0,len(depth)]
   else:
    if op=='TXP':assert coord[3]!=0;coord=[c/coord[3] for c in coord[:3]]+[coord[3]]
    lod=0
    if op=='TXL':lod=coord[3]
    elif op=='TXD':
     dx,dy=([wf(x) for x in src(a)] for a in args[2:4]);rho=max(math.hypot(dx[0]*depth[0]['width'],dx[1]*depth[0]['height']),math.hypot(dy[0]*depth[0]['width'],dy[1]*depth[0]['height']));lod=math.log2(rho) if rho else -math.inf
    else:assert len({d['value'] for d in depth})==1,'implicit LOD requires all accessible original levels equivalent'
    lod=min(wf(sampler[4]),max(wf(sampler[3]),lod));level=min(len(depth)-1,max(0,math.floor(lod+.5)));z=depth[level]['value']
    if fmt in (196,200):assert args[-1]=='2D';v=[0 if c==4 else 1 if c==5 else z[c] for c in swizzle]
    elif args[-1]=='2D':v=[fw(0 if c==4 else 1 if c==5 else (z,0,0,1)[c]) for c in swizzle]
    else:
     ref=coord[2]
     if fmt in (16,20,21):ref=min(1,max(0,ref));z=min(1,max(0,z))
     bit=int(compare((sampler[1]>>16)&7,ref,z));v=[fw(0 if c==4 else 1 if c==5 else bit) for c in swizzle]
  key=dest[1],int(dest[2]);old=regs.get(key,[0,0,0,0]).copy()
  for c in dest[3] or lanes:old[lanes.index(c)]=v[lanes.index(c)]
  regs[key]=old
 return {i:v for (kind,i),v in regs.items() if kind=='OUT'}

def generics(text,direction):return {int(m[1]):int(m[2]) for m in re.finditer(r'^DCL '+direction+r'\[(\d+)\], GENERIC\[(\d+)\]',text,re.M)}

def audit(directory):
 report_bytes=(directory/'report.json').read_bytes();report=json.loads(report_bytes);fault=report.get('fault')
 assert report['task']=='E6-T11d49' and report['status']==('failed' if fault else 'passed')
 assert report['browserErrors']==dict(console=[],page=[],requests=[])
 evidence=report.get('partial') or report['browserResult']['result'];assert 'Metal' in evidence['gpu'] and 'M4' in evidence['gpu']
 assert not report['browser']['headless'] and not evidence['guestExecution'] and not evidence['productionNegotiation']
 assert not any(re.search('swiftshader|llvmpipe|lavapipe|softpipe|--disable-gpu',a,re.I) for a in report['browser']['commandLine'])
 blobs={}
 for ref in evidence['blobs']:
  zipped=(directory/ref['path']).read_bytes();raw=gzip.decompress(zipped);assert sha(zipped)==ref['gzipSha256'] and sha(raw)==ref['sha256'] and len(raw)==ref['bytes'];assert ref['key'] not in blobs;blobs[ref['key']]=raw
 def body(ref):
  raw=blobs[ref['key']];assert len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];return raw
 result=dict(status='passed',record=directory.relative_to(REC).as_posix(),reportSha256=sha(report_bytes),runs=[],frames=0,words=0,refusals=0,functions=set(),formats=set(),defaults=0)
 for ref in evidence['runs']:
  if 'path' in ref:
   raw=(directory/ref['path']).read_bytes();assert sha(raw)==ref['sha256'] and len(raw)==ref['bytes'];r=json.loads(raw)
  else:r=ref;raw=json.dumps(r).encode()
  citation=dict(name=r['name'],record=ref.get('path'),recordSha256=sha(raw),frames=[])
  assert all(o['deleted']==1 for o in r['nativeObjects']) and all(s['deleted']==1 for s in r['fenceObjects'])
  for side in ('renderer','resources'):assert all(x==0 for x in r['final'][side]['budgets'].values())
  if 'shadowStates' not in r:result['runs'].append(citation);continue
  for u in r['uploads']+r['readbacks']:
   if u.get('bytes'):body(u['bytes'])
  for frame in r['frames']:
   shader,views,samplers,transfers=original_state(r['history'][:frame['historyIndex']+1]);assert shader=={0:r['vertexText'],1:r['fragmentText']}
   srcmeta=r['source']['metadata'];source_texture=next(a['texture'] for a in r['allocations'] if a['metadata']['id']==6)
   planes={p['level']:p for p in r['planes']};fmt=srcmeta['format'];bpp=16 if fmt in (196,200) else 8 if fmt==126 else 2 if fmt==16 else 4
   backing=body(r['source']['backing']);reconstructed=bytearray([0xa7]*len(backing));depths={}
   for level,p in planes.items():
    raw=body(p['input']);assert len(raw)==p['width']*p['height']*bpp
    transfer=next(w for w in transfers if w[0]==6 and w[1]==level);assert transfer[3]==p['stride'] and transfer[8:10]==[p['width'],p['height']] and transfer[11]==p['offset']
    for y in range(p['height']):reconstructed[p['offset']+y*p['stride']:p['offset']+y*p['stride']+p['width']*bpp]=raw[y*p['width']*bpp:(y+1)*p['width']*bpp]
    native_input=raw if fmt!=21 else b''.join(struct.pack('<I',((w&0xffffff)*0xffffffff+0x7fffff)//0xffffff) for w in struct.unpack('<'+'I'*(len(raw)//4),raw))
    upload=next(u for u in r['uploads'] if u['name']=='texSubImage2D' and u.get('texture')==source_texture and u['args'][1]==level)
    if upload['bytes'] is None:
     assert fmt==126 and upload['type']=='PBO';buffer=next(a['uploadBuffer'] for a in r['allocations'] if a['metadata']['id']==6);staged=[u for u in r['uploads'] if u['name']=='bufferSubData' and u.get('buffer')==buffer and u['sequence']<upload['sequence']][-1];assert staged['sequence']+1==upload['sequence'] and body(staged['bytes'])==native_input
    else:assert body(upload['bytes'])==native_input
    values=[struct.unpack_from('<4I',raw,i*16) if fmt in (196,200) else struct.unpack_from('<H',raw,i*2)[0]/65535 if fmt==16 else ((struct.unpack_from('<I',raw,i*4)[0]>>8) if fmt==20 else struct.unpack_from('<I',raw,i*4)[0]&0xffffff)/0xffffff if fmt in (20,21) else struct.unpack_from('<f',raw,i*bpp)[0] for i in range(p['width']*p['height'])]
    assert len(set(values))==1,'constant comparison-linear tap proof';depths[level]=dict(width=p['width'],height=p['height'],value=values[0])
   assert bytes(reconstructed)==backing
   state=[s for s in r['shadowStates'] if s['eventSequence']<frame['completion']['sequence']][-1];writer=state['eventSequence'];draw=next(d for d in r['draws'] if d['sequence']==writer)
   assert state['args']==[0,0,r['width']*r['height']]
   native_uniforms={u['name']:u for u in state['before']['uniforms']};bindings=[{},{}]
   for owner in (0,1):
    for slot in {int(m[1]) for m in re.finditer(r'SAMP\[(\d+)\], (?:SHADOW2D|2D)',shader[owner])}:
     vw,sw=views[owner,slot],samplers[owner,slot];assert vw and sw;first,last=vw[4]&255,(vw[4]>>8)&255;form=vw[2]&0xffffff;swizzle=[(vw[5]>>(3*i))&7 for i in range(4)];d=[depths[i] for i in range(first,last+1)];bindings[owner][slot]=sw,swizzle,d,form
     native=next((s for s in state['before']['samplers'] if s['name']==('vs' if owner==0 else 'fs')+'samp'+str(slot)),None)
     if native is None:assert r.get('reflection')=='pruned';continue
     shadow='SAMP['+str(slot)+'], SHADOW2D' in shader[owner]
     assert native['type']==(35682 if shadow else 36306 if form==196 else 36298 if form==200 else 35678)
     assert native['unit']==slot+(16 if owner==0 else 0);params=native['parameters'];assert params['TEXTURE_COMPARE_MODE']==(34894 if sw[1]>>15&1 else 0)
     if not fault or frame is r['frames'][0]:assert params['TEXTURE_COMPARE_FUNC']==512+(sw[1]>>16&7)
     assert params['TEXTURE_MIN_LOD']==wf(sw[3]) and params['TEXTURE_MAX_LOD']==wf(sw[4]);assert native['base']==0 and native['last']==last-first
     result['functions'].add(sw[1]>>16&7);result['formats'].add(form)
     if shadow and re.search(r'^\d+: (?:TEX|TXL|TXP|TXB|TXD) .*SAMP\['+str(slot)+r'\], SHADOW2D$',shader[owner],re.M):
      for sem,values in [('mask',[int(c<4) for c in swizzle]),('add',[int(c==5) for c in swizzle])]:
       u=native_uniforms.get(('vs' if owner==0 else 'fs')+'shad'+sem+str(slot));assert u or r.get('reflection')=='pruned'
       if u:
        assert u['type']==35666 and u['size']==1
        if not fault or frame is r['frames'][0]:assert u['value']==values
   inputs=[body(ref) for ref in r['inputs']]
   for i,raw in enumerate(inputs):
    allocation=next(a for a in r['allocations'] if a['metadata']['id']==[3,4,5,7][i]);uploads=[u for u in r['uploads'] if u['name']=='bufferSubData' and u.get('buffer')==allocation['buffer']];assert uploads and all(body(u['bytes'])==raw and u['args'][1]==0 for u in uploads)
   for attr in draw['attributes']:
    i=int(attr['name'].removeprefix('in_'));allocation=next(a for a in r['allocations'] if a['metadata']['id']==[3,4,5,7][i]);assert attr['buffer']==allocation['buffer'] and attr['offset']==0 and attr['stride']==16 and not attr['integer'] and attr['divisor']==0
   expected=[]
   for pixel in range(r['width']*r['height']):
    vi={i:list(struct.unpack_from('<4I',b,pixel*16)) for i,b in enumerate(inputs)};pos=[wf(v) for v in vi[0]];assert abs((pos[0]+1)*r['width']/2-(pixel%r['width']+.5))<1e-5 and abs((pos[1]+1)*r['height']/2-(pixel//r['width']+.5))<1e-5
    vo=execute(shader[0],vi,bindings[0]);outs=generics(shader[0],'OUT');ins=generics(shader[1],'IN');fi={i:vo[next(o for o,s in outs.items() if s==semantic)] for i,semantic in ins.items()};expected.extend(execute(shader[1],fi,bindings[1])[0])
   rawexpected=struct.pack('<'+'I'*len(expected),*expected);assert rawexpected==body(r['expected']);observed=body(frame['native']);assert len(observed)==len(rawexpected);actual=struct.unpack('<'+'I'*len(expected),observed);miss=[dict(word=i,expected=b,observed=a) for i,(a,b) in enumerate(zip(actual,expected)) if a!=b]
   assert bool(miss)==bool(fault and frame is not r['frames'][0]),(r['name'],miss[:2])
   events=r['events'];sync=frame['completion']['sync'];created=next(e for e in events if e['name']=='fenceSync' and e['sync']==sync);wait=next(e for e in events if e['name']=='clientWaitSync' and e['sync']==sync and e['delivered'] in (37146,37148));deleted=next(e for e in events if e['name']=='deleteSync' and e['sync']==sync);read=next(e for e in r['readbacks'] if e['name']=='readPixels' and e['cpu'] and e['bytes']['sha256']==frame['native']['sha256'] and e['sequence']>deleted['sequence'])
   assert wait['actual'] in (37146,37148) and frame['completion']['sequence']==wait['sequence'];assert writer<created['sequence']<=wait['sequence']<deleted['sequence']<read['sequence']
   citation['frames'].append(dict(label=frame['label'],writer=writer,sync=sync,created=created['sequence'],consumed=wait['sequence'],deleted=deleted['sequence'],read=read['sequence'],expectedSha256=sha(rawexpected),nativeSha256=sha(observed),mismatches=miss))
   result['frames']+=1;result['words']+=len(expected)
   if 'same-image' in r['name']:
    ss=state['before']['samplers'];assert len(ss)==2 and ss[0]['texture']==ss[1]['texture'] and ss[0]['sampler']!=ss[1]['sampler'];assert {s['parameters']['TEXTURE_COMPARE_MODE'] for s in ss}=={0,34894}
  if not r['frames']:
   assert r.get('refused');failed=r['refused'].get('result',r['refused']);assert not failed['ok'];result['refusals']+=1
   failed_label=r['refused'].get('label');assert not any(s for s in r['shadowStates'] if failed_label and next(d for d in r['draws'] if d['sequence']==s['eventSequence'])['label']==failed_label)
  defaultcalls=[s for s in r['shadowCalls'] if s['name']=='getUniform' and s.get('result')==[0,0,0,0]];result['defaults']+=len(defaultcalls)
  citation['controlKinds']=[s['kind'] for s in r['shadowControls']];result['runs'].append(citation)
 result['functions']=sorted(result['functions']);result['formats']=sorted(result['formats'])
 return result

def main():
 results=[]
 for side in ('hot','cold'):
  for directory in sorted((REC/side).glob('hardware-*'))+sorted((REC/side).glob('fault-*')):
   results.append(audit(directory))
 summary=dict(status='passed',prediction='P02-P08/P10',records=results,totalPointFrames=sum(r['frames'] for r in results),totalPointWords=sum(r['words'] for r in results),totalNoPlaneRefusals=sum(r['refusals'] for r in results),oracleImportsProduct=False)
 (OUT/'original-word-audit.json').write_text(json.dumps(summary,indent=2)+'\n')
 print(json.dumps({k:v for k,v in summary.items() if k!='records'}))
if __name__=='__main__':main()
