from pathlib import Path
import hashlib,json,re,subprocess,sys
root=Path.cwd();out=root/'target/e9-t07-verifier'
coverage_path=Path(sys.argv[1])
entries=json.loads(coverage_path.read_text())
files=['web/session-store.js','web/session-library.js','web/loader.js','web/roadmap.js','web/gpu-checkpoint-build.js']
report={'coverage':str(coverage_path),'coverage_sha256':hashlib.sha256(coverage_path.read_bytes()).hexdigest(),'offsets':'UTF-16 code units','files':{}}
for name in files:
 source=(root/name).read_text();source_hash=hashlib.sha256(source.encode()).hexdigest()
 matching=[e for e in entries if e.get('source')==source and e.get('url','').endswith('/'+Path(name).name)]
 positives=[];zeroes=[]
 for e in matching:
  if 'ranges' in e:positives.extend((r['start'],r['end']) for r in e['ranges'])
  elif 'functions' in e:
   ranges=[{**r,'detailed':f.get('isBlockCoverage',False)} for f in e['functions'] for r in f['ranges']]
   bounds=sorted({p for x in ranges for p in [x['startOffset'],x['endOffset']]})
   for a,b in zip(bounds,bounds[1:]):
    inside=[x for x in ranges if x['startOffset']<=a and x['endOffset']>=b]
    if inside:
     narrowest=min(inside,key=lambda x:x['endOffset']-x['startOffset'])
     if narrowest['count']>0 and narrowest['detailed']:positives.append((a,b))
  else:raise AssertionError(('unknown entry shape',list(e)))
 diff=subprocess.check_output(['git','diff','--unified=0','a68779f5..2c9c0a5657dd0ab0d2a7d3a72f2c9742cd90521b','--',name],text=True)
 added=set()
 for m in re.finditer(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@',diff,re.M):
  first=int(m[1]);count=int(m[2])if m[2]is not None else 1;added.update(range(first,first+count))
 rows=[];offset=0
 for number,line in enumerate(source.splitlines(keepends=True),1):
  length=len(line.encode('utf-16-le'))//2
  if number in added:
   code=line.strip();blank=not code or code.startswith('//') or code in ('}','},','});',');','});','else','try {')
   leading=len(line[:len(line)-len(line.lstrip())].encode('utf-16-le'))//2
   start=offset+leading;end=offset+length-len(line[len(line.rstrip()):].encode('utf-16-le'))//2
   intervals=sorted((max(a,start),min(b,end))for a,b in positives if a<end and b>start)
   merged=[]
   for a,b in intervals:
    if not merged or a>merged[-1][1]:merged.append([a,b])
    else:merged[-1][1]=max(merged[-1][1],b)
   covered=sum(b-a for a,b in merged)
   rows.append({'line':number,'start':start,'end':end,'covered_units':covered,'code_units':max(0,end-start),'ignored_syntax':blank,'text':code,'hit':covered>0})
  offset+=length
 report['files'][name]={'source_sha256':source_hash,'matching_entries':len(matching),'changed_lines':len(added),'unhit':[r for r in rows if not r['hit']and not r['ignored_syntax']],'partial':[r for r in rows if r['hit']and r['covered_units']<r['code_units']and not r['ignored_syntax']],'rows':rows}
(out/'coverage-audit.json').write_text(json.dumps(report,indent=2)+'\n')
for name,item in report['files'].items():
 print(name,'matching documents',item['matching_entries'],'changed lines',item['changed_lines'],'unhit',len(item['unhit']),'partial',len(item['partial']))
 for row in item['unhit']:print(' UNHIT',row['line'],row['text'])
 for row in item['partial']:print(' PARTIAL',row['line'],str(row['covered_units'])+'/'+str(row['code_units']),row['text'])
