import gzip,json,re,subprocess
from pathlib import Path
root=Path.cwd();out=root/'target/evidence/e9-t10-verifier';files=['web/loader.js','web/session-inputs.js','web/session-library.js','web/session-checkpoints.js','web/linux-worker-protocol.js','web/main.js','web/input-recording-probe.js','web/src/input/pointer.js'];sources=[root/'target/evidence/e9-t10-worker-final-incremental/browser/javascript-coverage.json.gz',root/'target/evidence/e9-t10-cold-final-incremental/acceptance/browser/javascript-coverage.json.gz',out/'pointer-browser/javascript-coverage.json.gz',out/'loader-browser/javascript-coverage.json.gz',out/'witness-fault-browser/javascript-coverage.json.gz',root/'target/evidence/e9-t10-public-final/browser/javascript-coverage.json.gz'];entries=[]
for p in sources:
 if p.exists():
  for e in json.loads(gzip.decompress(p.read_bytes())):e['_evidence']=str(p.relative_to(root));entries.append(e)
result={}
for name in files:
 text=(root/name).read_text();cs=[e for e in entries if e['url'].endswith('/'+name[4:])and e.get('source')==text];diff=subprocess.check_output(['git','diff','--unified=0','b25fb9de9e04b8be20a95ed1747066c1617e49b9','HEAD','--',name],text=True);numbers=[]
 for line in diff.splitlines():
  m=re.match(r'@@.*\+(\d+)(?:,(\d+))? @@',line)
  if m:numbers.extend(range(int(m[1]),int(m[1])+int(m[2]or'1')))
 offsets=[];at=0
 for l in text.splitlines(keepends=True):offsets.append(at);at+=len(l.encode('utf-16-le'))//2
 uncovered=[];covered=[]
 for n in numbers:
  line=text.splitlines()[n-1];off=offsets[n-1]+len(line)-len(line.lstrip());counts=[]
  for e in cs:
   rs=[r for f in e['functions']for r in f['ranges']if r['startOffset']<=off<r['endOffset']];counts.append(min(rs,key=lambda r:r['endOffset']-r['startOffset'])['count']if rs else 0)
  point={'line':n,'source':line.strip(),'max_count':max(counts,default=0)}
  (covered if any(counts)else uncovered).append(point)
 result[name]={'evidence_entries':len(cs),'evidence':sorted(set(e['_evidence']for e in cs)),'covered':covered,'uncovered':uncovered}
 print(name,'entries',len(cs),'changed',len(numbers),'covered',len(covered),'uncovered',len(uncovered))
 for e in uncovered:
  if e['source']and not e['source'].startswith('//')and e['source']not in ['}',');','};','},']:print(e['line'],e['source'][:190])
(out/'javascript-coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
