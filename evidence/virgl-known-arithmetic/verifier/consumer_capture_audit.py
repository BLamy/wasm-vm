#!/usr/bin/env python3
"""Check actual state/bank custody and reuse source-derived raw-capture oracle."""
from pathlib import Path
import json,hashlib,subprocess
ROOT=Path(__file__).resolve().parents[3];E=Path(__file__).parent;O=ROOT/'target/evidence/virgl-known-arithmetic-critic';U=O/'unpacked'
sha=lambda b:hashlib.sha256(b).hexdigest()
report={'schema':'virgl-known-arithmetic-critic-owned-consumer-v1','task':'E6-T12g6m1','status':'running','physical':[],'originalMetadata':[],'fourthSourceBindings':[]}
for kind,prefix in [('hot','hot'),('cold','cold/acceptance')]:
 r=json.loads((U/prefix/'consumer.json').read_bytes());assert r['getterInvocations']==0 and len(r['attacks'])==127 and len(r['banks'])==1
 assert all(a['result']['ok']is False for a in r['attacks']);assert all(a['result']['ok']is True for a in r['contracts'])if all('result'in a for a in r['contracts'])else all(a['contract']['ok']is True for a in r['contracts'])
 for b in r['banks']:
  assert all(c['wanted']==c['result']['ok']for c in b['checks'])and b['approved']['words'][0]==0
 report['originalMetadata'].append({'kind':kind,'sourceSha256':sha((U/prefix/'consumer.json').read_bytes()),'policyAttacks':127,'inertGetters':True,'ownedInheritedF2iBank':True})
for path in sorted((U/'hot').glob('gpu-*/report.json'))+sorted((U/'cold/acceptance').glob('gpu-*/report.json'))+[O/'gpu-2654435769/report.json']:
 raw=path.read_bytes();r=json.loads(raw);a=r['acceptance'];captures=[]
 for c in a['consumers']:
  assert [p['observed'][0]for p in c['captures']]==[0x3fc00000,0xc0000000,0]
  for cap in c['captures']:
   state=cap['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants'][1]
   assert cap['observed']==state[:4]
  for submission in c['submissions']:
   assert all(b==255 for b in submission['after'])and any(b!=255 for b in submission['before'])
   if submission['label']=='finite out-of-range bank':assert submission['result']['ok']and submission['result']['appliedCommands']==1
  for d in c['deferredBanks']:
   assert d['word']in[0x4f000000,0xcf000001]and d['result']['ok']and d['prior']==d['observed']==[0,0,0,0]
   assert d['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants'][1][:4]==[d['word'],0,0,0]
  reject=c['rejection'];assert reject['before']==reject['after']and not reject['result']['ok']and reject['result']['appliedCommands']==0
  assert all(n==0 for n in c['finalBudgets'].values())and all(n==0 for n in c['finalResourceBudgets'].values())
  captures.append({'asynchronous':c['asynchronous'],'safeWords':[cap['observed'][0]for cap in c['captures']],'deferredCpuWords':[d['word']for d in c['deferredBanks']],'physicalPriorRetained':True,'atomicNonfiniteRejection':True,'zeroFinalBudgets':True})
 uniform_events=[e['words']for e in a['events']if e['call']=='uniform4uiv'];expected=[w for _ in range(2)for w in [0x3fc00000,0x3fc00000,0xc0000000,0xc0000000,0,0]]
 assert len(uniform_events)==12 and [ws[0]for ws in uniform_events]==expected and all(len(ws)==184 and not any(ws[1:])for ws in uniform_events)
 report['physical'].append({'source':str(path.relative_to(ROOT)),'sourceSha256':sha(raw),'consumers':captures,'actualUniformUploadFirstWords':expected,'actualUnsafeNativeUploads':0,'disposedPhysicalObjects':a['objects']['live']==0})
fourth=json.loads((O/'gpu-2654435769/report.json').read_bytes())
for row in fourth['sources']+fourth['servedFiles']:
 p=ROOT/row['path'];assert sha(p.read_bytes())==row['sha256'];report['fourthSourceBindings'].append(row)
# Evaluate exactly the independently reviewed physical algorithm over the new seed.
source=(E/'independent_oracle.py').read_text();native_begin=source.index('for kind,prefix in');physical_begin=source.index(' for path in sorted(');physical_end=source.index("summary['heldQualifications']")
code=source[:native_begin]+"U=ROOT/'target/evidence/virgl-known-arithmetic-critic'\nfor kind,prefix in [('critic-fourth','')]:\n"+source[physical_begin:physical_end]+"summary['status']='passed'\n(E/'fourth-capture-audit.json').write_text(json.dumps(summary,indent=2)+'\\n')\n"
# source code is verifier-owned and sealed, not instructions from a recording.
exec(compile(code,str(E/'independent_oracle.py')+' (fourth physical audit)','exec'),{'__file__':str(E/'independent_oracle.py')})
report['fourthOracleSha256']=sha((E/'fourth-capture-audit.json').read_bytes());report['status']='passed';(E/'consumer-capture-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print({'status':'passed','physicalSchedules':len(report['physical']),'metadataAttacks':254,'actualUnsafeUploads':0,'fourthSeed':2654435769})
