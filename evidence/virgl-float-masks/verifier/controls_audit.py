import hashlib,json,pathlib,struct
from worker_semantics import ordered
O=pathlib.Path(__file__).resolve().parent;R=O.parents[2];records=[];checks=0
M=0xffffffff

def sha(b):return hashlib.sha256(b).hexdigest()
def test(x,m):
 global checks
 checks+=1
 if not x:raise AssertionError(m)
def corrupted(a,b,ge,mode):
 magnitude_a=a&0x7fffffff;magnitude_b=b&0x7fffffff
 if mode!='unordered-guard' and (magnitude_a>0x7f800000 or magnitude_b>0x7f800000):return 0
 bothzero=mode!='signed-zero' and magnitude_a==magnitude_b==0
 key=lambda w:(w if mode=='negative-order' else w^M) if w>>31 else w^0x80000000
 value=(bothzero or key(a)>=key(b)) if ge else not bothzero and key(a)<key(b)
 return M if value else 0
for mode in ['unordered-guard','signed-zero','negative-order']:
 path=R/f'evidence/virgl-float-masks/worker/sabotage-{mode}/report.json';outer=json.loads(path.read_text());a=outer['acceptance'];test(outer['status']=='failed' and a['status']=='failed','intentional control failure');test(len(a['omissions'])==1,'one intended mutation')
 m=a['omissions'][0];original=m['originalGlsl'];mutated=original
 if mode=='unordered-guard':
  old='if (magnitude_a > 2139095040u || magnitude_b > 2139095040u) return 0u;';test(original.count(old)==1,'one NaN guard');mutated=original.replace(old,'if (false) return 0u;')
 elif mode=='signed-zero':
  old='bool both_zero = magnitude_a == 0u && magnitude_b == 0u;';test(original.count(old)==1,'one zero check');mutated=original.replace(old,'bool both_zero = false;')
 else:
  for value in ['a','b']:
   old=f'? ~{value} :';test(original.count(old)==1,'one negative key per operand');mutated=mutated.replace(old,f'? {value} :')
 test(mutated==m['servedGlsl'] and mutated!=original,'exact mutation only')
 test(sha(original.encode())==m['originalGlslSha256'] and sha(mutated.encode())==m['servedGlslSha256'],'mutation source digests')
 matching=[p for p in a['vertexProbes'] if p['vertexGlslSha256']==m['servedGlslSha256']];test(len(matching)==1,'mutated linked shader identified');p=matching[0]
 anchor=next(x for x in a['anchors'] if x['name']==p['vertex']);test(anchor['result']['glsl']==original,'original complete result preserved');test(p['programLogs']==dict(vertex='',fragment='',link=''),'compiled/linked without errors')
 failures=[]
 for vi,v in enumerate(p['vectors']):
  test(v['upload']['observedA']==v['a'] and v['upload']['observedB']==v['b'],'actual operand readback')
  reference=[ordered(x,y,p['oracle']=='fsge') for x,y in zip(v['a'],v['b'])]
  wrong=[corrupted(x,y,p['oracle']=='fsge',mode) for x,y in zip(v['a'],v['b'])]
  test(reference==v['expectedWords'],'uncorrupted exact rational reference')
  for ci,c in enumerate(v['captures']):
   bit=c['selector'];expected=[0,0,0,0x3f800000]+[0x3f000000+(((x>>bit)&255)<<15) for x in reference];observed=[0,0,0,0x3f800000]+[0x3f000000+(((x>>bit)&255)<<15) for x in wrong]
   test(c['expectedBits']==expected,'expected complete carrier');test(c['observedBits']==observed,'actual intentionally corrupted raw bits independently predicted')
   raw=struct.pack('<8I',*observed);test(c['rawBytes']==list(raw) and c['bytesSha256']==sha(raw),'actual byte record/digest')
   if observed!=expected:failures.append(dict(probe=p['name'],vector=v['name'],vectorIndex=vi,captureIndex=ci,selector=bit,expected=expected,observed=observed))
 test(len(failures)==1,'one precise first contradiction');test(a['objects']['live']==0 and a['objects']['created']==a['objects']['deleted'],'control GL lifecycle')
 records.append(dict(mode=mode,reportSha256=sha(path.read_bytes()),failures=failures))
path=O/'sabotage/report.json';outer=json.loads(path.read_text());a=outer['acceptance'];test(outer['status']==a['status']=='failed','novel control fails');test(a['parityCount']==2965,'full final parity cases before control');test(len(a['omissions'])==1,'one novel alias mutation');m=a['omissions'][0]
old='raw_float_mask(raw_temp[117].y, vsconst0[43].x, false)';new='raw_float_mask(raw_temp[117].x, vsconst0[43].x, false)'
test(m['originalGlsl'].count(old)==1 and m['mutatedGlsl']==m['originalGlsl'].replace(old,new),'novel source mutation')
p=a['vertex'][0];test(p['compile']['linked'] and all(x['ok'] for x in p['compile']['compiled']),'novel control compiles/links')
v=p['vectors'][0];test(v['name']=='alias-sign-boundary' and p['lane']==0,'predicted alias point');test(v['expected']==[M,0,M,M],'independent literal expected word')
test(v['expectedCarrierBits']==[0x3f7f8000]*4 and v['rawWords'][4:8]==[0x3f000000]*4,'all-ones versus zero actual sabotage');test(v['rawWords'][-4:]==[0xdeadc0de]*4,'TF outside-write guard retained')
records.append(dict(mode='novel-alias',reportSha256=sha(path.read_bytes()),probe='alias-vertex-0',vector=v['name'],capture=0,expectedWord=M,observedWord=0,expectedCarrier=v['expectedCarrierBits'],observedCarrier=v['rawWords'][4:8]))
report=dict(status='passed',checks=checks,records=records,scriptSha256=sha(pathlib.Path(__file__).read_bytes()))
(O/'controls-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(dict(status='passed',checks=checks,controls=len(records)))
