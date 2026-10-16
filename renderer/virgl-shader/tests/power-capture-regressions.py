#!/usr/bin/env python3
"""Critic oracle: original TGSI versions and rational-series power enclosures.

This does not import the worker reference, selected lists, or its Decimal ln/exp.
ln uses 2*atanh((m-1)/(m+1)) after exact binary range reduction. exp uses a
positive Taylor tail after division by256, then eight outward squarings;
negative arguments use the reciprocal interval. Every arithmetic step rounds
outward to a1040-bit dyadic grid. Exact identities are proved rationally.
"""
import argparse,hashlib,json,re,struct
from fractions import Fraction as F
from functools import lru_cache
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];LANES='xyzw';BUDGET=F(1,1<<14)
SCALE=1<<1040;EPS=F(8,SCALE)
sha=lambda b:hashlib.sha256(b).hexdigest()
def number(w):
 assert isinstance(w,int)and not isinstance(w,bool)and 0<=w<=0xffffffff
 e=(w>>23)&255;m=w&0x7fffff;assert e<255,'nonfinite word'
 n=m if e==0 else m+2**23;p=-149 if e==0 else e-150
 x=F(n*2**p)if p>=0 else F(n,2**(-p));return -x if w>>31 else x
def pair(x):return dict(n=str(x.numerator),d=str(x.denominator))
def unpair(x):return F(int(x['n']),int(x['d']))
def down(x):return F((x*SCALE).__floor__(),SCALE)
def up(x):return F((x*SCALE).__ceil__(),SCALE)
@lru_cache(None)
def logarithm_unit(x):
 assert 1<=x<=2
 t=(x-1)/(x+1);square=t*t;pl=ph=t;lo=hi=F(0)
 if t==0:return F(0),F(0)
 for j in range(2000):
  lo=down(lo+2*pl/(2*j+1));hi=up(hi+2*ph/(2*j+1))
  pl=down(pl*square);ph=up(ph*square)
  tail=up(2*ph/((2*j+3)*(1-square)))
  if tail<=EPS:return lo,up(hi+tail)
 raise AssertionError('bounded logarithm tail')
def logarithm(x):
 k=x.numerator.bit_length()-x.denominator.bit_length()
 p=F(2**k)if k>=0 else F(1,2**(-k))
 if x<p:k-=1;p/=2
 assert p<=x<2*p
 ml,mh=logarithm_unit(x/p);tl,th=logarithm_unit(F(2))
 return (down(ml+k*tl),up(mh+k*th))if k>=0 else (down(ml+k*th),up(mh+k*tl))
def exponential_endpoint(x):
 negative=x<0;t=abs(x)/256;assert 0<=t<F(1,2),'binary range reduction'
 if t==0:return F(1),F(1)
 pl=ph=lo=hi=F(1)
 for n in range(1,1000):
  pl=down(pl*t/n);ph=up(ph*t/n);lo=down(lo+pl);hi=up(hi+ph)
  following=up(ph*t/(n+1));tail=up(following/(1-t/(n+2)))
  if tail<=EPS:hi=up(hi+tail);break
 else:raise AssertionError('bounded positive exponential tail')
 if negative:lo,hi=down(1/hi),up(1/lo)
 for _ in range(8):lo,hi=down(lo*lo),up(hi*hi)
 return lo,hi
