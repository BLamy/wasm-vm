import subprocess,pathlib,re,json
root=pathlib.Path(__file__).resolve().parents[3];parent='62e90790d5c6f0a5da5fa528c482679c16c74290';files=['renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c'];records=[]
cov={};current=None
for text in (root/'evidence/virgl-bounded-loops/worker/native/coverage-show.txt').read_text().splitlines():
 if text.endswith('.c:'):current=str(pathlib.Path(text[:-1]).relative_to(root));cov[current]={}
 m=re.match(r'\s*(\d+)\|\s*([^|]*)\|(.*)',text)
 if m and current:cov[current][int(m[1])]={'count':m[2].strip(),'source':m[3]}
for file in files:
 diff=subprocess.check_output(['git','diff','--unified=0',parent,'--',file],cwd=root,text=True);changed=[];line=None
 for x in diff.splitlines():
  m=re.match(r'@@ .*\+(\d+)(?:,(\d+))? @@',x)
  if m:line=int(m[1]);continue
  if line is None:continue
  if x.startswith('+'):changed.append(line);line+=1
  elif not x.startswith('-') and not x.startswith('\\'):line+=1
 rows=[{'line':line,**cov[file].get(line,{'count':'','source':''})} for line in changed]
 zeros=[r for r in rows if r['count']=='0'];records.append({'file':file,'changedLines':len(changed),'instrumented':sum(bool(r['count']) for r in rows),'hitLines':sum(bool(r['count']) and r['count']!='0' for r in rows),'zero':zeros,'lines':rows})
 print(file,'changed',len(changed),'zero',json.dumps(zeros,indent=2))
(pathlib.Path(__file__).resolve().parent / 'coverage-audit.json').write_text(json.dumps(records,indent=2)+'\n')
