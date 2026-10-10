from pathlib import Path
import json, hashlib, heapq, subprocess, re
ROOT=Path(__file__).resolve().parents[3]; V=Path(__file__).resolve().parent
HEAD='365b3cf3d076637c347c7e9802420f847d09fbed'; BASE='11558494'
paths=['renderer/virgl-command/'+n+'.mjs' for n in ['constant-domain','decoder','state']]
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT)
scripts={p:[] for p in paths}
for prefix in ['hot','cold','independent-final']:
 for f in ((V/'unpacked'/prefix) if prefix in ['hot','cold'] else V/prefix).rglob('*coverage.json'):
  if 'fault-' in str(f): continue
  data=json.loads(f.read_text())
  rows=data.get('scripts',[data] if 'source' in data else [])
  for row in rows:
   p=row.get('source')
   if p in scripts:
    need=sha(git('show',HEAD+':'+p)); assert row['sha256']==need
    scripts[p].append((str(f.relative_to(V)), row['coverage']))
# A V8 function or inner branch overrides wider containing ranges. Union only
# unmutated original recordings, retaining exact source hashes and byte offsets.
def counts(length,coverage):
 starts=[]
 for func in coverage['functions']:
  for r in func['ranges']:
   starts.append((r['startOffset'],r['endOffset'],r['count']))
 starts.sort(); out=[0]*length; heap=[]; i=0
 for at in range(length):
  while i<len(starts) and starts[i][0]<=at:
   a,b,c=starts[i]; heapq.heappush(heap,(b-a,b,c,a)); i+=1
  while heap and heap[0][1]<=at: heapq.heappop(heap)
  if heap: out[at]=heap[0][2]
 return out
report={'schema':1,'head':HEAD,'base':BASE,'files':{},'status':'audit-pending-waivers'}
for p in paths:
 raw=git('show',HEAD+':'+p); src=raw.decode(); lines=src.splitlines(keepends=True)
 merged=[0]*len(src); origins=['']*len(src)
 for name,cov in scripts[p]:
  cv=counts(len(src),cov)
  for i,n in enumerate(cv):
   if n>merged[i]: merged[i]=n; origins[i]=name
 patch=git('diff','--unified=0',BASE,HEAD,'--',p).decode()
 added=[]; hunks=[]
 for l in patch.splitlines():
  m=re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@',l)
  if m: at=int(m[1]); hunks.append({'start':at,'count':int(m[2] or 1)}); continue
  if l.startswith('+++'): continue
  if l.startswith('+'): added.append(at); at+=1
  elif l.startswith(' '): at+=1
 starts=[0]
 for line in lines: starts.append(starts[-1]+len(line))
 rows=[]
 for number in added:
  line=lines[number-1]; start=starts[number-1]; positions=[start+i for i,c in enumerate(line) if not c.isspace()]
  syntax=not positions or line.strip().startswith('//') or not re.search(r'[\w"\']',line)
  zero=[]
  for pos in positions:
   if merged[pos]==0:
    if zero and zero[-1][1]==pos: zero[-1][1]=pos+1
    else: zero.append([pos,pos+1])
  rows.append({'line':number,'text':line.strip(),'classification':'syntax/comment' if syntax else 'executed' if not zero else 'partial-or-unhit',
               'minimumCount':min([merged[i] for i in positions],default=0),'maximumCount':max([merged[i] for i in positions],default=0),
               'citations':sorted({origins[i] for i in positions if origins[i]}),'unhitRanges':[{'start':a,'end':b,'text':src[a:b]} for a,b in zero]})
 report['files'][p]={'sha256':sha(raw),'recordings':[n for n,c in scripts[p]],'hunks':hunks,'addedLines':rows}
 print(p,'added',len(rows),'executed',sum(r['classification']=='executed' for r in rows),'syntax',sum(r['classification']=='syntax/comment' for r in rows))
 for r in rows:
  if r['classification']=='partial-or-unhit': print(r['line'],r['minimumCount'],r['maximumCount'],r['text'],'UNHIT:',[s['text'] for s in r['unhitRanges']])
(V/'coverage-audit.json').write_text(json.dumps(report,indent=2)+'\n')
