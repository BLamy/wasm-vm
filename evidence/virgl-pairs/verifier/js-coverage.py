import json,re,hashlib,subprocess
from pathlib import Path
R=Path.cwd();V=R/'evidence/virgl-pairs/verifier';W=R/'evidence/virgl-pairs/worker/hardware/browser-coverage.json'
worker=json.loads(W.read_text())['scripts'];own=json.loads((V/'browser-coverage.json').read_text());result={}
for p in ['renderer/virgl-command/state.mjs','renderer/virgl-shader/index.mjs']:
 text=(R/p).read_text();sha=hashlib.sha256(text.encode()).hexdigest();assert hashlib.sha256(subprocess.check_output(['git','show','8b710648:'+p])).hexdigest()==sha
 w=next(x for x in worker if x['source']==p);assert w['sha256']==sha
 o=next(x for x in own if x['url'].endswith('/'+p));runs=[w['coverage'],o]
 added=[];line=0
 for s in subprocess.check_output(['git','diff','--unified=0','cffb8d57','8b710648','--',p],text=True).splitlines():
  if s.startswith('@@'):line=int(re.search(r'\+(\d+)',s)[1])
  elif s.startswith('+') and not s.startswith('+++'):added.append(line);line+=1
  elif not s.startswith('-') and not s.startswith('\\'):line+=1
 starts=[0];starts.extend(m.end() for m in re.finditer('\n',text));ranges=[[r for fn in run['functions'] for r in fn['ranges']]for run in runs];edges=sorted(set([n for rs in ranges for r in rs for n in [r['startOffset'],r['endOffset']]]));unhit=[]
 def count(rs,x):
  v=[r for r in rs if r['startOffset']<=x<r['endOffset']]
  return min(v,key=lambda r:r['endOffset']-r['startOffset'])['count'] if v else 0
 for a,b in zip(edges,edges[1:]):
  if not text[a:b].strip() or max(count(rs,a) for rs in ranges)>0:continue
  lo=text.count('\n',0,a)+1;hi=text.count('\n',0,b-1)+1
  if any(lo<=n<=hi for n in added):unhit.append({'from':a,'to':b,'lines':[lo,hi],'text':text[a:b]})
 result[p]={'sha256':sha,'addedLines':added,'unhitChangedRanges':unhit,'functions':[{'name':f['functionName'],'count':f['ranges'][0]['count']}for f in o['functions']]}
(V/'js-coverage-census.json').write_text(json.dumps({'inputs':[{'path':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in [W,V/'browser-coverage.json']],'files':result},indent=2)+'\n')
print(json.dumps({p:r['unhitChangedRanges']for p,r in result.items()},indent=2))
