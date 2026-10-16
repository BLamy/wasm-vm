#!/usr/bin/env python3
import hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent;NATIVE=ROOT/'evidence/virgl-structured-conditionals/worker/native'
HEAD='242ad5705dbdfd07b269c3e5850857c893af41e7';PARENT='26ed74a31e0ee3c1d43b4e174c8096d67898d920'
report=json.loads((NATIVE/'native-report.json').read_bytes());export=json.loads((NATIVE/'coverage.json').read_bytes());show=(NATIVE/'coverage-show.txt').read_text()
linecounts={};current=None
for line in show.splitlines():
 if line.startswith(str(ROOT)) and line.endswith(':'):current=str(Path(line[:-1]).relative_to(ROOT));linecounts[current]={}
 m=re.match(r'\s*(\d+)\|\s*([^|]*)\|(.*)',line)
 if m and current:linecounts[current][int(m[1])]=(m[2].strip(),m[3])
summary=[]
for file in ['renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c']:
 diff=subprocess.check_output(['git','diff','--unified=0',PARENT,HEAD,'--',file],cwd=ROOT,text=True);added=[];at=0
 for line in diff.splitlines():
  if line.startswith('@@'):at=int(re.search(r'\+(\d+)',line).group(1))
  elif line.startswith('+++'):pass
  elif line.startswith('+'):added.append(at);at+=1
  elif not line.startswith('-'):at+=1
 observed=[{'line':i,'count':linecounts[file][i][0],'source':linecounts[file][i][1]} for i in added]
 unhit=[r for r in observed if r['count']=='0']
 expected=[201,202,203] if file.endswith('raw_bits.c') else []
 assert [r['line'] for r in unhit]==expected,unhit
 branches=[r for f in export['data'][0]['files'] if f['filename']==str(ROOT/file) for r in f['branches'] if r[0] in added]
 missed=[r for r in branches if 0 in r[4:6]]
 # The only new unexecuted regions are exhaustive switch labels after the earlier return.
 assert all(r[0] in expected for r in missed),missed
 summary.append({'path':file,'sha256':hashlib.sha256((ROOT/file).read_bytes()).hexdigest(),'addedLines':observed,'changedBranchCounters':branches,'unexecutedBranches':missed,'waivers':[{'line':r['line'],'reason':'Exhaustive opcode switch label is unreachable: raw_record returns for all structured opcodes before reaching any destination-lane switch. The destination-free path has a positive recorded execution count.'} for r in unhit],'nonExecutableLines':'Blank lines, comments, declarations, function signatures and static layout bound assertions have no execution counter; compiled by guard and native/Wasm builds.'})
result={'sourceHead':HEAD,'parent':PARENT,'coverageSha256':hashlib.sha256((NATIVE/'coverage.json').read_bytes()).hexdigest(),'sourceBindings':report['coverage']['sources'],'files':summary}
(OUT/'coverage-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','changedBranches':sum(len(x['changedBranchCounters']) for x in summary),'unhitExecutableLines':[(f['path'],w['line']) for f in summary for w in f['waivers']]}))
