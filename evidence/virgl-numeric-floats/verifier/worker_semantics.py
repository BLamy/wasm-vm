"""Independent TGSI straight-line interpreter of recorded GPU inputs.

No imports from compiler or authored reference helpers. Numeric arithmetic is
rational and each result is required to be exactly binary32 representable.
"""
from fractions import Fraction
import hashlib,json,pathlib,re,struct,sys
O=pathlib.Path(__file__).resolve().parent;ROOT=O.parents[2];M=2**32-1

def bits(value):return struct.unpack('<I',struct.pack('<f',float(value)))[0]
def val(word):
 s=-1 if word>>31 else 1;e=(word>>23)&255;m=word&0x7fffff
 assert e!=255,'nonfinite not within this exact-dyadic audit'
 n=Fraction(m if e==0 else 2**23+m);shift=-149 if e==0 else e-150
 return s*n*(2**shift if shift>=0 else Fraction(1,2**(-shift)))
def exact(n):
 w=bits(n);assert val(w)==n,('non-exact arithmetic outside oracle contract',n,w);return w

def parse(text):
 instructions=[];imm={};semantics={}
 for line in text.splitlines():
  line=re.sub(r'^\s*\d+:\s*','',line.strip())
  m=re.fullmatch(r'IMM\[(\d+)\] (FLT32|UINT32) \{(.*)\}',line)
  if m:imm[int(m[1])]=[int(x.strip()) if m[2]=='UINT32' else exact(Fraction(x.strip())) for x in m[3].split(',')];continue
  m=re.match(r'DCL IN\[(\d+)\], GENERIC\[(\d+)\]',line)
  if m:semantics[int(m[1])]=int(m[2])
  if not line or line in ['VERT','FRAG','END'] or line.startswith(('DCL ','PROPERTY ')):continue
  op,args=line.split(' ',1);instructions.append((op,[a.strip() for a in args.split(',')]))
 return instructions,imm,semantics

