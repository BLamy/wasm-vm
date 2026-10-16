#!/usr/bin/env python3
"""Fresh critic: independent TGSI/Fraction equations over actual physical readbacks.
No worker oracle, compiled GLSL, stored expectedWord or inverse capture creates
predictions. Private MOV and untouched mask lanes preserve exact words.
"""
import argparse,hashlib,json,re,struct
from fractions import Fraction
from pathlib import Path
sha=lambda b:hashlib.sha256(b).hexdigest()
def exact(w):
 e=(w>>23)&255;assert e!=255
 sig=(w&0x7fffff)|(0x800000 if e else 0); n=Fraction(sig)*Fraction(2)**(e-150 if e else -149)
 return -n if w&0x80000000 else n
def rne(n,d):
 q,r=divmod(n,d);return q+int(2*r>d or 2*r==d and q&1)
def nearest(q):
 if not q:return 0
 sign=0x80000000 if q<0 else 0;n,d=abs(q).numerator,abs(q).denominator;e=n.bit_length()-d.bit_length()
 if Fraction(n,d)<Fraction(2)**e:e-=1
 if e< -126:return sign|rne(n<<149,d)
 shift=23-e;m=rne(n<<shift,d) if shift>=0 else rne(n,d<<-shift)
 if m==1<<24:m>>=1;e+=1
 if e>127:return sign|0x7f800000
 return sign|((e+127)<<23)|(m&0x7fffff)
def numeric(op,a,b=None):
 q=exact(a)
 if op.startswith('DIV'):assert exact(b);q/=exact(b)
 sat=op.endswith('_SAT')
 if not op.startswith('DIV'):
  result=0 if sat and q<0 else 0x3f800000 if sat and q>1 else a
  return {0,0x80000000} if sat and not exact(result) else {result}
 if not q:return {0,0x80000000}
 e=abs(q).numerator.bit_length()-abs(q).denominator.bit_length()
 if abs(q)<Fraction(2)**e:e-=1
 radius=Fraction(5,2)*Fraction(2)**(e-23);lower,upper=q-radius,q+radius
 vals=set();center=nearest(q)
 for offset in range(-10,11):
  w=(center+offset)&0xffffffff
  if (w&0x7f800000)==0x7f800000:continue
  if lower<=exact(w)<=upper:
   vals.add(0 if sat and exact(w)<0 else 0x3f800000 if sat and exact(w)>1 else w)
 if sat and any(not exact(w) for w in vals):vals|={0,0x80000000}
 assert vals,(op,hex(a),hex(b),q);return vals
swizzles='xyzw'
def execute(text,attributes,bank,backend):
 regs={('IN',i):[{w} for w in words] for i,words in attributes.items()};outputs={};active=True;conditions=[]
 def source(token):
  m=re.fullmatch(r'(-?)(IMM|TEMP|IN|CONST)\[(\d+)\](?:\.([xyzw]{4}))?',token.strip());assert m,token
  negate,file,index,sw=m.groups();index=int(index);sw=sw or swizzles
  words=[{w} for w in bank[4*index:4*index+4]] if file=='CONST' else regs[(file,index)]
  assert len(words)==4,(token,bank)
  return [{w^(0x80000000 if negate else 0) for w in words[swizzles.index(c)]} for c in sw]
 for raw in text.splitlines():
  line=re.sub(r'^\d+:\s*','',raw.strip())
  if not line or line in ['VERT','FRAG','END'] or line.startswith('DCL '):continue
  if line.startswith('IMM['):
   m=re.fullmatch(r'IMM\[(\d+)\] UINT32 \{([^}]+)\}',line);assert m,line
   regs[('IMM',int(m[1]))]=[{int(w.strip())} for w in m[2].split(',')];continue
  if line.startswith('UIF '):
   condition=source(line[4:])[0];assert len(condition)==1
   conditions.append((active,bool(next(iter(condition)))));active=active and conditions[-1][1];continue
  if line=='ELSE':active=conditions[-1][0] and not conditions[-1][1];continue
  if line=='ENDIF':active=conditions.pop()[0];continue
  if not active:continue
  op,args=line.split(' ',1);parts=[p.strip() for p in args.split(',')];dst=parts[0]
  m=re.fullmatch(r'(TEMP|OUT)\[(\d+)\](?:\.([xyzw]+))?',dst);assert m,dst
  file,index,mask=m.groups();index=int(index);mask=mask or swizzles;key=(file,index)
  # Snapshot all aliased sources before publishing any destination component.
  src=[source(p) for p in parts[1:]];prior=regs.get(key,[set() for _ in range(4)]);result=[set(w) for w in prior]
  for c in mask:
   i=swizzles.index(c);a=src[0][i]
   if op=='MOV':values=set(a)
   elif op in ['MOV_SAT','DIV','DIV_SAT']:
    values=set().union(*(numeric(op,av,bv) for av in a for bv in (src[1][i] if op.startswith('DIV') else [None])))
   elif op in ['AND','OR','USHR']:
    values={(av&bv if op=='AND' else av|bv if op=='OR' else av>>(bv&31))&0xffffffff for av in a for bv in src[1][i]}
   elif op=='UCMP':values=set().union(*(src[1][i] if av else src[2][i] for av in a))
   else:raise AssertionError('unexpected actual source opcode '+op)
   # Untyped copies in the pinned converter are numerical GLSL moves. Private
   # raw MOV remains exact; permitted numerical zero interchange is scoped here.
   if backend=='mesa' and op=='MOV' and any(w&0x7fffffff==0 for w in values):values|={0,0x80000000}
   result[i]=values
  regs[key]=result
  if file=='OUT':outputs[index]=result
 return outputs