@lru_cache(None)
def real_power(w,e):
 x,y=number(w),number(e)
 assert x>=0 and(x>0 or y>0),'defined nonnegative base'
 assert all((v&0x7f800000)not in(0,0x7f800000)or number(v)==0 for v in(w,e)),'normal-or-zero source'
 if x==0:return F(0),F(0),'zero-base-positive-exponent'
 if x==1 or y==0:return F(1),F(1),'rational-identity'
 if y.denominator==1 and abs(y)<=120:
  z=x**int(y);return z,z,'rational-integer-power'
 if x.numerator&(x.numerator-1)==0 and x.denominator&(x.denominator-1)==0:
  z=(x.numerator.bit_length()-x.denominator.bit_length())*y
  if z.denominator==1:
   v=F(2**int(z))if z>=0 else F(1,2**int(-z));return v,v,'rational-power-of-two'
 a,b=logarithm(x);a,b=(down(a*y),up(b*y))if y>=0 else(down(b*y),up(a*y))
 lo=exponential_endpoint(a)[0];hi=exponential_endpoint(b)[1]
 assert 0<lo<=hi and(hi-lo)/lo<F(1,1<<800),'narrow independent interval'
 return lo,hi,'rational-atanh-exp-1040-outward'
@lru_cache(None)
def prediction(w,e):
 lo,hi,method=real_power(w,e)
 if lo==hi==0:return dict(op='POW',word=w,exponentWord=e,exact=0,method=method)
 return dict(op='POW',word=w,exponentWord=e,lower=pair(lo),upper=pair(hi),allowedLower=pair(hi*(1-BUDGET)),allowedUpper=pair(lo*(1+BUDGET)),method=method)
def allowed(r,w):
 if 'exact'in r:return r['exact']==w
 try:v=number(w)
 except AssertionError:return False
 return unpair(r['allowedLower'])<=v<=unpair(r['allowedUpper'])
def error_bound(r,w):
 if 'exact'in r:return F(0)if allowed(r,w)else F(1)
 v=number(w);return max(abs(v/unpair(r['lower'])-1),abs(v/unpair(r['upper'])-1))
