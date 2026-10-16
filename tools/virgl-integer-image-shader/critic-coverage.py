import hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__import__('sys').argv[1]).resolve();OUT.mkdir(parents=True,exist_ok=True);W=OUT/'worker';SRC=W/'source';BASE='d8d510a689cfb5440cc8b3b65fd94adb9baee109';HEAD='3c0a3e348048c0ff293a6b67638a96fb5c3561cb';sha=lambda b:hashlib.sha256(b).hexdigest()
def need(v,why):
 if not v:raise AssertionError(why)
def added(files):
 diff=subprocess.check_output(['git','diff','--unified=0',BASE,HEAD,'--',*files],cwd=ROOT,text=True);result={};name=None
 for row in diff.splitlines():
  if row.startswith('+++ b/'):name=row[6:]
  elif row.startswith('@@'):line=int(re.search(r'\+(\d+)',row)[1])
  elif row.startswith('+') and name:result.setdefault(name,[]).append(line);line+=1
  elif row.startswith(' '):line+=1
 return result
js_added=added(['renderer/virgl-shader/standard.mjs']);c_added=added(['renderer/virgl-shader/'+n for n in ['bridge.c','standard_emit.c','standard_guard.c','standard_guard.h']])
def js_audit(directory):
 scripts=[]
 for p in directory.rglob('browser-coverage.json'):
  if 'fault-' in str(p):continue
  for row in json.loads(p.read_text())['scripts']:
   if row['source'] in js_added:need(sha((SRC/row['source']).read_bytes())==row['sha256'],'served V8 source digest');scripts.append((p,row['source'],row['coverage']))
 for p in (directory/'node-coverage').glob('*.json'):
  for script in json.loads(p.read_text())['result']:
   for name in js_added:
    if script['url'].endswith('/'+name):scripts.append((p,name,script))
 records=[]
 for name,lines in js_added.items():
  source=(SRC/name).read_text();offsets=[0]
  for row in source.splitlines(keepends=True):offsets.append(offsets[-1]+len(row.encode('utf-16-le'))//2)
  ranges=[(p,[(r['startOffset'],r['endOffset'],r['count']) for f in script['functions'] for r in f['ranges']]) for p,n,script in scripts if n==name]
  for line in lines:
   start,end=offsets[line-1],offsets[line];edges=sorted({start,end}|{n for p,rs in ranges for a,b,c in rs for n in [a,b] if start<n<end})
   for a,b in zip(edges,edges[1:]):
    observations=[]
    for path,rs in ranges:
     governing=sorted((r for r in rs if r[0]<=a and b<=r[1]),key=lambda r:r[1]-r[0])
     if governing:observations.append({'path':path.relative_to(W).as_posix(),'start':governing[0][0],'end':governing[0][1],'count':governing[0][2]})
    need(observations and max(o['count'] for o in observations)>0,'unexecuted smallest V8 region '+str((name,line,a,b)));records.append({'source':name,'line':line,'start':a,'end':b,'governing':observations})
 return records

def native_audit(directory):
 functions=[]
 for p in (directory/'coverage').glob('*.json'):
  for fn in json.loads(p.read_text())['data'][0]['functions']:
   if any(any(path.endswith('/'+name) for name in c_added) for path in fn['filenames']):functions.append((p,fn))
 records=[];waivers=[]
 for name,lines in c_added.items():
  source=(SRC/name).read_text();offsets=[0]
  for row in source.splitlines(keepends=True):offsets.append(offsets[-1]+len(row))
  scopes=[]
  for path,fn in functions:
   rs=[]
   for r in fn['regions']:
    if r[7]!=0 or not fn['filenames'][r[5]].endswith('/'+name):continue
    a,b=offsets[r[0]-1]+r[1]-1,offsets[r[2]-1]+r[3]-1
    if a<b:rs.append((a,b,r[4]))
   if rs:scopes.append((path,fn['name'],rs))
  for line in lines:
   start,end=offsets[line-1],offsets[line];edges=sorted({start,end}|{n for path,fn,rs in scopes for a,b,c in rs for n in [a,b] if start<n<end})
   for a,b in zip(edges,edges[1:]):
    code=source[a:b]
    if not code.strip():continue
    observations=[]
    for path,fn,rs in scopes:
     governing=sorted((r for r in rs if r[0]<=a and b<=r[1]),key=lambda r:r[1]-r[0])
     if governing:observations.append({'path':path.relative_to(W).as_posix(),'function':fn,'start':governing[0][0],'end':governing[0][1],'count':governing[0][2]})
    record={'source':name,'line':line,'start':a,'end':b,'text':code,'governing':observations}
    if not observations:
     need('(' in code and (code.lstrip().startswith('static') or code.lstrip().startswith('const char')) or name.endswith('.h') and (code.lstrip().startswith(('enum','uint8_t','bool','/*','static')) or code.lstrip().startswith('uint32_t')) or code.lstrip().startswith(('bool integer_images','bool uniform_buffers','uint32_t signed_inputs','uint32_t signed_colors','const char *fragment_text','uint32_t packed_signed_inputs','uint32_t buffer_zero_mask')),'non-declaration waiver '+str(record));waivers.append(record)
    else:need(max(o['count'] for o in observations)>0,'unexecuted smallest LLVM region '+str((name,line,a,b)));records.append(record)
 return records,waivers

def main():
 audits=[]
 for prefix in ['hot','cold']:
  directory=W/prefix;js=js_audit(directory);native,waivers=native_audit(directory);need(len(js)==145 and len(native)==367 and len(waivers)==20,'independent complete coverage counts')
  su={}
  for p in (directory/'stack').glob('*.su'):
   for row in p.read_text().splitlines():
    fields=row.split('\t');need(fields[2]=='static','unbounded frame');su[fields[0].rsplit(':',1)[-1]]=int(fields[1])
  stacks={}
  for mode,entry in [('stage','standard_stage'),('pair','standard_pair')]:
   frames={n:su[n] for n in [entry,'standard_convert','vrend_convert_shader','standard_emit']};total=sum(frames.values());need(total<262144,'fixed actual optimized frame ceiling');stacks[mode]={'frames':frames,'conservativeBytes':total}
  helpers={}
  for p in (directory/'stack').glob('*.su'):
   if p.name not in ['standard_guard.su','standard_emit.su','checked_upstream.su']:continue
   for row in p.read_text().splitlines():
    fields=row.split('\t');name=fields[0].rsplit(':',1)[-1]
    if name not in ['vrend_convert_shader','vrend_shader_create_passthrough_tcs','standard_emit']:helpers[name]=int(fields[1])
  upper=stacks['pair']['conservativeBytes']+sum(helpers.values());need(upper<262144,'conservative selected path plus all measured bounded helpers');audits.append({'prefix':prefix,'javascriptPartitions':js,'nativePartitions':native,'declarationWaivers':waivers,'stack':stacks,'extraHelperFrames':helpers,'extraHelperConservativePairBytes':upper})
 result={'schema':'d32-independent-complete-nested-coverage-v1','status':'HELD','sourceHead':HEAD,'base':BASE,'audits':audits};(OUT/'coverage.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'HELD','counts':[{'prefix':a['prefix'],'js':len(a['javascriptPartitions']),'native':len(a['nativePartitions']),'waivers':len(a['declarationWaivers']),'conservativePairWithHelpers':a['extraHelperConservativePairBytes']} for a in audits]}))
if __name__=='__main__':main()
