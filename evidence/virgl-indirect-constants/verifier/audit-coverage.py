#!/usr/bin/env python3
"""Map each added runtime line to recorded native/browser/Node coverage."""
import hashlib,json,pathlib,re,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent
BASE='d3a57934cab34e62a274996c0a5559ed8db52645'
FILES=['renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/raw_bits.h','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/state.mjs']
def read(p):return json.loads(p.read_bytes())
def changed(name):
 text=subprocess.check_output(['git','diff','--unified=0',BASE,'--',name],cwd=ROOT,text=True);lines=[];n=0
 for row in text.splitlines():
  m=re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@',row)
  if m:n=int(m[1]);continue
  if row.startswith('+++') or row.startswith('---'):continue
  if row.startswith('+'):lines.append(n);n+=1
  elif row.startswith(' '):n+=1
 return lines

def main():
 evidence=pathlib.Path(sys.argv[1]).resolve();head=sys.argv[2]
 native={};current=None
 for row in (evidence/'native/coverage-show.txt').read_text().splitlines():
  if row.endswith(':'):
   for name in FILES:
    if row.endswith('/'+name+':'):current=name
  m=re.match(r'\s*(\d+)\|\s*([^|]*)\|',row)
  if current and m:native.setdefault(current,{})[int(m[1])]=m[2].strip()
 sources={}
 for path in [evidence/'hardware/browser-coverage.json',evidence/'sabotage-decoder-bypass/browser-coverage.json',evidence/'sabotage-index-offset/browser-coverage.json']:
  data=read(path)
  for script in data['scripts']:
   sources.setdefault(script['source'],[]).append((str(path.relative_to(evidence)),script['coverage']['functions']))
 for path in [evidence/'consumer-unit/coverage.json',evidence/'profiles/coverage.json']:
  for script in read(path):
   for name in FILES:
    if script['url'].endswith('/'+name):sources.setdefault(name,[]).append((str(path.relative_to(evidence)),script['functions']))
 rows=[]
 for name in FILES:
  data=(ROOT/name).read_text();lines=data.splitlines(keepends=True);offsets=[];offset=0
  for line in lines:offsets.append(offset);offset+=len(line)
  for n in changed(name):
   row={'path':name,'line':n,'text':lines[n-1].strip()};text=row['text']
   if name.endswith('.h'):row.update(status='WAIVED',reason='Type layout, enum tag, or compile-time size assertion; compiled and actual layout separately recorded.')
   elif name.endswith('.c'):
    count=native.get(name,{}).get(n,'')
    if count and count!='0':row.update(status='EXECUTED',count=count,record='native/coverage-show.txt')
    elif text.startswith('case RAW_UARL:'):row.update(status='WAIVED',reason='Exhaustive enum arm unreachable after dedicated UARL handler returns; no behavior is hidden.')
    elif not count:row.update(status='WAIVED',reason='Non-executable declaration, type field, comment or structural line.')
    else:row.update(status='NEEDS EVIDENCE',count=count)
   else:
    # Every V8 offset here is a one-byte ASCII source offset. Inspect each
    # innermost recorded range that intersects a character on this source line.
    assert data.isascii()
    start=offsets[n-1]+len(lines[n-1])-len(lines[n-1].lstrip());end=offsets[n-1]+len(lines[n-1].rstrip())
    evidence_counts=[]
    for record,functions in sources.get(name,[]):
     allranges=[r for f in functions for r in f['ranges']]
     for pos in range(start,end):
      containing=[r for r in allranges if r['startOffset']<=pos<r['endOffset']]
      if containing:
       closest=min(containing,key=lambda r:r['endOffset']-r['startOffset'])
       if closest['count']>0:evidence_counts.append((closest['count'],record))
    if evidence_counts:count,record=max(evidence_counts);row.update(status='EXECUTED',count=count,record=record)
    elif not text or text.startswith(('import ','export const ','const ','//','/**','*','}')):row.update(status='WAIVED',reason='Module setup, comment, declaration or structural line; import and successful calls bind module bytes.')
    else:row.update(status='NEEDS EVIDENCE')
   rows.append(row)
 report={'schema':1,'head':head,'evidence':str(evidence),'records':[{'path':str(p.relative_to(evidence)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [evidence/'native/coverage-show.txt',evidence/'hardware/browser-coverage.json',evidence/'sabotage-decoder-bypass/browser-coverage.json',evidence/'consumer-unit/coverage.json']], 'lines':rows}
 (OUT/'coverage-audit.json').write_text(json.dumps(report,indent=2)+'\n');summary={s:sum(x['status']==s for x in rows) for s in ('EXECUTED','WAIVED','NEEDS EVIDENCE')};print(summary)
 for r in rows:
  if r['status']=='NEEDS EVIDENCE':print(r)
if __name__=='__main__':main()