def inspect(path):
 raw=path.read_bytes();j=json.loads(raw);a=j['acceptance'];assert j['browserErrors']=={'console':[],'page':[],'requests':[]};assert a['objects']['live']==0
 assert j['browser']['launch']['headless'] is False and j['browser']['gpu']['featureStatus'][j['browser']['webglFeature']]=='enabled';assert not re.search(r'software|swiftshader|llvmpipe|softpipe',a['renderer']['renderer'],re.I)
 summary={'path':str(path),'sha256':sha(raw),'renderer':a['renderer'],'words':0,'pixels':0,'byBackend':{},'vertices':len(a['vertices']),'fragments':len(a['fragments']),'captures':[],'sourceSequence':[],'points':[],'consumers':[]}
 expected_sources=[]
 for vi,v in enumerate(a['vertices']):
  assert v['textSha256']==sha(v['text'].encode());assert v['mutation'] is None or v['mutation']['served']==v['mutation']['original'].replace(v['mutation']['needle'],v['mutation']['replacement'],1)
  expected_sources.extend([v['mutation']['served'] if v['mutation'] else v['primary']['glsl'] if v['backend']=='mesa' else v['pair']['vertex']['glsl'],v['pair']['fragment']['glsl']])
  assert [(x['name'],x['type'],x['size']) for x in v['reflection']]==[('gl_Position',35666,1),('vso_g0',35666,1),('vso_g1',35666,1)]
  md=v['pair']['vertex']['metadata'];reflection=v['uniformReflection']
  if reflection:assert reflection['type']==36296 and 1<=reflection['count']<=reflection['declaredCount']==md['uniforms'][0]['count']
  for xi,x in enumerate(v['vectors']):
   bank=x['bankUpload']['words'] if x['bankUpload'] else [];attrs={0:x['attributeWords']}
   assert attrs[0]==[struct.unpack('<I',struct.pack('<f',w))[0] for w in x['position']]
   if v['inputSource']:attrs[1]=x['inputWords'];assert attrs[1]==x['input']['a']
   outputs=execute(v['text'],attrs,bank,v['backend']);predicted=[*outputs[0],*outputs[1],*outputs[2]];observed=list(struct.unpack('<12I',bytes(x['bytes'])))
   assert sha(bytes(x['bytes']))==x['sha256'] and observed==x['observed'];assert all(w in wanted for w,wanted in zip(observed,predicted)),(path,vi,xi,v['op'],v['variant'],x['input']['name'],observed,predicted)
   reconstructed=[((observed[8+i]&511)<<23)|(observed[4+i]&0x7fffff) for i in range(4)];assert reconstructed==x['reconstructed']
   assert all(observed[4+i]==(w&0x7fffff)|0x3f000000 and observed[8+i]==(w>>23)|0x3f000000 for i,w in enumerate(reconstructed))
   if x['bankUpload']:
    u=x['bankUpload'];assert u['observedA']==bank[:4]==x['input']['a'];assert bank[180:184]==x['input']['b'] and bank[172]==x['condition'];assert all(w==0xdeadbeef for w in u['callerAfter'])
    if u['observedB'] is not None:assert u['observedB']==bank[180:184]
    if u['observedCondition'] is not None:assert u['observedCondition'][0]==x['condition']
   summary['words']+=12;summary['byBackend'].setdefault(v['backend'],{'words':0,'pixels':0})['words']+=12
   if vi<4 or v.get('capture'):summary['points'].append({'vertex':vi,'vector':xi,'sha256':x['sha256'],'observed':observed,'reconstructed':reconstructed})
  if v.get('capture'):summary['captures'].append({'vertex':vi,'backend':v['backend'],**v['capture']})
 for fi,f in enumerate(a['fragments']):
  assert sha(f['text'].encode())==f['textSha256'];expected_sources.extend([f['pair']['vertex']['glsl'],f['primary']['glsl'] if f['backend']=='mesa' else f['pair']['fragment']['glsl']])
  predicted=execute(f['text'],{},[],f['backend'])[0];expected=[{255 if exact(w)!=0 else 0 for w in ws} for ws in predicted]
  b=bytes(f['rgbaBytes']);assert len(b)==64 and sha(b)==f['sha256'];assert all(w in expected[i%4] for i,w in enumerate(b)),(path,fi,f['op'],f['plane'],b,expected)
  summary['pixels']+=16;summary['byBackend'].setdefault(f['backend'],{'words':0,'pixels':0})['pixels']+=16
 for ci,c in enumerate(a['consumers']):
  assert len(c['captures'])==6;assert all(x==0 for x in c['finalBudgets'].values()) and all(x==0 for x in c['finalResourceBudgets'].values());assert len(c['submissions'])==5
  assert all(all(b==255 for b in s['after']) for s in c['submissions']);assert all(s['result']['ok'] is True for s in c['submissions'][:-1]);assert c['rejection']['before']==c['rejection']['after'];assert c['rejection']['result']['ok'] is False and c['rejection']['result']['appliedCommands']==0
  snapshots=[]
  for cap in c['captures']:
   banks=cap['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants'];assert len(banks)==2 and banks[0]==banks[1] and len(banks[0])==184;snapshots.append(banks[0])
   assert cap['native'];assert all(u['words']==banks[0][4*u['index']:4*u['index']+4] for u in cap['native']);assert {u['name'] for u in cap['native']}=={'vsconst0','fsconst0'}
  assert snapshots[0]==snapshots[1]==snapshots[4]==snapshots[5] and snapshots[2]==snapshots[3] and snapshots[0]!=snapshots[2]
  summary['consumers'].append({'index':ci,'op':c['op'],'asynchronous':c['asynchronous'],'captureUniformCounts':[len(cap['native']) for cap in c['captures']],'A':snapshots[0][:4],'B':snapshots[2][:4],'disposed':True})
  state=c['captures'][0]['snapshot']['contexts'][0]['subContexts'][0]
  # Physical consumer shader sources are separately bound by recorded events;
  # retain the exact remaining sequence rather than assume it from snapshots.
 sources=[e['source'] for e in a['events'] if e['call']=='shaderSource'];assert sources[:len(expected_sources)]==expected_sources
 tail=sources[len(expected_sources):];assert len(tail)==8
 for c,vs,fs in zip(a['consumers'],tail[::2],tail[1::2]):assert 'raw_saturate' in vs and 'raw_saturate' in fs
 assert all(e['status'] is True for e in a['events'] if e['call'] in ['compileShader','linkProgram'])
 summary['sourceSequence']={'probeShaders':len(expected_sources),'consumerShaders':len(tail),'sha256':sha(json.dumps(sources,separators=(',',':')).encode())}
 assert j['status']==a['status']=='passed';assert summary['words']==a['checkedWords'] and summary['pixels']==a['checkedPixels'];return summary

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--report',required=True,type=Path);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
 result={'schema':'virgl-saturation-critic-capture-guards-v1','task':'E6-T12g6h','status':'running','testSha256':sha(Path(__file__).read_bytes()),'reportSha256':sha(args.report.read_bytes())}
 try:result['physical']=inspect(args.report.resolve());result['status']='passed'
 except Exception as error:result['status']='failed';result['failure']={'message':str(error)};raise
 finally:args.output.write_text(json.dumps(result,indent=2)+'\n')
 print(result['physical']['words'],'physical words and',result['physical']['pixels'],'pixels independently verified from actual TGSI')
if __name__=='__main__':main()
