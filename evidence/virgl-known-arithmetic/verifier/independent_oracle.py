#!/usr/bin/env python3
"""Independent integer/rational critic oracle. Imports no worker math reference."""
from fractions import Fraction
from pathlib import Path
import hashlib,json,math,re,struct
ROOT=Path(__file__).resolve().parents[3];E=Path(__file__).parent;U=ROOT/'target/evidence/virgl-known-arithmetic-critic/unpacked'
def sha(b):return hashlib.sha256(b).hexdigest()
def require(v,label):
 if not v:raise AssertionError(label)
def value(w):
 e=(w>>23)&255;m=w&0x7fffff
 require(e!=255,'finite independent operand')
 if e:m|=1<<23
 p=e-150 if e else -149
 n=Fraction(m<<p,1)if p>=0 else Fraction(m,1<<-p)
 return -n if w>>31 else n
def nearest(n,d):
 q,r=divmod(n,d)
 return q+(2*r>d or 2*r==d and q%2==1)
def encode(x,zero_sign=0):
 if not x:return zero_sign<<31
 sign=0x80000000 if x<0 else 0;x=abs(x);n,d=x.numerator,x.denominator;e=n.bit_length()-d.bit_length()
 if(e>=0 and n<d<<e)or(e<0 and n<<-e<d):e-=1
 if e<-126:
  m=nearest(n<<149,d)
  return sign|m
 p=23-e;m=nearest(n<<p,d)if p>=0 else nearest(n,d<<-p)
 if m==(1<<24):m>>=1;e+=1
 if e>=128:return sign|0x7f800000
 return sign|((e+127)<<23)|(m&0x7fffff)
def arithmetic(op,a,b):
 x,y=value(a),value(b)
 if op=='ADD':return encode(x+y,int(not x and not y and bool((a&b)>>31)))
 return encode(x*y,(a^b)>>31)
def trunc_word(w):
 f=value(w);n=abs(f.numerator)//f.denominator
 return(-n if f<0 else n)&0xffffffff
def parse_producers(text):
 imms={int(i):list(map(int,v.split(',')))for i,v in re.findall(r'IMM\[(\d+)\] UINT32 \{([^}]+)\}',text)}
 temp={};literals=[]
 for line in text.splitlines():
  m=re.fullmatch(r'(MOV|ADD|MUL) TEMP\[(\d+)\](?:\.([xyzw]+))?, (.+)',line)
  if not m:continue
  op,dst,mask,operands=m.groups();dst=int(dst);mask=mask or 'xyzw';sources=[]
  for s in operands.split(', '):
   q=re.fullmatch(r'(-?)(IMM|TEMP)\[(\d+)\](?:\.([xyzw]{4}))?',s)
   if not q:break
   neg,file,index,sw=q.groups();bank=imms if file=='IMM'else temp
   require(int(index)in bank,'producer source version exists');words=bank[int(index)];sw=sw or'xyzw'
   sources.append([words['xyzw'.index(c)]^(0x80000000 if neg else 0)for c in sw])
  else:
   if len(sources)!=(1 if op=='MOV'else 2):continue
   out=temp.get(dst,[None]*4).copy();computed={}
   for c in mask:
    lane='xyzw'.index(c);word=sources[0][lane]if op=='MOV'else arithmetic(op,sources[0][lane],sources[1][lane]);out[lane]=word
    if op!='MOV':computed[c]=word
   temp[dst]=out
   if op!='MOV':literals.append(computed)
 return temp,literals
