import subprocess,pathlib,re,json
root=pathlib.Path(__file__).resolve().parents[3];parent='62e90790d5c6f0a5da5fa528c482679c16c74290';worker=root/'evidence/virgl-bounded-loops/worker';coverage=[]
for mode in ['hardware','sabotage-decoder-bypass','indirect-regression/hardware']:
 c=json.loads((worker/mode/'browser-coverage.json').read_text());coverage +=[(x['source'],x['coverage']) for x in c['scripts']]
for x in json.loads((worker/'consumer-unit/coverage.json').read_text()):coverage.append((str(pathlib.Path(x['url'][7:]).relative_to(root)),x))
records=[]
for file in ['renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs']:
 diff=subprocess.check_output(['git','diff','--unified=0',parent,'--',file],cwd=root,text=True);changed=[];line=None
 for x in diff.splitlines():
  m=re.match(r'@@ .*\+(\d+)(?:,(\d+))? @@',x)
  if m:line=int(m[1]);continue
  if line is None:continue
  if x.startswith('+'):changed.append(line);line+=1
  elif not x.startswith('-') and not x.startswith('\\'):line+=1
 lines=(root/file).read_text().splitlines(keepends=True);offsets=[0]
 for x in lines:offsets.append(offsets[-1]+len(x))
 ranges=[[r for fn in c['functions'] for r in fn['ranges']] for path,c in coverage if path==file]
 rows=[]
 for line in changed:
  source=lines[line-1].rstrip();point=offsets[line-1]+len(source)-len(source.lstrip());counts=[]
  for rs in ranges:
   found=[r for r in rs if r['startOffset']<=point<r['endOffset']]
   if found:counts.append(min(found,key=lambda r:r['endOffset']-r['startOffset'])['count'])
  rows.append({'line':line,'bestCount':max(counts or [0]),'source':source})
 zero=[r for r in rows if not r['bestCount']];print(file,'changed',len(rows),'zero',json.dumps(zero,indent=2));records.append({'file':file,'changedLines':len(rows),'zero':zero,'lines':rows})
(pathlib.Path(__file__).resolve().parent / 'js-coverage-audit.json').write_text(json.dumps(records,indent=2)+'\n')
