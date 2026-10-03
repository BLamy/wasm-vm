import hashlib,json,pathlib,re,subprocess
O=pathlib.Path(__file__).resolve().parent;R=O.parents[2];F='1ce9b75b182b5411aee9922f329dc898e2a28b4e';B='59f1b924286af70096d9fb19fbdb35b9ec2ed7a1';N=R/'evidence/virgl-numeric-floats/worker/native'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
s=subprocess.check_output(['git','diff','--unified=0',B,F,'--','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/bridge.c'],cwd=R,text=True);changed={};name=None;ln=0
for line in s.splitlines():
 if line.startswith('+++ b/'):name=line[6:];changed[name]=set()
 elif line.startswith('@@'):ln=int(re.search(r'\+(\d+)',line)[1])
 elif line.startswith('+'):changed[name].add(ln);ln+=1
 elif not line.startswith('-'):ln+=1
line_records=[];covered=0;uncovered=[];filename=None
for text in (N/'coverage-show.txt').read_text().splitlines():
 if text.startswith(str(R)) and text.endswith('.c:'):filename=str(pathlib.Path(text[:-1]).relative_to(R));continue
 m=re.match(r'^\s*(\d+)\|\s*([^|]*)\|(.*)',text)
 if not m or filename not in changed or int(m[1]) not in changed[filename]:continue
 number,count,source=int(m[1]),m[2].strip(),m[3]
 if count:
  if count=='0':uncovered.append((filename,number,source))
  else:covered+=1
 line_records.append(dict(file=filename,line=number,count=count,source=source,classification='executed' if count and count!='0' else 'uncovered' if count else 'nonexecutable syntax/comment or continuation of covered expression'))
assert not uncovered,uncovered
export=json.loads((N/'coverage.json').read_text());branches=[]
for f in export['data'][0]['files']:
 name=str(pathlib.Path(f['filename']).relative_to(R))
 for b in f['branches']:
  if b[0] in changed[name]:
   assert b[4]>0 and b[5]>0,(name,b)
   branches.append(dict(file=name,line=b[0],column=b[1],trueCount=b[4],falseCount=b[5]))
report=dict(status='passed',frozenHead=F,changedExecutableLines=covered,changedConditionalRegions=len(branches),conditionalOutcomes=len(branches)*2,lines=line_records,branches=branches,records={p.name:sha(p) for p in [N/'coverage.json',N/'coverage-show.txt',N/'native-report.json']},sources={p:sha(R/p) for p in changed})
(O/'coverage-audit.json').write_text(json.dumps(report,indent=2)+'\n');print({k:report[k] for k in ['status','changedExecutableLines','changedConditionalRegions','conditionalOutcomes']})
