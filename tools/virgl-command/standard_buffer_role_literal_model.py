#!/usr/bin/env python3
"""Independent original-packet interpreter and actual native range/full-pixel oracle."""
from pathlib import Path
import json,hashlib,gzip,struct,re,math,copy,subprocess
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
fw=lambda x:struct.unpack('<I',struct.pack('<f',x))[0]
fl=lambda x:struct.unpack('<f',struct.pack('<I',x))[0]
uw=lambda raw:list(struct.unpack('<'+'I'*(len(raw)//4),raw))
def packets(h):
 raw=bytes.fromhex(h);at=0;rows=[]
 while at<len(raw):
  hd=struct.unpack_from('<I',raw,at)[0];end=at+4+4*(hd>>16);assert end<=len(raw);rows.append((hd&255,(hd>>8)&255,uw(raw[at+4:end]),raw[at:end]));at=end
 assert at==len(raw);return rows
def execute(text,inputs,constant):
 imm={int(n):[fw(float(v)) if typ=='FLT32' else int(v)&0xffffffff for v in values.split(',')] for n,typ,values in re.findall(r'^IMM\[(\d+)\] (UINT32|FLT32) \{([^}]+)\}',text,re.M)};temps={};out={};addr=0
 def src(o):
  m=re.fullmatch(r'CONST\[(\d+)\]\[(.+)\]',o)
  if m:
   rr=re.fullmatch(r'ADDR\[0\]\.x(?: ([+-]\d+))?',m[2]);return constant(int(m[1]),addr+int(rr[1] or '0') if rr else int(m[2]))
  m=re.fullmatch(r'(IN|IMM|TEMP|OUT)\[(\d+)\](?:\.([xyzw]{4}))?',o);assert m,o
  a={'IN':inputs,'IMM':imm,'TEMP':temps,'OUT':out}[m[1]][int(m[2])];return [a['xyzw'.index(c)] for c in m[3]] if m[3] else list(a)
 for op,args in re.findall(r'^\d+: (\w+)(?: ([^\n]+))?$',text,re.M):
  if op=='END':break
  dest,*sources=[s.strip() for s in args.split(',')];a=src(sources[0]);b=src(sources[1]) if len(sources)>1 else None
  if op=='ARL':assert dest=='ADDR[0].x';addr=math.floor(fl(a[0]));continue
  value=[]
  for k,x in enumerate(a):
   if op=='MOV':v=x
   elif op=='UADD':v=(x+b[k])&0xffffffff
   elif op=='USHR':v=x>>(b[k]&31)
   elif op=='AND':v=x&b[k]
   elif op=='U2F':v=fw(x)
   elif op=='MUL':v=fw(fl(x)*fl(b[k]))
   else:raise AssertionError(op)
   value.append(v)
  m=re.fullmatch(r'(TEMP|OUT)\[(\d+)\](?:\.([xyzw]+))?',dest);assert m;dst=out if m[1]=='OUT' else temps;row=dst.setdefault(int(m[2]),[0]*4)
  for c in m[3] or 'xyzw':row['xyzw'.index(c)]=value['xyzw'.index(c)]
 return out

def model(frame,uploads):
 public={};contexts={};last=None
 def fresh():return {'objects':{},'shaders':[None,None],'banks':[{},{}],'inline':[[],[]],'elements':[],'buffers':[],'index':None}
 for ordinal,submission in enumerate(frame['history']):
  for c in frame['created']:
   if c['beforeSubmission']==ordinal:public[c['metadata']['id']]=c['generation']
  ctx=contexts.setdefault(submission['ctx'],{'current':0,'subs':{0:fresh()}})
  for op,kind,f,raw in packets(submission['hex']):
   if op==29:ctx['subs'][f[0]]=fresh();continue
   if op==28:ctx['current']=f[0];continue
   if op==30:del ctx['subs'][f[0]];continue
   s=ctx['subs'][ctx['current']]
   if op==1 and kind==4:s['objects'][f[0]]={'stage':f[1],'text':raw[24:].split(b'\0')[0].decode()}
   if op==1 and kind==5:s['objects'][f[0]]={'elements':[dict(zip(['offset','divisor','buffer','format'],f[i:i+4])) for i in range(1,len(f),4)]}
   if op==2 and kind==5:s['elements']=s['objects'][f[0]]['elements']
   if op==31:s['shaders'][f[1]]=s['objects'][f[0]]['text'] if f[0] else None
   if op==6:s['buffers']=[{'stride':f[i],'offset':f[i+1],'id':f[i+2],'generation':public[f[i+2]]} for i in range(0,len(f),3)]
   if op==11:s['index']={'id':f[0],'generation':public[f[0]],'size':f[1],'offset':f[2]}
   if op==27 and f[0]<2 and f[1]<13:
    if f[4]:s['banks'][f[0]][f[1]]={'id':f[4],'generation':public[f[4]],'offset':f[2],'length':f[3]}
    else:s['banks'][f[0]].pop(f[1],None)
   if op==12 and f[0]<2:
    s['banks'][f[0]].pop(f[1],None)
    if f[1]==0:s['inline'][f[0]]=f[2:]
   if op==8:last=copy.deepcopy(s);last['fields']=f
 assert last is not None
 s=last;s['declared']=[{int(a):int(b)+1 for a,b in re.findall(r'^DCL CONST\[(\d+)\]\[0\.\.(\d+)\]',t,re.M)} for t in s['shaders']];s['zeroMask']=sum(1<<st for st in [0,1] if 0 in s['banks'][st] and 0 in s['declared'][st])
 def constant(st):
  def get(slot,i):
   assert slot in s['declared'][st] and 0<=i<s['declared'][st][slot];bank=s['banks'][st].get(slot)
   if bank:
    assert (i+1)*16<=bank['length'];return uw(uploads[bank['generation']][bank['offset']+i*16:bank['offset']+(i+1)*16])
   assert slot==0;return s['inline'][st][i*4:i*4+4]
  return get
 def attrs(index):
  rows=[]
  for e in s['elements']:
   buf=s['buffers'][e['buffer']];raw=uploads[buf['generation']];at=buf['offset']+e['offset']+(buf['stride']*index if buf['stride'] else 0)
   if e['format'] in [31,196,200]:rows.append(uw(raw[at:at+16]));continue
   assert e['format'] in [172,173];n=struct.unpack_from('<I',raw,at)[0];r=[]
   for k in range(4):
    w=2 if k==3 else 10;v=(n>>(k*10))&((1<<w)-1);v=v-(1<<w) if v&(1<<(w-1)) else v;r.append(fw(v if e['format']==172 else max(-1,v/((1<<(w-1))-1))))
   rows.append(r)
  return rows
 f=s['fields']
 if f[3]:
  i=s['index'];raw=uploads[i['generation']];indices=[int.from_bytes(raw[i['offset']+(f[0]+k)*i['size']:i['offset']+(f[0]+k+1)*i['size']],'little') for k in range(f[1])]
 else:indices=list(range(f[0],f[0]+f[1]))
 s['indices']=indices
 if frame.get('assembly'):return s
 assert sorted(indices)==[0,1,2] and f[2]==4 and f[4]==1
 outputs=[execute(s['shaders'][0],attrs(i),constant(0)) for i in indices];assert sorted(tuple(fl(x) for x in o[0]) for o in outputs)==sorted([(-1,-1,0,1),(3,-1,0,1),(-1,3,0,1)])
 assert all(o.get(1)==outputs[0].get(1) for o in outputs);frag=execute(s['shaders'][1],{0:outputs[0].get(1)},constant(1));s['expected']=[math.floor(max(0,min(1,fl(x)))*255+.5) for x in frag[0]];return s

