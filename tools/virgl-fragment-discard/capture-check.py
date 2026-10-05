#!/usr/bin/env python3
"""Check complete raw captures against literal TGSI, including failed faults."""
from pathlib import Path
import hashlib,json,subprocess,sys
from reference import prediction
ROOT=Path(__file__).resolve().parents[2]
def sha(raw):return hashlib.sha256(raw).hexdigest()
def require(value,label):
 if not value:raise ValueError(label)
def main():
 source=Path(sys.argv[1]);out=Path(sys.argv[2]);raw=source.read_bytes();report=json.loads(raw);a=report['acceptance'];fault=a['fault'];seed=a['seed']
 require(report['status']==('failed'if fault else'passed'),'expected physical outcome')
 require(report['browserErrors']==dict(console=[],page=[],requests=[]),'zero browser errors')
 require(a['objects']['live']==0 and a['guestExecution']is False and a['productionNegotiation']is False,'private disposed hardware')
 require(not report['browser']['launch']['headless'] and report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']]=='enabled','physical headed GPU')
 require('Metal'in a['renderer']['renderer'] and not any(s in a['renderer']['renderer'].lower()for s in ['swiftshader','llvmpipe','software']),'physical renderer identity')
 planned=subprocess.check_output(['node','--input-type=module','-e',f"import{{physicalPlan}}from'./tools/virgl-fragment-discard/cases.mjs';process.stdout.write(JSON.stringify(physicalPlan({seed})));"],cwd=ROOT)
 plan=json.loads(planned);require(sha(planned)==a['planSha256'],'literal input schedule')
 require(len(a['probes'])<=len(plan),'bounded probe prefix')
 if not fault:require(len(a['probes'])==len(plan),'whole physical schedule')
 rows=[];pixels=qualifications=0;faults=[]
 def check(probe,wanted,strict):
  observed=bytes(probe['rgbaBytes']);require(sha(observed)==probe['sha256'],'physical byte digest')
  require(len(observed)==len(wanted['points'])*4,'whole framebuffer extent');failures=[];qualified=[]
  for i,p in enumerate(wanted['points']):
   rgba=list(observed[i*4:i*4+4]);expected=p['rgba']
   if rgba!=expected:
    point=dict(x=p['x'],y=p['y'],inside=p['inside'],discarded=p['discarded'],expected=expected,observed=rgba)
    if strict or not p['inside']or rgba not in [[17,34,51,68],[64,128,191,255]]:failures.append(point)
    else:qualified.append(point)
  return dict(name=probe['name'],backend=probe['backend'],pixels=len(wanted['points']),failureCount=len(failures),failures=failures,qualificationCount=len(qualified),qualifications=qualified,rawSha256=probe['sha256'])
 for i,(probe,p)in enumerate(zip(a['probes'],plan)):
  require(all(probe[k]==v for k,v in p.items()),'unchanged source input '+str(i));require(probe['textSha256']==sha(p['text'].encode()),'literal shader digest')
  require(probe['logs']==dict(vertex='',fragment='',link=''),'real shader compilation')
  policy=probe['policy']['discard'];require(probe['pair']['interfaceKey'].endswith('|tgsi-fragment-discard-v1:ordered-any-negative/raw-words/always-'+str(int(policy['alwaysDiscards']))),'checked discard selector')
  if probe.get('bankUpload',{}).get('words'):
   upload=probe['bankUpload'];require(upload['words']==p['words'][:upload['declaredCount']*4] and all(w==0xdeadbeef for w in upload['callerAfter']),'copied uniform words')
   require(upload['observed']==[upload['words'][j*4:j*4+4]for j in range(upload['count'])],'physical raw uniform words')
  row=check(probe,prediction(p),p['backend']=='owned'or p['portablePrimary']);row['sourceIndex']=i;rows.append(row);pixels+=row['pixels'];qualifications+=row['qualificationCount']
  mutation=probe['mutation']
  if mutation:
   require(fault==mutation['kind']and p['backend']=='owned','scoped actual source fault')
   require(mutation['original']==probe['pair']['fragment']['glsl'] and mutation['served']==mutation['original'].replace(mutation['needle'],mutation['replacement'],1) and mutation['served']!=mutation['original'],'actual source bytes changed')
   require(row['failureCount']>0 and probe.get('failure'),'independent exact pixel fault contradiction')
   require(any(e['call']=='shaderSource'and e['source']==mutation['served']for e in a['events']),'changed source physically compiled');faults.append(dict(kind=fault,sourceIndex=i,first=row['failures'][0],servedSha256=sha(mutation['served'].encode())))
  else:require(row['failureCount']==0,'unmodified normative source pixels')
 for consumer in a['consumers']:
  require(consumer['commandsPerStep']==1+seed%3,'varied command budget')
  require(all(v==0 for v in consumer['finalBudgets'].values())and all(v==0 for v in consumer['finalResourceBudgets'].values()),'zero consumer budgets')
  require(len(consumer['captures'])==18 and len(consumer['rejections'])==10,'complete consumer schedule')
  for submission in consumer['submissions']:require(all(v==255 for v in submission['after']),'caller wire ownership')
  for capture in consumer['captures']:
   original=plan[capture['sourceIndex']];require(original['backend']=='owned'and capture['fragmentText']==original['text']and capture['words']==original['words'],'selected literal program')
   expected=dict(original,geometry=dict(original['geometry'],width=32,height=32));row=check(capture,prediction(expected),True);require(row['failureCount']==0,'indexed source pixels');rows.append(row);pixels+=row['pixels']
   program=capture['program'];policy=capture['pair']['fragment']['metadata']['discardContract'];require(program['interfaceKey'].endswith('|tgsi-fragment-discard-v1:ordered-any-negative/raw-words/always-'+str(int(policy['alwaysDiscards']))),'owned terminal policy in cache selector')
   require(program['reflection']['outputs'][0]['location']==0 or policy['alwaysDiscards'],'survivor keeps a physical color output')
   require(capture['drawBuffer']==(0 if program['reflection']['outputs'][0]['location']==-1 else 36064),'owned terminal draw-buffer selection')
  for rejection in consumer['rejections']:
   require(rejection['result']['ok']is False and rejection['result']['appliedCommands']==0 and rejection['before']==rejection['after'],'atomic checked consumer rejection')
   require(all(consumer['asynchronous']and e['call']in ['fenceSync','deleteSync']for e in rejection['nativeEvents']),'rejection before native mutations')
 if fault:
  require(len(faults)==1 and 'independent discard pixel mismatch'in a['failure']['message']and not a['consumers'],'one bounded numerical source fault')
 else:require(len(a['consumers'])==2 and a['checkedPixels']==pixels,'whole direct and consumer pixels')
 result=dict(schema='fragment-discard-capture-check-v1',task='E6-T12g6l',status='passed',gitHead=report['gitHead'],seed=seed,fault=fault,sourceSha256=sha(Path(__file__).read_bytes()),sourceReportSha256=sha(raw),checkedPixels=pixels,qualifications=qualifications,rows=rows,faults=faults)
 out.write_text(json.dumps(result,indent=2)+'\n');print(f'{pixels} literal discard pixels checked; {qualifications} qualified pinned special-value comparisons.')
if __name__=='__main__':main()
