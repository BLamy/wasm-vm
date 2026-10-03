"""Independent proof checks on every authored reciprocal enclosure at frozen head."""
import hashlib,importlib.util,json,pathlib,struct
from fractions import Fraction as F
from math import isqrt
V=pathlib.Path(__file__).resolve().parent;ROOT=V.parents[2]
spec=importlib.util.spec_from_file_location('scalar_audit_oracle',ROOT/'tools/virgl-dot-reciprocals/oracle.py');oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)
hardware=json.loads((ROOT/'renderer/virgl-shader/tests/dot-reciprocal-hardware.json').read_text())
def power(e):return F(2**e) if e>=0 else F(1,2**-e)
def frac(r):return F(int(r['numerator']),int(r['denominator']))
def exp(x):
 e=x.numerator.bit_length()-x.denominator.bit_length()
 if power(e)>x:e-=1
 assert power(e)<=x<power(e+1);return e
def decode(w):
 sign=-1 if w>>31 else 1;e=(w>>23)&255;m=w&0x7fffff;assert e!=255
 return sign*F(m+(2**23 if e else 0))*power(e-150 if e else -149)
checks=[]
def validate(kind,x):
 x=F(x);r=oracle.rcp_bounds(x) if kind=='rcp' else oracle.rsq_bounds(x);s=1/x
 assert power(-126)<=x<=power(126)
 if kind=='rcp':
  e=exp(s);q=power(e-23);lo=s-F(5,2)*q;hi=s+F(5,2)*q
  assert frac(r['numerator'])==1 and frac(r['denominator'])==x and frac(r['quotient'])==s
 else:
  e=exp(s)//2;q=power(e-23);assert r['scaleBits']==192
  a,b=frac(r['rootLower']),frac(r['rootUpper']);assert a*a<=s<=b*b
  if r['exactRoot']:assert a==b and a*a==s
  else:assert a*a<s<b*b and b-a==F(1,2**192)
  # Independently compute a differently sized rational bracket and require overlap.
  scale=2**224;k=isqrt(s.numerator*scale*scale//s.denominator)
  assert a<=F(k+1,scale) and F(k,scale)<=b
  lo=a-2*q;hi=b+2*q
  assert frac(r['input'])==x and frac(r['squaredReciprocal'])==s
 assert r['exponent']==e and frac(r['ulpQuantum'])==q and frac(r['lower'])==lo and frac(r['upper'])==hi
 # Outward words must be the nearest grid endpoints, not merely wide bounds.
 for factor in [1,2]:
  for upper,bound in [(False,lo*factor),(True,hi*factor)]:
   w=oracle.outward_word(bound,upper);actual=decode(w)
   assert actual>=bound if upper else actual<=bound
   neighbor=decode(w-1 if upper else w+1)
   assert neighbor<bound if upper else neighbor>bound
 checks.append({'kind':kind,'input':str(x),'lower':str(lo),'upper':str(hi),'exponent':e})
for v in hardware['reciprocalVectors']:
 a,b=list(map(F,v['a'])),list(map(F,v['b']))
 for kind,x in [('rcp',a[1]),('rcp',a[2]+F(1,4)),('rcp',-b[3]),('rsq',a[2]),('rsq',a[3]+F(1,4)),('rsq',F(1,2)+F((v['raw'][1]>>22)&1,4))]:validate(kind,x)
for kind in ['rcp','rsq']:
 for x in [1,2]:validate(kind,x)
for p,h in json.loads((V/'initial-runtime-digests.json').read_text()).items():assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h
files=['oracle.py','reciprocal_receipt.py','browser_receipt.py','receipt.py','native_receipt.py','component_compat.py','component_compat_receipt.py','regressions.py','cold.py']
report={'status':'passed','frozenHead':'72a8695ba92d734a6bead0c42ead3089d8611806','boundsChecked':len(checks),'checks':checks,'sourceDigests':{n:hashlib.sha256((ROOT/'tools/virgl-dot-reciprocals'/n).read_bytes()).hexdigest() for n in files}}
(V/'frozen-math-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'passed','boundsChecked':len(checks)}))
