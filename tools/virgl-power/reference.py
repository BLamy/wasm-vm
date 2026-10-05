#!/usr/bin/env python3
"""Independent real x**y enclosures from exact binary32 inputs.

Decimal ln/exp are correctly rounded (ROUND_HALF_EVEN). One unit of their
last precision place is an outward bound. Multiplication uses directed
rounding. The independently recomputed 220-digit enclosure must nest inside
160 digits. GPU bytes, selected lists and GLSL never compute an expectation.
"""
from decimal import Decimal,Context,ROUND_FLOOR,ROUND_CEILING,ROUND_HALF_EVEN
from fractions import Fraction
from functools import lru_cache
from pathlib import Path
import hashlib,json,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
def sha(b):return hashlib.sha256(b).hexdigest()
def number(w):
 e=(w>>23)&255;m=w&0x7fffff
 if e==255:raise ValueError('nonfinite word')
 n=m if not e else m|0x800000;p=-149 if not e else e-150
 q=Fraction(n*(1<<p)) if p>=0 else Fraction(n,1<<-p)
 return -q if w&0x80000000 else q
def power(e):return Fraction(1<<e) if e>=0 else Fraction(1,1<<-e)
def ratio(x):return dict(n=str(x.numerator),d=str(x.denominator))
def rational(row):return Fraction(int(row['n']),int(row['d']))
def enclosure(x,y,precision):
 if x==1 or y==0:return Fraction(1),Fraction(1),'identity'
 if y.denominator==1 and abs(y)<=120:return x**int(y),x**int(y),'integer-power-exact'
 # Exact rational roots of powers of two when the resulting exponent is int.
 if x.numerator&(x.numerator-1)==0 and x.denominator&(x.denominator-1)==0:
  z=(x.numerator.bit_length()-x.denominator.bit_length())*y
  if z.denominator==1:return power(int(z)),power(int(z)),'power-of-two-exact'
 ctx=Context(prec=precision,rounding=ROUND_HALF_EVEN,Emin=-999999,Emax=999999)
 xd=ctx.divide(Decimal(x.numerator),Decimal(x.denominator));yd=ctx.divide(Decimal(y.numerator),Decimal(y.denominator))
 assert Fraction(xd)==x and Fraction(yd)==y,'inputs exactly represented before transcendental operations'
 log=ctx.ln(xd);unit=Decimal(1).scaleb(log.adjusted()-precision+1)
 floor=ctx.copy();floor.rounding=ROUND_FLOOR;ceil=ctx.copy();ceil.rounding=ROUND_CEILING
 a=floor.subtract(log,unit);b=ceil.add(log,unit)
 lo=floor.multiply(a if y>=0 else b,yd);hi=ceil.multiply(b if y>=0 else a,yd)
 exp_lo=ctx.exp(lo);exp_hi=ctx.exp(hi)
 low=floor.subtract(exp_lo,Decimal(1).scaleb(exp_lo.adjusted()-precision+1))
 high=ceil.add(exp_hi,Decimal(1).scaleb(exp_hi.adjusted()-precision+1))
 return Fraction(low),Fraction(high),'outward-decimal-ln-exp'
@lru_cache(maxsize=None)
def predict(op,w,e):
 x=number(w);y=number(e)
 assert op=='POW' and x>=0 and (x or y>0),'defined nonnegative base domain'
 assert all((v&0x7f800000) not in [0,0x7f800000] or number(v)==0 for v in [w,e]),'normal-or-zero inputs'
 if x==0:return dict(op=op,word=w,exponentWord=e,input=ratio(x),exponent=ratio(y),exact=0,kind='zero-base-owned-positive-zero')
 lo,hi,method=enclosure(x,y,160);a,b,other=enclosure(x,y,220)
 assert lo<=a<=b<=hi and lo>0 and method==other,'independent tighter precision nests'
 budget=power(-14)
 return dict(op=op,word=w,exponentWord=e,input=ratio(x),exponent=ratio(y),lower=ratio(lo),upper=ratio(hi),higherLower=ratio(a),higherUpper=ratio(b),method=method,budget=ratio(budget),strict=False,kind='measured-host-relative',allowedLower=ratio(hi*(1-budget)),allowedUpper=ratio(lo*(1+budget)))
def accepts(row,w):
 if 'exact' in row:return w==row['exact']
 try:v=number(w)
 except ValueError:return False
 return rational(row['allowedLower'])<=v<=rational(row['allowedUpper'])
def maximum_error(row,w):
 if 'exact' in row:return Fraction(0) if accepts(row,w) else Fraction(1)
 value=number(w);return max(abs(value/rational(row['lower'])-1),abs(value/rational(row['upper'])-1))
def main():
 primary=sys.argv[1];output=Path(sys.argv[2]);plans=json.loads(subprocess.check_output(['node','tools/virgl-power/plan.mjs',primary],cwd=ROOT));keys=set()
 for plan in plans:
  for v in plan['vertices']:
   for entry in v['vectors']:
    for row in entry['selected']:
     if 'op' in row:keys.add((row['op'],row['word'],row['exponentWord']))
  for f in plan['fragments']:
   row=f['selected']
   if 'op' in row:keys.add((row['op'],row['word'],row['exponentWord']))
 rows=[predict(op,w,e) for op,w,e in sorted(keys)]
 raw=json.dumps(dict(schema='virgl-power-reference-v1',precision=[160,220],precisionUnit='decimal-digits',primaryFileSha256=sha((ROOT/primary).read_bytes()),referenceSourceSha256=sha(Path(__file__).read_bytes()),rows=rows),indent=2)+'\n'
 output.parent.mkdir(parents=True,exist_ok=True);output.write_text(raw);print(f'{len(rows)} independent outward power predictions recorded before GPU')
if __name__=='__main__':main()
