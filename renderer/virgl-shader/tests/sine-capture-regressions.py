#!/usr/bin/env python3
"""Independent critic source/capture oracle for bounded TGSI sine.

Real values use Machin's pi enclosure, rational quadrant reduction and reduced
sin/cos Taylor tails, independent of the worker's unreduced sine reference.
Only original TGSI and uploaded words determine operands; GLSL/stored oracles
and observed GPU bytes never determine expectations. Original vendor GLSL is
retained: its componentwise discrepancy is explicitly checked and reported.
"""
import argparse,hashlib,json,re,struct
from fractions import Fraction as F
from functools import lru_cache
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
LANES='xyzw';BUDGET=F(1,1<<20);EPS=F(1,1<<240)
sha=lambda b:hashlib.sha256(b).hexdigest()
def number(w):
 assert isinstance(w,int) and not isinstance(w,bool) and 0<=w<=0xffffffff
 e=(w>>23)&255;mantissa=w&0x7fffff;assert e<255,'nonfinite word'
 n=mantissa if e==0 else mantissa+2**23;p=-149 if e==0 else e-150
 x=F(n*2**p) if p>=0 else F(n,2**(-p));return -x if w>>31 else x
def pair(x):return {'n':str(x.numerator),'d':str(x.denominator)}
def unpair(x):return F(int(x['n']),int(x['d']))
def atan_inverse(n):
 total=F(0);power=F(1,n);k=0
 while True:
  term=power/(2*k+1);total+=term if k%2==0 else -term
  power/=n*n;k+=1;following=power/(2*k+1)
  if following<EPS:return tuple(sorted((total,total+(-following if k%2 else following))))
@lru_cache(None)
def pi_interval():
 a,b=atan_inverse(5),atan_inverse(239)
 lo,hi=16*a[0]-4*b[1],16*a[1]-4*b[0]
 # Round outward to a dyadic enclosure; this reduces rational work while
 # preserving the independently proven Machin interval. Tail precision is
 # 240 bits; pi uncertainty after this conservative step is <=2^-191.
 scale=1<<192
 return F((lo*scale).__floor__(),scale),F((hi*scale).__ceil__(),scale)
def small_trig(x,cosine):
 assert abs(x)<1
 term=F(1) if cosine else x;total=term;k=0
 while True:
  denom=(2*k+1)*(2*k+2) if cosine else (2*k+2)*(2*k+3)
  term=-term*x*x/denom;k+=1
  if abs(term)<EPS:return tuple(sorted((total,total+term)))
  total+=term
@lru_cache(None)
def real_sine(w):
 x=number(w);e=(w>>23)&255;assert (e!=0 or x==0) and abs(x)<=8,'bounded normal-or-zero input'
 if x==0:return F(0),F(0)
 pl,ph=pi_interval();pm=(pl+ph)/2;q=round(2*x/pm)
 yl,yh=sorted((x-q*pl/2,x-q*ph/2));mid=(yl+yh)/2;radius=(yh-yl)/2
 assert abs(mid)+radius<1,'certified reduced argument'
 lo,hi=small_trig(mid,q%2==1);lo-=radius;hi+=radius # |sin'|,|cos'| <=1
 if q%4 in (2,3):lo,hi=-hi,-lo
 return lo,hi
@lru_cache(None)
def prediction(w):
 lo,hi=real_sine(w)
 return dict(op='SIN',word=w,input=pair(number(w)),lower=pair(lo),upper=pair(hi),allowedLower=pair(hi-BUDGET),allowedUpper=pair(lo+BUDGET),strict=False,method='machin-pi-192-quadrant-reduction-rational-taylor-240')
def allowed(r,w):
 if 'exact' in r:return r['exact']==w
 try:v=number(w)
 except AssertionError:return False
 return unpair(r['allowedLower'])<=v<=unpair(r['allowedUpper'])
def error_bound(r,w):
 v=number(w);return max(abs(v-unpair(r['lower'])),abs(v-unpair(r['upper'])))
