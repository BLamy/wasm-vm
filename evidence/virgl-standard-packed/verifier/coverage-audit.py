#!/usr/bin/env python3
"""Interrogate full LLVM/V8 regions against added characters, not worker samples."""
from pathlib import Path
import hashlib,json,re,subprocess
from urllib.parse import unquote,urlparse
ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
PRED='23bf410f9e152d53e83e674717c647a4164dcde7'
FREEZE='e7a85906622794c60872876f9d3e80da83df9ccd'
git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT)
sha=lambda b:hashlib.sha256(b).hexdigest()
diff=git('diff','--unified=0',PRED,FREEZE,'--','renderer/virgl-command','renderer/virgl-shader').decode()
added={};name=None;line=0
for row in diff.splitlines():
 if row.startswith('+++ b/'):name=row[6:]
 elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
 elif row.startswith('+') and name:added.setdefault(name,[]).append(line);line+=1
 elif row.startswith(' ') and name:line+=1
sources={n:git('show',FREEZE+':'+n).decode() for n in added}
js={};native={};branches={};records=[];mutated=[]
def rel_source(name):
 # Resolve /private/var and /var symlinks; cold original paths are owned by its cold report.
 p=Path(name).resolve()
 for root in [ROOT,Path(json.loads((HERE/'unpacked/cold/report.json').read_text())['clone']).resolve()]:
  if p.is_relative_to(root):return p.relative_to(root).as_posix()
 return None
def browser_profile(file,receipt=None):
 for script in json.loads(file.read_text())['scripts']:
  n=script['source']
  if n in added and n.endswith('.mjs'):
   expected=sha(sources[n].encode())
   if receipt is not None:assert expected==receipt['sources'][n]
   if script['sha256']!=expected:
    mutated.append(dict(record=file.relative_to(HERE).as_posix(),source=n,sha256=script['sha256']));continue
   assert (ROOT/n).read_bytes()==sources[n].encode(),n
   js.setdefault(n,[]).append((file.relative_to(HERE).as_posix(),script['coverage']))
def node_profile(file,receipt=None):
 for script in json.loads(file.read_text())['result']:
  if not script['url'].startswith('file:'):continue
  n=rel_source(unquote(urlparse(script['url']).path))
  if n in added and n.endswith('.mjs'):
   expected=sha(sources[n].encode())
   if receipt is not None:assert expected==receipt['sources'][n]
   assert (ROOT/n).read_bytes()==sources[n].encode(),n
   js.setdefault(n,[]).append((file.relative_to(HERE).as_posix(),script))
for family in ['hot','cold']:
 base=HERE/'unpacked'/family
 receipt=json.loads((base/'receipt.json').read_text())
 for file in base.rglob('browser-coverage.json'):
  browser_profile(file,receipt)
 for file in (base/'node-coverage').glob('*.json'):
  node_profile(file,receipt)
 for file in [base/'coverage/matrix.json',base/'coverage/allocations.json',base/'compiler-retained/coverage/matrix.json',base/'compiler-retained/coverage/allocations.json']:
  for fn in json.loads(file.read_text())['data'][0]['functions']:
   for row in fn['regions']:
    n=rel_source(fn['filenames'][row[5]])
    if n not in added or row[7] not in [0,3] or not any(row[0]<=ln<=row[2] for ln in added[n]):continue
    key=(n,fn['name'],*row[:4],row[7]);entry=native.setdefault(key,dict(source=n,function=fn['name'],start=row[:2],end=row[2:4],kind=row[7],maxCount=0,records=[]))
    entry['maxCount']=max(entry['maxCount'],row[4]);entry['records'].append(dict(record=file.relative_to(HERE).as_posix(),count=row[4]))
   for row in fn.get('branches',[]):
    n=rel_source(fn['filenames'][row[6]])
    if n not in added or not any(row[0]<=ln<=row[2] for ln in added[n]):continue
    key=(n,fn['name'],*row[:4]);entry=branches.setdefault(key,dict(source=n,function=fn['name'],start=row[:2],end=row[2:4],trueCount=0,falseCount=0,records=[]))
    entry['trueCount']=max(entry['trueCount'],row[4]);entry['falseCount']=max(entry['falseCount'],row[5]);entry['records'].append(file.relative_to(HERE).as_posix())
for file in (HERE/'narrow-node-coverage').glob('*.json'):node_profile(file)
for name in ['narrow-scalar-admission','narrow-packed-smoke']:
 browser_profile(HERE/name/'browser-coverage.json')
for file in (HERE/'promoted').rglob('browser-coverage.json'):browser_profile(file)
intervals=[]
for n,lines in added.items():
 if not n.endswith('.mjs'):continue
 text=sources[n];rows=text.splitlines(keepends=True);offsets=[0]
 for row in rows:offsets.append(offsets[-1]+len(row.encode('utf-16-le'))//2)
 scripts=js.get(n,[])
 boundaries=sorted(set([p for _,s in scripts for fn in s['functions'] for r in fn['ranges'] for p in [r['startOffset'],r['endOffset']]]+offsets))
 for ln in lines:
  a,b=offsets[ln-1],offsets[ln]
  selected=sorted(set([a,b]+[v for v in boundaries if a<v<b]))
  for start,end in zip(selected,selected[1:]):
   fragment=text.encode('utf-16-le')[start*2:end*2].decode('utf-16-le')
   if not fragment.strip():continue
   observed=[]
   for record,script in scripts:
    ranges=[r for fn in script['functions'] for r in fn['ranges'] if r['startOffset']<=start and r['endOffset']>=end]
    if ranges:
     narrow=min(ranges,key=lambda r:r['endOffset']-r['startOffset']);observed.append(dict(record=record,**narrow))
   intervals.append(dict(source=n,line=ln,startOffset=start,endOffset=end,text=fragment.strip(),maxCount=max((r['count'] for r in observed),default=0),records=observed))
report=dict(schema='standard-packed-critic-coverage-v1',sourceFreeze=FREEZE,predecessor=PRED,addedLines=added,
            javascriptIntervals=intervals,llvmRegions=list(native.values()),llvmBranches=list(branches.values()),
            zeroJavascript=[r for r in intervals if not r['maxCount']],zeroLlvm=[r for r in native.values() if not r['maxCount']],
            oneSidedBranches=[r for r in branches.values() if not r['trueCount'] or not r['falseCount']],
            excludedMutatedSourceCounters=mutated)
(HERE/'coverage-regions.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(jsIntervals=len(intervals),llvmRegions=len(native),branches=len(branches),
 zeroJavascript=[dict(source=r['source'],line=r['line'],text=r['text']) for r in report['zeroJavascript']],
 zeroLlvm=[dict(source=r['source'],function=r['function'],start=r['start'],end=r['end'],kind=r['kind']) for r in report['zeroLlvm']],
 oneSided=[dict(source=r['source'],start=r['start'],end=r['end'],true=r['trueCount'],false=r['falseCount']) for r in report['oneSidedBranches']]),indent=2))
