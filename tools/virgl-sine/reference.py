#!/usr/bin/env python3
"""Independent exact-rational alternating Taylor enclosures for bounded sine.

Each binary32 input is converted exactly to a Fraction. Once successive terms
are monotonically decreasing, two adjacent partial sums enclose the real sine.
An independently computed tighter enclosure must nest. No sin/libm, emitted
GLSL, stored output or observed GPU value computes an expectation.
"""
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
def enclosure(x,precision):
 if not x:return Fraction(0),Fraction(0),0
 negative=x<0;x=abs(x);assert x<=8
 term=x;total=x;k=0
 while True:
  denominator=(2*k+2)*(2*k+3)
  next_term=-term*x*x/denominator
  # Later denominators only grow. This proves monotone alternating tails.
  if x*x<=denominator and abs(next_term)<=power(-precision):
   lo,hi=sorted((total,total+next_term))
   return (-hi,-lo,k+1) if negative else (lo,hi,k+1)
  total+=next_term;term=next_term;k+=1
  assert k<250,'bounded exact reference work'
def ratio(x):return dict(n=str(x.numerator),d=str(x.denominator))
@lru_cache(maxsize=None)
def predict(op,w):
 x=number(w);normal=(w&0x7f800000) not in [0,0x7f800000]
 assert op=='SIN' and (normal or x==0) and abs(x)<=8,'declared post-modifier argument domain'
 lo,hi,terms=enclosure(x,220);tight_lo,tight_hi,higher_terms=enclosure(x,280)
 assert lo<=tight_lo<=tight_hi<=hi,'higher precision reference nests'
 budget=power(-20)
 # Require the stated budget for every possible true value in the enclosure.
 return dict(op=op,word=w,input=ratio(x),lower=ratio(lo),upper=ratio(hi),higherLower=ratio(tight_lo),higherUpper=ratio(tight_hi),terms=terms,higherTerms=higher_terms,budget=ratio(budget),strict=False,kind='measured-host-absolute',allowedLower=ratio(hi-budget),allowedUpper=ratio(lo+budget))
def accepts(row,w):
 try:v=number(w)
 except ValueError:return False
 a=Fraction(int(row['allowedLower']['n']),int(row['allowedLower']['d']));b=Fraction(int(row['allowedUpper']['n']),int(row['allowedUpper']['d']))
 return a<=v<=b
def maximum_error(row,w):
 value=number(w);a=Fraction(int(row['lower']['n']),int(row['lower']['d']));b=Fraction(int(row['upper']['n']),int(row['upper']['d']))
 return max(abs(value-a),abs(value-b))
def main():
 primary=sys.argv[1];output=Path(sys.argv[2]);plans=json.loads(subprocess.check_output(['node','tools/virgl-sine/plan.mjs',primary],cwd=ROOT));keys=set()
 for plan in plans:
  for v in plan['vertices']:
   for entry in v['vectors']:
    for row in entry['selected']:
     if 'op' in row:keys.add((row['op'],row['word']))
  for f in plan['fragments']:
   row=f['selected']
   if 'op' in row:keys.add((row['op'],row['word']))
 rows=[predict(op,w) for op,w in sorted(keys)]
 raw=json.dumps(dict(schema='virgl-sine-reference-v1',precision=[220,280],precisionUnit='binary-bits',primaryFileSha256=sha((ROOT/primary).read_bytes()),referenceSourceSha256=sha(Path(__file__).read_bytes()),rows=rows),indent=2)+'\n'
 output.parent.mkdir(parents=True,exist_ok=True);output.write_text(raw);print(f'{len(rows)} exact rational sine predictions recorded before GPU')
if __name__=='__main__':main()