def execute(text,bank,backend):
 assert backend in ('owned','mesa');registers={('CONST',i):bank[4*i:4*i+4] for i in range(len(bank)//4)};stack=[];active=True;events=[]
 def src(token):
  m=re.fullmatch(r'(-?)(IMM|TEMP|CONST)\[(\d+)\](?:\.([xyzw]{4}))?',token.strip());assert m,token
  neg,file,index,sw=m.groups();values=registers.get((file,int(index)),[None]*4);values=[values[LANES.index(c)] for c in sw or LANES]
  if neg:values=[v^0x80000000 if isinstance(v,int) else None for v in values]
  return values
 for raw in text.splitlines():
  line=re.sub(r'^\d+:\s*','',raw.strip())
  if not line or line in ['VERT','FRAG','END'] or line.startswith('DCL '):continue
  if line.startswith('IMM['):
   m=re.fullmatch(r'IMM\[(\d+)\] UINT32 \{([^}]+)\}',line);assert m,line
   v=[int(s.strip())for s in m[2].split(',')];assert len(v)==4;registers[('IMM',int(m[1]))]=v;continue
  if line.startswith('UIF '):
   v=src(line[4:])[0];assert isinstance(v,int);stack.append((active,v!=0));active=active and v!=0;continue
  if line=='ELSE':active=stack[-1][0] and not stack[-1][1];continue
  if line=='ENDIF':active=stack.pop()[0];continue
  if line.startswith(('AND TEMP[1], TEMP[0]','USHR TEMP[1], TEMP[0]')):break
  if not active:continue
  op,args=line.split(' ',1);tokens=[v.strip()for v in args.split(',')]
  d=re.fullmatch(r'TEMP\[(\d+)\](?:\.([xyzw]+))?',tokens[0]);assert d,line
  index=int(d[1]);mask=d[2] or LANES;sources=[src(t)for t in tokens[1:]]
  if op=='MOV':out=sources[0]
  elif op=='SIN':
   assert len(sources)==1
   out=[('SIN',sources[0][i if backend=='mesa' else 0])for i in range(4)]
   for i,c in enumerate(LANES):
    if c in mask:assert isinstance(out[i][1],int),'uninitialized consumed scalar/component lane';real_sine(out[i][1])
   events.append(dict(statement=line,source=tokens[1],destination=tokens[0],inputWords=[v[1]for v in out]))
  elif op in ('AND','OR','UADD'):
   assert len(sources)==2 and all(isinstance(v,int)for s in sources for v in s)
   out=[a&b if op=='AND' else a|b if op=='OR' else (a+b)&0xffffffff for a,b in zip(*sources)]
  else:raise AssertionError('unsupported producer '+line)
  old=registers.get(('TEMP',index),[None]*4).copy()
  for c in mask:old[LANES.index(c)]=out[LANES.index(c)]
  registers[('TEMP',index)]=old
 assert not stack and ('TEMP',0)in registers
 result=registers[('TEMP',0)];assert all(v is not None for v in result)
 return [prediction(v[1]) if isinstance(v,tuple) else {'exact':v}for v in result],events
def bank(v,x=None):return ((x or v).get('bankUpload') or {}).get('words',[])
def inspect(path):
 raw=path.read_bytes();report=json.loads(raw);a=report['acceptance'];assert report['browserErrors']==dict(console=[],page=[],requests=[])
 assert not report['trackedChanges'];assert report['browser']['launch']['headless']is False and report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']]=='enabled'
 assert not re.search('software|swiftshader|llvmpipe|softpipe',a['renderer']['renderer'],re.I)
 assert a['objects']['live']==0 and a['guestExecution']is False and a['productionNegotiation']is False
 summary=dict(path=str(path),sha256=sha(raw),seed=a['seed'],renderer=a['renderer'],words=0,pixels=0,byBackend={},maximumObservedError={b:dict(value=F(0),point=None)for b in ['owned','mesa']},deviations=[],captures=[],sourceFaults=[],points=[]);sources=[];primary=[]
 def measure(backend,truth,w,point):
  assert allowed(truth,w),dict(point=point,expected=truth,observed=w)
  if 'op' not in truth:return
  error=error_bound(truth,w);assert error<=BUDGET
  if error>summary['maximumObservedError'][backend]['value']:summary['maximumObservedError'][backend]=dict(value=error,point=point)
 for vi,v in enumerate(a['vertices']):
  assert sha(v['text'].encode())==v['textSha256'];m=v['mutation'];shader=m['served'] if m else v['primary']['glsl'] if v['backend']=='mesa' else v['pair']['vertex']['glsl'];sources.extend([shader,v['pair']['fragment']['glsl']])
  if m:
   assert m['original']==v['pair']['vertex']['glsl'] and m['served']==m['original'].replace(m['needle'],m['replacement'],1);summary['sourceFaults'].append(dict(vertex=vi,**m))
  assert [(r['name'],r['type'],r['size'])for r in v['reflection']]==[('gl_Position',35666,1),('vso_g0',35666,1),('vso_g1',35666,1)]
  if v['backend']=='mesa':
   assert all(t['sourceType']==t['destinationType']==4 and t['outputMode']==2 for t in v['primary']['sineInstructions']);primary.append(dict(textSha256=v['textSha256'],glslSha256=sha(v['primary']['glsl'].encode())))
  for xi,x in enumerate(v['vectors']):
   truth,events=execute(v['text'],bank(v,x),v['backend']);b=bytes(x['bytes']);actual=list(struct.unpack('<12I',b));assert len(b)==48 and sha(b)==x['sha256'] and actual==x['observed']
   assert actual[:4]==[struct.unpack('<I',struct.pack('<f',z))[0]for z in x['position']]==x['attributeWords']
   reconstructed=[((actual[8+i]&511)<<23)|(actual[4+i]&0x7fffff) for i in range(4)];assert reconstructed==x['reconstructed']
   assert all(actual[4+i]==(w&0x7fffff)|0x3f000000 and actual[8+i]==(w>>23)|0x3f000000 for i,w in enumerate(reconstructed))
   for lane,(r,w) in enumerate(zip(truth,reconstructed)):measure(v['backend'],r,w,dict(stage='vertex',record=vi,vector=xi,lane=lane,condition=x['condition'],inputWord=r.get('word'),observedWord=w,sourceSha256=v['textSha256'],captureSha256=x['sha256']))
   # Stored expected values are audited only AFTER source-derived expectations.
   assert [(r.get('word'),r.get('exact'))for r in truth]==[(r.get('word'),r.get('exact'))for r in x['oracles']]
   if v['backend']=='mesa':
    scalar,_=execute(v['text'],bank(v,x),'owned')
    if not all(allowed(r,w)for r,w in zip(scalar,reconstructed)):summary['deviations'].append(dict(vertex=vi,vector=xi,sourceSha256=v['textSha256'],captureSha256=x['sha256'],observed=reconstructed,scalarInputs=[r.get('word')for r in scalar],componentInputs=[r.get('word')for r in truth]))
   u=x['bankUpload']
   if u:
    assert u['words'][:4]==u['observedA']==v['input']['a'] and u['words'][172]==x['condition'] and all(z==0xdeadbeef for z in u['callerAfter'])
    if u['observedB']is not None:assert u['words'][180:184]==u['observedB']==v['input']['b']
    if u['observedCondition']is not None:assert u['observedCondition'][0]==x['condition']
   assert x['checkedWords']==12;summary['words']+=12;summary['byBackend'].setdefault(v['backend'],dict(words=0,pixels=0))['words']+=12
   if vi<4 or v.get('capture'):summary['points'].append(dict(vertex=vi,vector=xi,sha256=x['sha256'],reconstructed=reconstructed,equations=events))
  if v.get('capture'):
   c=v['capture'];p=ROOT/c['path'];assert sha(p.read_bytes())==c['sha256'];literal=p.read_text().splitlines()[c['line']-1].split(':',1)[1].strip();assert literal==c['statement'] and literal in v['text']
   assert execute(v['text'],bank(v,v['vectors'][0]),'owned')[0]==execute(v['text'],bank(v,v['vectors'][0]),'mesa')[0]
   summary['captures'].append(dict(vertex=vi,backend=v['backend'],**c))
 for fi,f in enumerate(a['fragments']):
  assert sha(f['text'].encode())==f['textSha256'];sources.extend([f['pair']['vertex']['glsl'],f['primary']['glsl']if f['backend']=='mesa'else f['pair']['fragment']['glsl']])
  truth=execute(f['text'],bank(f),f['backend'])[0][f['lane']];b=bytes(f['rgbaBytes']);actual=list(struct.unpack('<16I',b));assert len(b)==64 and sha(b)==f['sha256'] and actual==f['reconstructed']
  for pixel,w in enumerate(actual):measure(f['backend'],truth,w,dict(stage='fragment',record=fi,pixel=pixel,inputWord=truth.get('word'),observedWord=w,sourceSha256=f['textSha256'],captureSha256=f['sha256']))
  assert (truth.get('word'),truth.get('exact'))==(f['oracle'].get('word'),f['oracle'].get('exact'))
  assert f['checkedPixels']==16;summary['pixels']+=16;summary['byBackend'].setdefault(f['backend'],dict(words=0,pixels=0))['pixels']+=16
 for c in a['consumers']:
  assert len(c['captures'])==6 and len(c['submissions'])==5 and all(z==0 for z in c['finalBudgets'].values()) and all(z==0 for z in c['finalResourceBudgets'].values())
  assert all(all(b==255 for b in s['after'])for s in c['submissions']);assert all(s['result']['ok']is True for s in c['submissions'][:-1]);r=c['rejection'];assert r['before']==r['after'] and r['result']['ok']is False and r['result']['appliedCommands']==0
  banks=[]
  for cap in c['captures']:
   w=cap['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants'];assert len(w)==2 and w[0]==w[1]and len(w[0])==184;banks.append(w[0]);assert cap['native']
   assert {u['name']for u in cap['native']}=={'vsconst0','fsconst0'} and all(u['words']==w[0][4*u['index']:4*u['index']+4]for u in cap['native'])
  assert banks[0]==banks[1]==banks[4]==banks[5]and banks[2]==banks[3]and banks[0]!=banks[2]
 emitted=[e['source']for e in a['events']if e['call']=='shaderSource'];assert emitted[:len(sources)]==sources,'literal shaderSource event sequence'
 tail=emitted[len(sources):];assert len(tail)==4
 for c,vs,fs in zip(a['consumers'],tail[::2],tail[1::2]):assert '/* sine:SIN */'in vs and '/* sine:SIN */'in fs and 'raw_saturate'in vs and 'raw_saturate'in fs
 assert all(e['status']is True for e in a['events']if e['call']in ('compileShader','linkProgram'))
 assert len(summary['captures'])==4 and {(c['line'],c['backend'])for c in summary['captures']}=={(l,b)for l in (76,175)for b in ('owned','mesa')}
 assert report['status']==a['status']=='passed' and summary['words']==a['checkedWords'] and summary['pixels']==a['checkedPixels']
 summary['primarySources']=primary;summary['sourceSequenceSha256']=sha(json.dumps(emitted,separators=(',',':')).encode())
 for b,r in summary['maximumObservedError'].items():summary['maximumObservedError'][b]=dict(upperAbsoluteError=pair(r['value']),displayApproximation=float(r['value']),point=r['point'])
 return summary
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--report',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();r=dict(schema='virgl-sine-critic-capture-guards-v1',task='E6-T12g6j1',status='running',testSha256=sha(Path(__file__).read_bytes()),reportSha256=sha(a.report.read_bytes()))
 try:r['physical']=inspect(a.report.resolve());r['status']='passed'
 except Exception as e:r['status']='failed';r['failure']=dict(message=str(e));raise
 finally:a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(r,indent=2)+'\n')
 print(r['physical']['words'],'physical words /',r['physical']['pixels'],'pixels independently predicted from original TGSI')
if __name__=='__main__':main()
