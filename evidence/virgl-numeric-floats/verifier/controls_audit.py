import hashlib,json,pathlib,re,struct
from worker_semantics import execute,bits,val
O=pathlib.Path(__file__).resolve().parent;R=O.parents[2];records=[];checks=0

def sha(b):return hashlib.sha256(b).hexdigest()
def test(c,m):
 global checks
 checks+=1
 if not c:raise AssertionError(m)
for mode in ['stale-shadow','numeric-decode','sampler-index']:
 path=R/f'evidence/virgl-numeric-floats/worker/sabotage-{mode}/report.json';outer=json.loads(path.read_text());a=outer['acceptance'];test(outer['status']==a['status']=='failed','intentional semantic failure');test(len(a['omissions'])==1,'one exact mutation');m=a['omissions'][0];source=m['originalGlsl']
 if mode=='stale-shadow':
  old='float_temp[9].xyzw = float_rhs.xyzw;';new='float_temp[9].xyzw = float_temp[117].xyzw;';test(source.count(old)==1,'one MOV shadow store');mutated=source.replace(old,new)
 elif mode=='numeric-decode':
  expression=r'uintBitsToFloat\(raw_temp\[9\]\.([xyzw])\)';test(len(re.findall(expression,source))==4,'four consumed numeric lanes');mutated=re.sub(expression,r'float(raw_temp[9].\1)',source)
 else:
  expression=r'texture\(fssamp([07]),';test(len(re.findall(expression,source))==2,'two sampled source sites');mutated=re.sub(expression,lambda x:f'texture(fssamp{7-int(x[1])},',source)
 test(mutated==m['servedGlsl'] and mutated!=source,'only intended GLSL edit');test(sha(source.encode())==m['originalGlslSha256'] and sha(mutated.encode())==m['servedGlslSha256'],'original/mutated source identity');test(a['objects']['live']==0 and a['objects']['created']==a['objects']['deleted'],'actual control GL objects released')
 key='fragmentProbes' if mode=='sampler-index' else 'vertexProbes';p=next(p for p in a[key] if p[('fragment' if mode=='sampler-index' else 'vertex')+'GlslSha256']==m['servedGlslSha256']);test(p['programLogs']==dict(vertex='',fragment='',link=''),'actual mutant compiles/links');anchor=next(x for x in a['anchors'] if x['name']==p['fragment' if mode=='sampler-index' else 'vertex']);test(anchor['result']['glsl']==source,'unmutated translation object retained');v=p['vectors'][-1];sample=v['draws'][-1] if mode=='sampler-index' else v['captures'][-1];regs,_=execute(anchor['text'],v,sample['selector']);expected=[int(val(w)*255) for w in regs['OUT',0]] if mode=='sampler-index' else regs['OUT',0]+regs['OUT',1]+regs['OUT',2]
 actual=sample['observedBytes' if mode=='sampler-index' else 'observedBits'];test(sample['expectedBytes' if mode=='sampler-index' else 'expectedBits']==expected,'uncorrupted prediction from independent TGSI interpretation');test(actual!=expected,'real GPU contradiction')
 if mode=='stale-shadow':
  text=anchor['text'].replace('MOV TEMP[9], TEMP[117].wzyx','MOV TEMP[9], TEMP[117]');bad,_=execute(text,v,sample['selector']);wrong=bad['OUT',0]+bad['OUT',1]+bad['OUT',2];test(actual==wrong,'independently predicted unswizzled numeric source')
 elif mode=='sampler-index':
  text=anchor['text'].replace('SAMP[7], 2D','SAMP[8], 2D').replace('SAMP[0], 2D','SAMP[7], 2D').replace('SAMP[8], 2D','SAMP[0], 2D');bad,_=execute(text,v,sample['selector']);wrong=[int(val(w)*255) for w in bad['OUT',0]];test(actual==wrong,'independently predicted sampler swap')
 else:
  word=(v['raw'][0]&0x7fffff)|0x3f000000;wrong=bits(word*2);test(val(wrong)==word*2 and actual[4]==wrong,'exact first-lane integer-conversion fault result')
 records.append(dict(mode=mode,reportSha256=sha(path.read_bytes()),probe=p['name'],vector=v['name'],selector=sample['selector'],expected=expected,observed=actual))
path=O/'sabotage/report.json';outer=json.loads(path.read_text());a=outer['acceptance'];test(outer['status']==a['status']=='failed','independent novel alias control failure');m=a['omissions'][0];test(m['mutatedGlsl']==m['originalGlsl'].replace('float_temp[2].y','float_temp[2].z',1),'exact independently designed shadow-copy mutation');v=a['vertex'][0]['vectors'][0];test(v['expectedWords'][4]==0x3f400000 and v['rawWords'][4]==0x3e400000,'first independent numeric alias contradiction');test(v['rawWords'][12:]==[0xdeadc0de]*4,'untouched transform feedback guard');records.append(dict(mode='novel-alias',reportSha256=sha(path.read_bytes()),probe='numeric-vertex-x',vector=v['name'],expectedNumericX=0x3f400000,observedNumericX=0x3e400000))
report=dict(status='passed',assertions=checks,records=records,scriptSha256=sha(pathlib.Path(__file__).read_bytes()));(O/'controls-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(dict(status='passed',assertions=checks,controls=len(records)))
