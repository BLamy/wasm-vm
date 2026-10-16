"""No worker oracle imports: exact fractions and integer-square-root enclosures."""
import hashlib,json,pathlib,sys
from fractions import Fraction as F
from math import isqrt
V=pathlib.Path(__file__).resolve().parent;label=sys.argv[1] if len(sys.argv)>1 else 'current';inp=V/(label+'-gpu-inputs.json');raw=V/(label+'-gpu-results.json');fixture=json.loads(inp.read_text());report=json.loads(raw.read_text())
def power(e):return F(2**e) if e>=0 else F(1,2**-e)
def decode(w):
 e=(w>>23)&255;m=w&0x7fffff
 if e==255:raise AssertionError('nonfinite in finite witness')
 return (-1 if w>>31 else 1)*F(m+(2**23 if e else 0))*power(e-150 if e else -149)
def exponent(q):
 e=q.numerator.bit_length()-q.denominator.bit_length()
 if power(e)>q:e-=1
 assert power(e)<=q<power(e+1);return e
def rational(xs):return F(*map(int,xs))
def bounds(e):
 if e['kind']=='exact':q=rational(e['q']);return q,q
 x=rational(e['input']);assert power(-126)<=x<=power(126);s=1/x
 if e['kind']=='rcp':
  d=F(5,2)*power(exponent(s)-23);return s-d,s+d
 assert e['kind']=='rsq'
 scale=2**160;m=isqrt((s.numerator*scale*scale)//s.denominator)
 lo,hi=F(m,scale),F(m+1,scale);assert lo*lo<=s<hi*hi
 d=2*power(exponent(s)//2-23);return lo-d,hi+d
assert report['librarySha256']==fixture['librarySha256'] and report['sourceDigests']==fixture['runtimeSourceDigests'] and report['consoleErrors']==[]
assert len(report['programs'])==len(fixture['programs'])
checks=0;failures=[]
for pi,(observed,expected) in enumerate(zip(report['programs'],fixture['programs'])):
 assert observed['name']==expected['name'] and len(observed['vectors'])==len(expected['vectors'])
 for vi,(got,want) in enumerate(zip(observed['vectors'],expected['vectors'])):
  assert [r['shift'] for r in got['captures']]==[0,8,16,24]
  for ci,c in enumerate(got['captures']):
   words=c['words'];assert len(words)==8
   written=[]
   for lane,e in enumerate(want['expectations']):
    lo,hi=bounds(e);actual=decode(words[lane]);checks+=1
    if not lo<=actual<=hi:failures.append({'program':pi,'name':expected['name'],'vector':vi,'capture':ci,'lane':lane,'actualWord':words[lane],'actual':str(actual),'lower':str(lo),'upper':str(hi),'kind':e['kind']})
    byte=(words[lane]>>c['shift'])&255
    assert words[lane+4]==0x3f000000+byte*32768,('raw-shadow discrepancy',pi,vi,ci,lane)
    if 'xyzw'[lane] in expected['mask']:written.append(words[lane])
   assert len(set(written))==1,('scalar replication diverged',pi,vi,ci,written)
summary={'status':'failed' if failures else 'passed','checks':checks,'failures':failures[:16],'totalFailures':len(failures),'fixtureSha256':hashlib.sha256(inp.read_bytes()).hexdigest(),'gpuResultSha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'renderer':report['renderer'],'draws':report['draws'],'oracle':'independent fractions; inverse-root rational floor isqrt at 160 bits; RCP2.5ULP/RSQ2ULP; exact dyadic DP3 and preserved lanes; within-invocation replication'}
(V/(label+'-gpu-check.json')).write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({k:v for k,v in summary.items() if k!='failures'}));sys.exit(bool(failures))