def execute(text,bank,backend):
 assert backend in('owned','mesa');regs={('CONST',i):bank[4*i:4*i+4]for i in range(len(bank)//4)};stack=[];active=True;events=[]
 def src(token):
  m=re.fullmatch(r'(-?)(IMM|TEMP|CONST)\[(\d+)\](?:\.([xyzw]{4}))?',token.strip());assert m,token
  neg,file,index,sw=m.groups();values=regs.get((file,int(index)),[None]*4);values=[values[LANES.index(c)]for c in sw or LANES]
  if neg:values=[v^0x80000000 if isinstance(v,int)else None for v in values]
  return values
 for raw in text.splitlines():
  line=re.sub(r'^\d+:\s*','',raw.strip())
  if not line or line in('VERT','FRAG','END')or line.startswith('DCL '):continue
  if line.startswith('IMM['):
   m=re.fullmatch(r'IMM\[(\d+)\] UINT32 \{([^}]+)\}',line);assert m,line
   v=[int(s.strip())for s in m[2].split(',')];assert len(v)==4;regs[('IMM',int(m[1]))]=v;continue
  if line.startswith('UIF '):
   v=src(line[4:])[0];assert isinstance(v,int);stack.append((active,v!=0));active=active and v!=0;continue
  if line=='ELSE':active=stack[-1][0]and not stack[-1][1];continue
  if line=='ENDIF':active=stack.pop()[0];continue
  if line.startswith(('AND TEMP[1], TEMP[0]','USHR TEMP[1], TEMP[0]')):break
  if not active:continue
  op,args=line.split(' ',1);tokens=[v.strip()for v in args.split(',')]
  d=re.fullmatch(r'TEMP\[(\d+)\](?:\.([xyzw]+))?',tokens[0]);assert d,line
  index=int(d[1]);mask=d[2]or LANES;sources=[src(t)for t in tokens[1:]]
  if op=='MOV':out=sources[0]
  elif op=='POW':
   assert len(sources)==2
   # GLSL vector pow is then truncated by float/vecN before assigning the
   # destination mask. Its i-th WRITTEN component comes from component i.
   slots=[0 if backend=='owned'else sum(c in mask for c in LANES[:i])for i in range(4)]
   out=[('POW',sources[0][i],sources[1][i])for i in slots]
   for i,c in enumerate(LANES):
    if c in mask:assert all(isinstance(w,int)for w in out[i][1:]),'uninitialized source';real_power(*out[i][1:])
   events.append(dict(statement=line,destination=tokens[0],baseSource=tokens[1],exponentSource=tokens[2],baseWords=sources[0],exponentWords=sources[1],mask=mask,packingSlots=slots))
  elif op in('AND','OR','UADD'):
   assert len(sources)==2 and all(isinstance(v,int)for s in sources for v in s)
   out=[a&b if op=='AND'else a|b if op=='OR'else(a+b)&0xffffffff for a,b in zip(*sources)]
  else:raise AssertionError('unsupported source producer '+line)
  old=regs.get(('TEMP',index),[None]*4).copy()
  for c in mask:old[LANES.index(c)]=out[LANES.index(c)]
  regs[('TEMP',index)]=old
 assert not stack and('TEMP',0)in regs
 result=regs[('TEMP',0)];assert all(v is not None for v in result)
 return [prediction(v[1],v[2])if isinstance(v,tuple)else {'exact':v}for v in result],events
def bank(v,x=None):return((x or v).get('bankUpload')or{}).get('words',[])
def vendor_shape(glsl,text):
 statements=[l.strip()for l in text.splitlines()if l.strip().startswith('POW ')]
 lines=[l.strip()for l in glsl.splitlines()if 'pow('in l];assert len(lines)==len(statements)
 for tgsi,glsl in zip(statements,lines):
  d=re.match(r'POW TEMP\[(\d+)\](?:\.([xyzw]+))?,',tgsi);assert d,tgsi
  index,mask=d[1],d[2]or LANES;constructor='float'if len(mask)==1 else 'vec'+str(len(mask))
  # The unmodified converter body is retained and independently checked.
  assert re.match(r'temp'+index+(r'\.'+mask if mask!=LANES else '')+r' = '+constructor+r'\(pow\(',glsl),(tgsi,glsl)
 return [dict(statement=s,glsl=l)for s,l in zip(statements,lines)]
def inspect(path):
 raw=path.read_bytes();report=json.loads(raw);a=report['acceptance'];assert report['browserErrors']==dict(console=[],page=[],requests=[])
 assert not report['trackedChanges'];assert report['browser']['launch']['headless']is False and report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']]=='enabled'
 assert not re.search('software|swiftshader|llvmpipe|softpipe',a['renderer']['renderer'],re.I)
 assert a['objects']['live']==0 and a['guestExecution']is False and a['productionNegotiation']is False
 summary=dict(path=str(path),sha256=sha(raw),seed=a['seed'],renderer=a['renderer'],words=0,pixels=0,byBackend={},maximumObservedError={b:dict(value=F(0),point=None)for b in('owned','mesa')},deviations=[],captures=[],sourceFaults=[],points=[],canonicalPrimaryWords=0,referenceEquations={});sources=[];primary=[]
 def measure(backend,truth,w,point):
  assert allowed(truth,w),dict(point=point,prediction=truth,observed=w)
  if truth.get('op')=='POW':
   summary['referenceEquations'][str(truth['word'])+'/'+str(truth['exponentWord'])]=truth
   error=error_bound(truth,w);assert error<=BUDGET
   if error>summary['maximumObservedError'][backend]['value']:summary['maximumObservedError'][backend]=dict(value=error,point=point)
 for vi,v in enumerate(a['vertices']):
  assert sha(v['text'].encode())==v['textSha256'];m=v['mutation'];shader=m['served']if m else v['primary']['glsl']if v['backend']=='mesa'else v['pair']['vertex']['glsl'];sources.extend([shader,v['pair']['fragment']['glsl']])
  if m:
   assert m['original']==v['pair']['vertex']['glsl']and m['served']==m['original'].replace(m['needle'],m['replacement'],1);summary['sourceFaults'].append(dict(vertex=vi,**m))
  assert [(r['name'],r['type'],r['size'])for r in v['reflection']]==[('gl_Position',35666,1),('vso_g0',35666,1),('vso_g1',35666,1)]
  if v['backend']=='mesa':
   assert all(t['sourceType']==t['destinationType']==4 and t['outputMode']==2 for t in v['primary']['powerInstructions']);primary.append(dict(textSha256=v['textSha256'],glslSha256=sha(v['primary']['glsl'].encode()),packing=vendor_shape(v['primary']['glsl'],v['text'])))
  for xi,x in enumerate(v['vectors']):
   truth,events=execute(v['text'],bank(v,x),v['backend']);b=bytes(x['bytes']);actual=list(struct.unpack('<12I',b));assert len(b)==48 and sha(b)==x['sha256']and actual==x['observed']
   assert actual[:4]==[struct.unpack('<I',struct.pack('<f',z))[0]for z in x['position']]==x['attributeWords']
   reconstructed=[((actual[8+i]&511)<<23)|(actual[4+i]&0x7fffff)for i in range(4)];assert reconstructed==x['reconstructed']
   assert all(actual[4+i]==(w&0x7fffff)|0x3f000000 and actual[8+i]==(w>>23)|0x3f000000 for i,w in enumerate(reconstructed))
   for lane,(r,w)in enumerate(zip(truth,reconstructed)):measure(v['backend'],r,w,dict(stage='vertex',record=vi,vector=xi,lane=lane,condition=x['condition'],inputWord=r.get('word'),exponentWord=r.get('exponentWord'),observedWord=w,sourceSha256=v['textSha256'],captureSha256=x['sha256']))
   assert [(r.get('word'),r.get('exponentWord'),r.get('exact'))for r in truth]==[(r.get('word'),r.get('exponentWord'),r.get('exact'))for r in x['oracles']],'stored expectations agree only after original source interpretation'
   if v['backend']=='mesa':
    scalar,_=execute(v['text'],bank(v,x),'owned')
    if not all(allowed(r,w)for r,w in zip(scalar,reconstructed)):summary['deviations'].append(dict(vertex=vi,vector=xi,sourceSha256=v['textSha256'],captureSha256=x['sha256'],observed=reconstructed,scalarInputs=[(r.get('word'),r.get('exponentWord'))for r in scalar],componentInputs=[(r.get('word'),r.get('exponentWord'))for r in truth]))
    if scalar==truth:summary['canonicalPrimaryWords']+=12
   u=x['bankUpload']
   if u:
    assert u['words'][:4]==u['observedA']==v['input']['a']and u['words'][172]==x['condition']and all(z==0xdeadbeef for z in u['callerAfter'])
    if u['observedB']is not None:assert u['words'][180:184]==u['observedB']==v['input']['e']
    if u['observedCondition']is not None:assert u['observedCondition'][0]==x['condition']
   assert x['checkedWords']==12;summary['words']+=12;summary['byBackend'].setdefault(v['backend'],dict(words=0,pixels=0))['words']+=12
   if vi<4 or v.get('capture'):summary['points'].append(dict(vertex=vi,vector=xi,sha256=x['sha256'],reconstructed=reconstructed,equations=events))
  if v.get('capture'):
   c=v['capture'];p=ROOT/c['path'];assert sha(p.read_bytes())==c['sha256'];literal=p.read_text().splitlines()[c['line']-1].split(':',1)[1].strip();assert literal==c['statement']and literal in v['text']
   assert execute(v['text'],bank(v,v['vectors'][0]),'owned')[0]==execute(v['text'],bank(v,v['vectors'][0]),'mesa')[0]
   summary['captures'].append(dict(vertex=vi,backend=v['backend'],**c))
 for fi,f in enumerate(a['fragments']):
  assert sha(f['text'].encode())==f['textSha256'];sources.extend([f['pair']['vertex']['glsl'],f['primary']['glsl']if f['backend']=='mesa'else f['pair']['fragment']['glsl']])
  if f['backend']=='mesa':vendor_shape(f['primary']['glsl'],f['text'])
  truth=execute(f['text'],bank(f),f['backend'])[0][f['lane']];b=bytes(f['rgbaBytes']);actual=list(struct.unpack('<16I',b));assert len(b)==64 and sha(b)==f['sha256']and actual==f['reconstructed']
  for pixel,w in enumerate(actual):measure(f['backend'],truth,w,dict(stage='fragment',record=fi,pixel=pixel,inputWord=truth.get('word'),exponentWord=truth.get('exponentWord'),observedWord=w,sourceSha256=f['textSha256'],captureSha256=f['sha256']))
  assert(truth.get('word'),truth.get('exponentWord'),truth.get('exact'))==(f['oracle'].get('word'),f['oracle'].get('exponentWord'),f['oracle'].get('exact'))
  assert f['checkedPixels']==16;summary['pixels']+=16;summary['byBackend'].setdefault(f['backend'],dict(words=0,pixels=0))['pixels']+=16
 for c in a['consumers']:
  assert len(c['captures'])==6 and len(c['submissions'])==5 and all(z==0 for z in c['finalBudgets'].values())and all(z==0 for z in c['finalResourceBudgets'].values())
  assert all(all(b==255 for b in s['after'])for s in c['submissions']);assert all(s['result']['ok']is True for s in c['submissions'][:-1]);r=c['rejection'];assert r['before']==r['after']and r['result']['ok']is False and r['result']['appliedCommands']==0
  assert 'POW 'in c['sources']['vertexText']and 'POW 'in c['sources']['fragmentText']
  banks=[]
  for cap in c['captures']:
   w=cap['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants'];assert len(w)==2 and w[0]==w[1]and len(w[0])==184;banks.append(w[0]);assert cap['native']
   assert {u['name']for u in cap['native']}=={'vsconst0','fsconst0'}and all(u['words']==w[0][4*u['index']:4*u['index']+4]for u in cap['native'])
  assert banks[0]==banks[1]==banks[4]==banks[5]and banks[2]==banks[3]and banks[0]!=banks[2]
 emitted=[e['source']for e in a['events']if e['call']=='shaderSource'];assert emitted[:len(sources)]==sources,'literal hardware shaderSource sequence'
 tail=emitted[len(sources):];assert len(tail)==4
 for c,vs,fs in zip(a['consumers'],tail[::2],tail[1::2]):assert '/* power:POW */'in vs and '/* power:POW */'in fs and 'raw_saturate'in vs and 'raw_saturate'in fs
 assert all(e['status']is True for e in a['events']if e['call']in('compileShader','linkProgram'))
 assert len(summary['captures'])==144 and len({(c['sha256'],c['line'])for c in summary['captures']})==72
 assert report['status']==a['status']=='passed'and summary['words']==a['checkedWords']and summary['pixels']==a['checkedPixels']
 summary['primarySources']=primary;summary['sourceSequenceSha256']=sha(json.dumps(emitted,separators=(',',':')).encode())
 for backend,r in summary['maximumObservedError'].items():summary['maximumObservedError'][backend]=dict(upperRelativeError=pair(r['value']),displayApproximation=float(r['value']),point=r['point'])
 return summary
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--report',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();r=dict(schema='virgl-power-critic-capture-guards-v1',task='E6-T12g6j2',status='running',testSha256=sha(Path(__file__).read_bytes()),reportSha256=sha(a.report.read_bytes()))
 try:r['physical']=inspect(a.report.resolve());r['status']='passed'
 except Exception as e:r['status']='failed';r['failure']=dict(message=str(e));raise
 finally:a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(r,indent=2)+'\n')
 print(r['physical']['words'],'physical words /',r['physical']['pixels'],'pixels independently predicted from original TGSI')
if __name__=='__main__':main()
