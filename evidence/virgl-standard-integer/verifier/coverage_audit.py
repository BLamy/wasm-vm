#!/usr/bin/env python3
import hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent;U=OUT/'unpacked'
sha=lambda b:hashlib.sha256(b).hexdigest()
diff=subprocess.check_output(['git','diff','--unified=0','8037ede91b4c8450e696811d33ac7d34235388ba','12bb78e1b7f4b9d636f8d46091b9a1a1766fbe4b','--','renderer'],cwd=ROOT,text=True)
added={};name=None;line=0
for row in diff.splitlines():
 if row.startswith('+++ b/'):name=row[6:]
 elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
 elif row.startswith('+') and name:added.setdefault(name,[]).append(line);line+=1
 elif row.startswith(' '):line+=1
runtime=[n for n in added if ('/tests/' not in n and '/native_tests/' not in n) and n.endswith(('.c','.h','.mjs'))]
scripts=[];llvm=[]
for prefix in ['hot','cold']:
 d=U/prefix
 for path in d.rglob('browser-coverage.json'):
  for row in json.loads(path.read_text())['scripts']:
   if row['source'] in runtime:
    expected=sha((ROOT/row['source']).read_bytes())
    if row['sha256']==expected:scripts.append((path.relative_to(U).as_posix(),row['source'],row['coverage']))
 for row in json.loads((d/'node-coverage-runtime.json').read_text())['scripts']:
  if row['source'] in runtime and row['sha256']==sha((ROOT/row['source']).read_bytes()):scripts.append((prefix+'/node-coverage-runtime.json',row['source'],row['coverage']))
 for path in [d/'coverage/matrix.json',d/'coverage/allocations.json',d/'compiler-retained/coverage/matrix.json',d/'compiler-retained/coverage/allocations.json']:
  report=json.loads(path.read_text())
  for function in report['data'][0]['functions']:
   names=[n.split('/wasm-vm/',1)[1] if '/wasm-vm/' in n else n for n in function['filenames']]
   for i,n in enumerate(names):
    if n in runtime:llvm.append((path.relative_to(U).as_posix(),n,i,function))
for directory in [OUT/'final-gpu']:
 for row in json.loads((directory/'browser-coverage.json').read_text())['scripts']:
  if row['source'] in runtime and row['sha256']==sha((ROOT/row['source']).read_bytes()):scripts.append((directory.name+'/browser-coverage.json',row['source'],row['coverage']))
for file in (OUT/'facade-v8').glob('*.json'):
 for row in json.loads(file.read_text())['result']:
  for name in runtime:
   if row['url'].endswith('/'+name):scripts.append((file.relative_to(OUT).as_posix(),name,row))
lines=[];ranges={};branches={}
for name in runtime:
 text=(ROOT/name).read_text();text_lines=text.splitlines(keepends=True)
 for line in added[name]:
  if name.endswith('.mjs'):
   offset=len(''.join(text_lines[:line-1]).encode('utf-16-le'))//2+len(text_lines[line-1])-len(text_lines[line-1].lstrip())
   counts=[]
   for record,n,script in scripts:
    if n!=name:continue
    match=[r for fn in script['functions'] for r in fn['ranges'] if r['startOffset']<=offset<r['endOffset']]
    if match:
     r=min(match,key=lambda r:r['endOffset']-r['startOffset']);counts.append({'record':record,**r})
   lines.append({'source':name,'line':line,'maxCount':max((r['count'] for r in counts),default=0),'records':counts})
  else:
   observed=[]
   for record,n,fileid,fn in llvm:
    if n!=name:continue
    regions=[r for r in fn['regions'] if r[5]==fileid and r[7]==0 and r[0]<=line<=r[2]]
    if regions:observed.extend({'record':record,'function':fn['name'],'region':r,'count':r[4]} for r in regions)
   lines.append({'source':name,'line':line,'maxCount':max((r['count'] for r in observed),default=0),'records':observed})
 for record,n,script in scripts:
  if n!=name:continue
  for fn in script['functions']:
   for r in fn['ranges']:
    start=r['startOffset'];end=r['endOffset'];source=text.encode('utf-16-le')[start*2:end*2].decode('utf-16-le')
    first=text.encode('utf-16-le')[:start*2].decode('utf-16-le').count('\n')+1;last=first+source.count('\n')
    if any(first<=line<=last for line in added[name]):
     key=(name,start,end);old=ranges.setdefault(key,{'source':name,'start':first,'end':last,'snippet':source[:250],'maxCount':0,'records':[]})
     old['maxCount']=max(old['maxCount'],r['count']);old['records'].append({'record':record,'count':r['count'],'function':fn['functionName']})
 for record,n,fileid,fn in llvm:
  if n!=name:continue
  for b in fn['branches']:
   if b[6]!=fileid or not any(b[0]<=line<=b[2] for line in added[name]):continue
   key=(name,tuple(b[:4]));old=branches.setdefault(key,{'source':name,'span':b[:4],'maxTrue':0,'maxFalse':0,'records':[]})
   old['maxTrue']=max(old['maxTrue'],b[4]);old['maxFalse']=max(old['maxFalse'],b[5]);old['records'].append({'record':record,'function':fn['name'],'true':b[4],'false':b[5]})
report={'schema':'standard-integer-critic-full-coverage-v1','runtimeSources':runtime,'addedLines':added,'lines':lines,'V8Regions':list(ranges.values()),'LLVMBranches':list(branches.values()),'unhitV8':[r for r in ranges.values() if not r['maxCount']],'oneSidedLLVM':[b for b in branches.values() if not b['maxTrue'] or not b['maxFalse']]}
(OUT/'coverage-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'runtimeSources':runtime,'addedLines':len(lines),'zeroLines':[ {k:v for k,v in row.items() if k!='records'} for row in lines if not row['maxCount']],'unhitV8':[ {k:v for k,v in row.items() if k!='records'} for row in report['unhitV8']],'oneSidedLLVM':[ {k:v for k,v in row.items() if k!='records'} for row in report['oneSidedLLVM']]}))