def execute(text,vector,selector=None):
 ops,imm,semantics=parse(text);vertex=text.startswith('VERT');regs={('IMM',i):v[:] for i,v in imm.items()}
 inputs={0:[.25,.5,-.25,1],1:vector['a'],2:vector['b'],3:vector['c']} if vertex else {i:vector[{5:'a',6:'b',7:'c'}[s]] for i,s in semantics.items()}
 for i,v in inputs.items():regs['IN',i]=list(map(bits,v))
 words=vector['upload']['words'][:]
 if selector is not None:
  assert len(words)>=180;words[176:180]=[selector]*4
 for i in range(len(words)//4):regs['CONST',i]=words[4*i:4*i+4]
 def reg(s):
  m=re.fullmatch(r'(TEMP|IN|OUT|IMM|CONST)\[(\d+)\](?:\.([xyzw]+))?',s);assert m,s
  return m[1],int(m[2]),m[3]
 def get(s):
  f,i,sw=reg(s);v=regs[f,i];return [v['xyzw'.index(x)] for x in (sw or 'xyzw')]
 trace=[]
 for step,(op,args) in enumerate(ops):
  f,i,mask=reg(args[0]);mask=mask or 'xyzw';src=[get(s) for s in args[1:]] if op!='TEX' else [get(args[1])]
  before=[v[:] for v in src];result=[None]*4
  if op=='TEX':
   index=int(re.fullmatch(r'SAMP\[(\d+)\]',args[2])[1]);t=next(b['texture'] for b in vector['sampleBindings'] if b['index']==index);x,y=map(val,src[0][:2]);ix=max(0,min(t['width']-1,int(x*t['width'])));iy=max(0,min(t['height']-1,int(y*t['height'])));result=[exact(Fraction(b,255)) for b in t['bytes'][4*(iy*t['width']+ix):4*(iy*t['width']+ix+1)]]
  else:
   for k in map('xyzw'.index,mask):
    a=src[0][k];b=src[1][k] if len(src)>1 else 0;c=src[2][k] if len(src)>2 else 0
    if op=='MOV':v=a
    elif op=='AND':v=a&b
    elif op=='OR':v=a|b
    elif op=='NOT':v=M^a
    elif op=='SHL':v=(a<<(b%32))&M
    elif op=='USHR':v=a>>(b%32)
    elif op=='UADD':v=(a+b)&M
    elif op=='USEQ':v=M if a==b else 0
    elif op=='USNE':v=M if a!=b else 0
    elif op=='UCMP':v=b if a else c
    elif op=='ADD':v=exact(val(a)+val(b))
    elif op=='MUL':v=exact(val(a)*val(b))
    elif op=='MAD':v=exact(val(a)*val(b)+val(c))
    elif op in ['FSLT','FSGE']:
     # These recorded inputs are finite dyadics. All-domain ordering is carried
     # forward from the unchanged parent boundary and its pinned recordings.
     v=M if (val(a)<val(b) if op=='FSLT' else val(a)>=val(b)) else 0
    else:raise AssertionError(op)
    result[k]=v
  dest=regs.setdefault((f,i),[None]*4)
  for k in map('xyzw'.index,mask):dest[k]=result[k]
  trace.append(dict(step=step,operation=op,destination=args[0],sources=before,result=result))
 return regs,trace

def main():
 path=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'evidence/virgl-numeric-floats/worker/hardware/report.json';r=json.loads(path.read_text());p=r['acceptance'];anchors={s['name']:s for s in p['anchors']};records=[];checks=0
 for probe in p['vertexProbes']:
  for vector in probe['vectors']:
   for cap in vector['captures']:
    regs,trace=execute(anchors[probe['vertex']]['text'],vector,cap['selector']);out=regs['OUT',0]+regs['OUT',1]+regs['OUT',2]
    assert out==cap['observedBits'],(probe['name'],vector['name'],cap['selector'],out,cap['observedBits']);assert regs['OUT',1]==vector['oracle']['words'];checks+=16
    records.append(dict(kind='vertex',probe=probe['name'],vector=vector['name'],selector=cap['selector'],output=out,traceSha256=hashlib.sha256(json.dumps(trace,sort_keys=True).encode()).hexdigest()))
 for kind in ['fragmentProbes','crossConsumerProbes']:
  for probe in p[kind]:
   for vector in probe['vectors']:
    for draw in vector['draws']:
     regs,trace=execute(anchors[probe['fragment']]['text'],vector,draw['selector']);out=[int(val(w)*255) for w in regs['OUT',0]];assert out==draw['observedBytes'],(kind,probe['name'],vector['name'],out,draw);checks+=4
     records.append(dict(kind=kind,probe=probe['name'],vector=vector['name'],selector=draw['selector'],output=out,traceSha256=hashlib.sha256(json.dumps(trace,sort_keys=True).encode()).hexdigest()))
 texture_pixels=pair_pixels=0
 for draw in p['textureDraws']:
  for y in range(32):
   for x in range(32):
    vector={'a':[(x+.5)/32,(y+.5)/32,0,1],'b':[0,0,0,0],'c':[0,0,0,0], 'upload':draw['upload'],'sampleBindings':[{'index':v['index'],'texture':v['texture']} for v in draw['samplers']]}
    regs,trace=execute(anchors[draw['fragment']]['text'],vector)
    out=[int(val(w)*255) for w in regs['OUT',0]];actual=draw['rawBytes'][4*(y*32+x):4*(y*32+x+1)]
    assert out==actual,(draw['name'],draw['phase'],x,y,out,actual);texture_pixels+=1
 for draw in p['pairDraws']:
  for y in range(32):
   for x in range(32):
    if x+y==31:continue
    actual=draw['rawBytes'][4*(y*32+x):4*(y*32+x+1)]
    out=[0,0,255,255] if x+y>31 else [0,255,0,255] if draw['mode']=='flat' else [int(Fraction(2*v+1,64)*255+Fraction(1,2)) for v in [x,y]]+[0,255]
    assert out==actual,(draw['name'],x,y,out,actual);pair_pixels+=1
 assert texture_pixels==4096 and pair_pixels==25792
 result=dict(status='passed',texturePixels=texture_pixels,interpolationPixels=pair_pixels,assertedWords=checks,draws=len(records),reportSha256=hashlib.sha256(path.read_bytes()).hexdigest(),interpreterSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),records=records)
 (O/'worker-semantics.json').write_text(json.dumps(result,indent=2)+'\n');print({k:result[k] for k in ['status','assertedWords','draws','texturePixels','interpolationPixels']})
if __name__=='__main__':main()
