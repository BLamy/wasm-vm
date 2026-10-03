import json,re,subprocess,pathlib,hashlib
root=pathlib.Path.cwd();base='5561bf3d8a16d2e847b7772909bf772f2c8c57d5';out=root/'evidence/virgl-constant-domains/verifier'
files=['renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs'];result=[]
for name in files:
 source=(root/name).read_text();lines=source.splitlines(keepends=True);starts=[];offset=0
 for line in lines:starts.append(offset);offset+=len(line)
 scripts=[]
 for p in (root/'evidence/virgl-constant-domains/worker').rglob('*coverage.json'):
  data=json.loads(p.read_text())
  candidates=[x.get('coverage',x) for x in data.get('scripts',data.get('result',[]))]
  for script in candidates:
   if script.get('url','').endswith('/'+name):
    # Fault-mutated source offsets are not used to prove original source.
    if '/sabotage/' in str(p) or '/decoder-bypass/' in str(p) or 'sabotage-' in str(p):continue
    scripts.append((str(p.relative_to(root)),script))
 diff=subprocess.check_output(['git','diff','--unified=0',base,'HEAD','--',name],text=True)
 added=[];current=None
 for line in diff.splitlines():
  if line.startswith('@@'):current=int(re.search(r'\+(\d+)',line).group(1))
  elif current is None or line.startswith('+++') or line.startswith('---'):continue
  elif line.startswith('+'):added.append(current);current+=1
  elif not line.startswith('-') and not line.startswith('\\'):current+=1
 entries=[]
 for num in added:
  line=lines[num-1];a=starts[num-1];b=a+len(line);tokens=[a+i for i,c in enumerate(line) if not c.isspace()]
  coverage=[]
  for p,s in scripts:
   ranges=[r for f in s['functions'] for r in f['ranges']]
   counts=[]
   for pos in tokens:
    own=[r for r in ranges if r['startOffset']<=pos<r['endOffset']]
    counts.append(min(own,key=lambda r:r['endOffset']-r['startOffset'])['count'] if own else 0)
   coverage.append({'path':p,'minimum':min(counts,default=0),'maximum':max(counts,default=0)})
  entries.append({'line':num,'source':line.rstrip(),'maxMinimum':max([c['minimum'] for c in coverage],default=0),'maxCount':max([c['maximum'] for c in coverage],default=0),'coverage':coverage})
 result.append({'path':name,'sha256':hashlib.sha256(source.encode()).hexdigest(),'scripts':len(scripts),'lines':entries})
(out/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n')
for file in result:
 print(file['path'],'scripts',file['scripts'],'changed lines',len(file['lines']))
 for line in file['lines']:
  if line['maxMinimum']==0:print(line['line'],'max',line['maxCount'],line['source'])
