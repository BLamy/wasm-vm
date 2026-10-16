#!/usr/bin/env python3
"""Independent outward Decimal enclosures and exact ESSL error budgets.

Decimal ln/exp are correctly rounded HALF_EVEN (Python primary documentation).
Expanding each by one Decimal ULP and doing interval arithmetic with directed
rounding encloses the real expression. No emitted GLSL or binary32 math library
computes an expected output. A second, higher precision enclosure must nest.
"""
from decimal import Decimal, localcontext, ROUND_FLOOR, ROUND_CEILING
from fractions import Fraction
from functools import lru_cache
from pathlib import Path
import hashlib, json, subprocess, sys

ROOT=Path(__file__).resolve().parents[2]
def sha(b): return hashlib.sha256(b).hexdigest()
def number(w):
 e=(w>>23)&255;m=w&0x7fffff
 if e==255: raise ValueError('nonfinite word')
 n=m if not e else m|0x800000;p=-149 if not e else e-150
 q=Fraction(n*(1<<p)) if p>=0 else Fraction(n,1<<-p)
 return -q if w&0x80000000 else q
def power(e): return Fraction(1<<e) if e>=0 else Fraction(1,1<<-e)
def binary_exponent(q):
 q=abs(q);assert q>0
 e=q.numerator.bit_length()-q.denominator.bit_length()
 if q<power(e):e-=1
 return e
def is_power(q):
 return q>0 and q.numerator&(q.numerator-1)==0 and q.denominator&(q.denominator-1)==0
def exact(op,x):
 if op=='EX2' and x.denominator==1:return power(int(x))
 if op=='LG2' and is_power(x):return Fraction(binary_exponent(x))
 return None
def enclosure(op,x,precision):
 value=exact(op,x)
 if value is not None:return value,value
 with localcontext() as c:
  c.prec=precision
  xd=Decimal(x.numerator)/Decimal(x.denominator)
  assert Fraction(xd)==x,'binary32 source is converted exactly'
  ln2=Decimal(2).ln();a,b=ln2.next_minus(),ln2.next_plus()
  if op=='EX2':
   left,right=(a,b) if xd>=0 else (b,a)
   c.rounding=ROUND_FLOOR;low=xd*left
   c.rounding=ROUND_CEILING;high=xd*right
   # exp/ln ignore the arithmetic rounding mode and use HALF_EVEN.
   low=low.exp().next_minus();high=high.exp().next_plus()
  else:
   mid=xd.ln();left,right=mid.next_minus(),mid.next_plus()
   c.rounding=ROUND_FLOOR;low=left/(b if left>=0 else a)
   c.rounding=ROUND_CEILING;high=right/(a if right>=0 else b)
  return Fraction(low),Fraction(high)
def ratio(x):return dict(n=str(x.numerator),d=str(x.denominator))
@lru_cache(maxsize=None)
def predict(op,w):
 x=number(w);normal=(w&0x7f800000) not in [0,0x7f800000]
 assert op in ['EX2','LG2']
 assert (normal or x==0) and (-125<=x<=126 if op=='EX2' else x>0 and normal),'declared mathematical domain'
 lo,hi=enclosure(op,x,160);tight_lo,tight_hi=enclosure(op,x,220)
 assert lo<=tight_lo<=tight_hi<=hi,'higher precision reference nests'
 if op=='EX2':budget=(3+2*abs(x))*power(x.numerator//x.denominator-23);strict=False;kind='exponent-ulp'
 elif Fraction(1,2)<=x<=2:budget=power(-21);strict=True;kind='logarithm-absolute'
 else:
  assert binary_exponent(lo)==binary_exponent(hi),'reference has unambiguous ULP exponent'
  budget=3*power(binary_exponent(lo)-23);strict=False;kind='logarithm-ulp'
 # Require the observation within budget for EVERY possible true value in
 # the reference interval. This shrinks rather than widens the stated budget.
 return dict(op=op,word=w,input=ratio(x),lower=ratio(lo),upper=ratio(hi),higherLower=ratio(tight_lo),higherUpper=ratio(tight_hi),budget=ratio(budget),strict=strict,kind=kind,
             allowedLower=ratio(hi-budget),allowedUpper=ratio(lo+budget))
def accepts(row,w):
 try:v=number(w)
 except ValueError:return False
 a=Fraction(int(row['allowedLower']['n']),int(row['allowedLower']['d']));b=Fraction(int(row['allowedUpper']['n']),int(row['allowedUpper']['d']))
 return a<v<b if row['strict'] else a<=v<=b
def main():
 primary=sys.argv[1];output=Path(sys.argv[2]);plans=json.loads(subprocess.check_output(['node','tools/virgl-exponent-logarithm/plan.mjs',primary],cwd=ROOT))
 keys=set()
 for plan in plans:
  for v in plan['vertices']:
   for entry in v['vectors']:
    for row in entry['selected']:
     if 'op' in row:keys.add((row['op'],row['word']))
  for f in plan['fragments']:
   row=f['selected']
   if 'op' in row:keys.add((row['op'],row['word']))
 rows=[predict(op,w) for op,w in sorted(keys)]
 raw=json.dumps(dict(schema='virgl-exponent-reference-v1',precision=[160,220],primaryFileSha256=sha((ROOT/primary).read_bytes()),referenceSourceSha256=sha(Path(__file__).read_bytes()),rows=rows),indent=2)+'\n'
 output.parent.mkdir(parents=True,exist_ok=True);output.write_text(raw)
 print(f'{len(rows)} outward high precision predictions recorded before GPU')
if __name__=='__main__':main()
