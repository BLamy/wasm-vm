#!/usr/bin/env python3
"""Fresh critic authenticates every immutable worker member and source binding."""
from pathlib import Path,PurePosixPath
import hashlib,json,subprocess,tarfile
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'target/evidence/virgl-known-arithmetic-critic'
EVID=Path(__file__).parent
SOURCE='cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee'
BASE='bfd5c97f7d71f510fccd2bd120f43b3d8b54159f'
WORKER=ROOT/'evidence/virgl-known-arithmetic/worker'
def sha(b):return hashlib.sha256(b).hexdigest()
def check(v,label):
 if not v:raise AssertionError(label)
expected={'manifest.json':'e211633f326cd8e43e37a1585d9c892f84fa8d1eea5f13ac00bcf98d4104d15f','records.json':'67a4726f63fe00ab9fd9f9c708c26ea89d47dff988aeb53fd6dd169d3fe017b0','recording.tar.gz':'cde41a7216f85761baf09b9b8646777e8703f1f449b0af270b31daf87a3813aa'}
for n,h in expected.items():check(sha((WORKER/n).read_bytes())==h,n)
m=json.loads((WORKER/'manifest.json').read_bytes());idx=json.loads((WORKER/'records.json').read_bytes())
check(m['sourceHead']==idx['sourceHead']==SOURCE and m['base']==BASE,'source/base')
check(m['records']==len(idx['records'])==100,'100 original members')
check(len((WORKER/'recording.tar.gz').read_bytes())==m['archive']['bytes'],'archive bytes')
check(len((WORKER/'records.json').read_bytes())==m['recordIndex']['bytes'],'index bytes')
records={r['path']:r for r in idx['records']};check(len(records)==100,'unique index')
unpacked=OUT/'unpacked';unpacked.mkdir(parents=True,exist_ok=True)
with tarfile.open(WORKER/'recording.tar.gz') as tar:
 check(len(tar.getmembers())==100 and set(tar.getnames())==set(records),'complete archive inventory')
 for member in tar.getmembers():
  check(member.isfile() and not PurePosixPath(member.name).is_absolute() and '..' not in PurePosixPath(member.name).parts,'safe original member '+member.name)
  raw=tar.extractfile(member).read();r=records[member.name]
  check(len(raw)==r['bytes'] and sha(raw)==r['sha256'],'member '+member.name)
  dst=unpacked/member.name;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(raw)
  if member.name.endswith(('/known-test','/virgl-shader')):dst.chmod(0o755)
report={'schema':'virgl-known-arithmetic-critic-authentication-v1','task':'E6-T12g6m1','sourceHead':SOURCE,'base':BASE,'status':'running','worker':expected,'members':idx['records'],'recordings':[]}
source_cache={}
for kind,prefix,generated,receipt_hash in [('hot','hot','generated',m['hotReceiptSha256']),('cold','cold/acceptance','cold-generated',m['coldReceiptSha256'])]:
 receipt_raw=(unpacked/prefix/'receipt.json').read_bytes();check(sha(receipt_raw)==receipt_hash,'original receipt '+kind)
 receipt=json.loads(receipt_raw);check(receipt['status']=='passed' and receipt['gitHead']==SOURCE,'exact receipt head '+kind)
 source_rows=[]
 for s in receipt['sources']:
  name=s['path']
  if name.startswith('renderer/virgl-shader/build/'):
   member=generated+'/'+name.removeprefix('renderer/virgl-shader/build/');raw=(unpacked/member).read_bytes();origin=member
  else:
   if name not in source_cache:source_cache[name]=subprocess.check_output(['git','show',SOURCE+':'+name],cwd=ROOT)
   raw=source_cache[name];origin=SOURCE+':'+name
   check((ROOT/name).read_bytes()==raw,'current committed boundary '+name)
  check(len(raw)==s['bytes'] and sha(raw)==s['sha256'],'receipt source '+kind+' '+name)
  source_rows.append({**s,'authenticatedOrigin':origin})
 for r in receipt['records']:
  raw=(unpacked/prefix/r['path']).read_bytes();check(len(raw)==r['bytes'] and sha(raw)==r['sha256'],'receipt artifact '+kind+' '+r['path'])
  check(records[prefix+'/'+r['path']]['sha256']==r['sha256'],'receipt/index '+kind+' '+r['path'])
 for browser in [f'gpu-{s}' for s in receipt['seeds']]+['fault-word','fault-shadow']:
  b=json.loads((unpacked/prefix/browser/'report.json').read_bytes())
  check(b['gitHead']==SOURCE and b['trackedChanges']==[],'physical browser exact head '+browser)
  for s in b['sources']+b['servedFiles']:
   check(any(x['path']==s['path'] and x['sha256']==s['sha256'] for x in source_rows),'served source lineage '+s['path'])
  cov=b['browserCoverage'];check(records[prefix+'/'+browser+'/'+cov['path']]['sha256']==cov['sha256'],'original V8 lineage')
 report['recordings'].append({'kind':kind,'prefix':prefix,'receiptSha256':sha(receipt_raw),'sourceCount':len(source_rows),'recordCount':len(receipt['records']),'sources':source_rows})
coldraw=(unpacked/'cold/report.json').read_bytes();cold=json.loads(coldraw)
check(sha(coldraw)==m['coldReportSha256'],'cold report digest')
check(cold['status']=='passed' and cold['gitHead']==cold['cloneHead']==SOURCE and cold['exitCode']==0 and cold['statusBefore']==cold['statusAfter']=='','pristine exact-head clone')
check(cold['receiptSha256']==m['coldReceiptSha256'] and sha((unpacked/'cold/cold.log').read_bytes())==cold['logSha256'],'cold proof logs')
report['pristine']=cold
report['submissionDelta']=subprocess.check_output(['git','diff','--name-only',SOURCE+'..5c6daa5fd87bccc7dc39398b6f6ba6d22991585c'],cwd=ROOT,text=True).splitlines()
check(not any(n.startswith(('renderer/','tools/')) or n=='Makefile' for n in report['submissionDelta']),'source frozen at submission')
report['status']='passed'
(EVID/'authentication.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'members':len(records),'sources':[r['sourceCount'] for r in report['recordings']],'coldPristine':True,'output':str(EVID/'authentication.json')}))