summary={'schema':'virgl-known-arithmetic-critic-independent-oracle-v1','task':'E6-T12g6m1','status':'running','reference':'Python Fraction with exact binary32 integer RN-even; source operands parsed before captured values','native':[],'physical':[],'heldQualifications':[]}
for kind,prefix in [('hot','hot'),('cold','cold/acceptance')]:
 nraw=(U/prefix/'native/report.json').read_bytes();n=json.loads(nraw);pred=json.loads((U/prefix/'native/predictions.json').read_bytes());w=json.loads((U/prefix/'wasm/report.json').read_bytes());lines=(U/prefix/'native/native.log').read_text().splitlines()
 require(len(pred['words'])==11608,'full integer schedule');wordlines=[s for s in lines if s.startswith('WORD ')]
 require(len(wordlines)==len(pred['words']),'all raw words')
 for i,p in enumerate(pred['words']):
  wanted=arithmetic(p['op'],p['a'],p['b']);require(p['expected']==wanted,'independent rational '+str(i))
  require(wordlines[i]==f'WORD {i} {wanted}','actual stdout word '+str(i))
 raw_cases={};raw_pairs={}
 for line in lines:
  m=re.match(r'(CASE|PAIR) (\d+) (.*)',line)
  if m:(raw_cases if m[1]=='CASE'else raw_pairs)[int(m[2])]=json.loads(m[3])
 require(len(raw_cases)==len(raw_pairs)==len(n['cases'])==len(w['cases'])==419,'complete public schedules')
 for i,c in enumerate(n['cases']):
  require(c['result']==raw_cases[i]and c['pairResult']==raw_pairs[i],'actual native raw output')
  require(c['result']==w['cases'][i]['result']and c['pairResult']==w['cases'][i]['pair'],'complete native/Wasm results')
  require(c['textSha256']==sha(c['text'].encode()),'actual source custody')
  if not c['ok']:require(not any(k in c['result']for k in ['glsl','metadata']),'rejected output custody')
 require(n['layout'][:2]==[111744,112]and f"LAYOUT {' '.join(map(str,n['layout']))}"in lines,'bounded actual storage')
 require(lines[-1]=='STATUS passed'and not(U/prefix/'native/native.stderr').read_bytes(),'actual sanitizer clean exit')
 summary['native'].append({'kind':kind,'status':'HELD','reportSha256':sha(nraw),'nativeLogSha256':sha((U/prefix/'native/native.log').read_bytes()),'independentArithmeticResults':len(pred['words']),'wholePublicSinglesPairs':len(n['cases']),'layout':n['layout']})
 for path in sorted((U/prefix).glob('gpu-*/report.json'))+sorted((U/prefix).glob('fault-*/report.json')):
  raw=path.read_bytes();r=json.loads(raw);a=r['acceptance'];fault=a['fault'];points=[];mismatches=[];zeros=[]
  require(r['browserErrors']=={'console':[],'page':[],'requests':[]},'zero original browser errors')
  require(not r['browser']['launch']['headless']and r['browser']['gpu']['featureStatus'][r['browser']['webglFeature']]=='enabled','actual physical launch')
  require('Metal'in a['renderer']['renderer']and not re.search('swiftshader|llvmpipe|software',a['renderer']['renderer'],re.I),'actual physical Metal')
  require(a['objects']['live']==0,'actual physical disposal')
  for i,v in enumerate(a['vertices']):
   temp,literals=parse_producers(v['text']);words=temp[0];row=v['row']
   require(row['words']==words,'source-derived producer result')
   ints=[trunc_word(w)for w in words];numeric=[encode(Fraction(w-2**32 if w>=2**31 else w))for w in ints]
   require(row['integers']==ints and row['numeric']==numeric,'source-derived conversion result')
   glsl=v['pair']['vertex']['glsl'];actual_literals=[(c,int(w))for c,w in re.findall(r'/\* known:word \*/ raw_rhs\.([xyzw]) = (\d+)u;',glsl)]
   wanted_literals=[(c,w)for p in literals for c,w in p.items()]
   require(actual_literals==wanted_literals,'raw literal producer cache exact')
   require([int(w)for w in re.findall(r'/\* known:shadow \*/ uintBitsToFloat\((\d+)u\)',glsl)]==[w for _,w in wanted_literals],'exact matching shadow literals')
   # Each snapshot literal is evaluated before the corresponding raw/float destination publish.
   require(glsl.find('/* known:shadow */')<glsl.find('/* known:word */'),'shadow snapshots before publication')
   require(any(e.get('source')==(v['mutation']['served']if v['mutation']else glsl)for e in a['events']),'actual shaderSource receipt')
   for j,entry in enumerate(v['vectors']):
    bs=bytes(entry['bytes']);observed=list(struct.unpack('<20I',bs));require(sha(bs)==entry['sha256']and observed==entry['observed'],'raw word/digest lineage')
    position=[struct.unpack('<I',struct.pack('<f',n))[0]for n in entry['position']]
    expected=position+[(w&0x7fffff)|0x3f000000 for w in words]+[(w>>23)|0x3f000000 for w in words]+numeric+words
    require(entry['expectedWords']==expected,'independent full word predictions')
    for lane,(x,y)in enumerate(zip(observed,expected)):
     if x==y:continue
     if lane>=16 and (x&0x7fffffff)==(y&0x7fffffff)==0:zeros.append({'vertex':i,'vector':j,'lane':lane,'rawWord':y,'numericShadowWord':x})
     else:mismatches.append({'vertex':i,'vector':j,'lane':lane,'expected':y,'observed':x})
    points.append({'point':f'#/acceptance/vertices/{i}/vectors/{j}','words':20,'sha256':entry['sha256']})
  for i,f in enumerate(a['fragments']):
   temp,_=parse_producers(f['text']);words=temp[0];require(f['row']['words']==words,'fragment source-derived raw producer')
   if f['converted']:words=[trunc_word(w)for w in words]
   expected=[(words[f['lane']]>>s)&255 for s in [0,8,16,24]]
   require(f['expectedBytes']==expected and f['bytes']==expected*16,'all original exact RGBA8 readback bytes')
   require(sha(bytes(f['bytes']))==f['sha256'],'original byte digest')
  for i,m in enumerate(a['math']):
   temp,_=parse_producers(m['text']);x=float(value(temp[0][0]));op=m['consumer'];expected={'SIN':math.sin,'POW':lambda n:n*n,'EX2':lambda n:2**n,'LG2':math.log2}[op](x)
   budget=abs(expected)*2**-14 if op=='POW'else 2**-20*max(1,abs(expected))
   require(abs(m['expected']-expected)<1e-15 and m['budget']==budget,'independent mathematical consumer prediction')
   bs=bytes(m['bytes']);observed=list(struct.unpack('<8f',bs));require(observed==m['observed']and sha(bs)==m['sha256'],'original math bytes')
   require(observed[:4]==[0,0,0,1]and all(math.isfinite(y)and abs(y-expected)<=budget for y in observed[4:]),'independent physical math consumer')
  if fault:
   require(r['status']==a['status']=='failed'and mismatches,'real shader-source sensitivity')
   require(len(a['vertices'])==1 and a['vertices'][0]['mutation']['fault']==fault,'bounded actual source mutation')
  else:
   require(not mismatches and r['status']==a['status']=='passed','actual physical exact results')
   require(len(a['vertices'])==61 and len(a['fragments'])==488 and len(a['math'])==8,'complete hardware schedule')
   require(a['checkedWords']==2504 and a['checkedPixels']==7808,'complete schedule totals')
  summary['physical'].append({'kind':kind,'source':str(path.relative_to(U)),'sourceSha256':sha(raw),'status':'HELD','seed':a['seed'],'fault':fault,'sourceDerivedProducerRows':len(a['vertices']),'rawCarrierWords':sum(p['words']for p in points),'mathWords':8*len(a['math']),'exactRgbaPixels':16*len(a['fragments']),'faultContradictions':mismatches,'qualifiedNumericZeroSigns':zeros,'originalPoints':points})
summary['heldQualifications']=['Raw two-channel sign/exponent/mantissa words and literal RGBA bytes prove zero signs exactly. Ordinary highp numeric shadow zero sign is expressly qualified by task submission; the only observed zero-sign differences are counted separately.','Direct integer functions have no fenv dependency; four host-rounding-mode executions are bound by original native source and profile.']
summary['status']='passed';(E/'independent-oracle-audit.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({'status':'passed','native':[r['independentArithmeticResults']for r in summary['native']],'physicalRecordings':len(summary['physical']),'qualifiedZeroSigns':sum(len(r['qualifiedNumericZeroSigns'])for r in summary['physical']),'actualSourceFaultContradictions':sum(len(r['faultContradictions'])for r in summary['physical'])}))
