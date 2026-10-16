#!/usr/bin/env python3
"""Seal the fresh point critic's predictions, audits and native GPU recordings."""
from pathlib import Path
import gzip,hashlib,io,json,subprocess,tarfile
ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
DATA=ROOT/'target/evidence/virgl-standard-points-critic'
def sha(raw):return hashlib.sha256(raw).hexdigest()
members={};sources={}
def add(name,raw):
 assert name not in members;members[name]=raw
for name in ['predictions.json','authentication.json','checks.json','coverage-audit.json','independent-replay.json','novel-replay.json','verdict.json']:
 add(name,(DATA/name).read_bytes())
for directory in ['novel','fault-size-selection','fault-coord-y','recurrence']:
 for p in sorted((DATA/directory).rglob('*')):
  if p.is_file():add(p.relative_to(DATA).as_posix(),p.read_bytes())
for name in ['authenticate.py','coverage_audit.py','seal.py']:
 add(name,(HERE/name).read_bytes())
for name in ['renderer/virgl-command/tests/standard-native-points-adversarial.mjs','tools/virgl-command/standard-point-adversarial-oracle.mjs','tools/virgl-command/standard-point-verifier.mjs','tools/verify-virgl-standard-points-adversarial.sh']:
 raw=(ROOT/name).read_bytes();sources[name]=sha(raw);add('promoted-source/'+name,raw)
for directory in ['novel','fault-size-selection','fault-coord-y','recurrence/novel','recurrence/fault-size-selection','recurrence/fault-coord-y']:
 report=json.loads(members[directory+'/report.json']);fault='/fault-' in '/'+directory
 assert report['status']==('failed' if fault else 'passed') and report['gitHead']=='3d9cfcd03f2eabe900c50173242834aa6ce5f0e6'
 assert report['browserErrors']=={'console':[],'page':[],'requests':[]}
 served={r['path']:r['sha256'] for r in report['servedFiles']};mutation=report.get('mutation')
 for row in report['sources']:
  assert sha((ROOT/row['path']).read_bytes())==row['sha256'],row['path'];sources[row['path']]=row['sha256']
  if '/'+row['path'] in served:assert served['/'+row['path']]==(mutation['servedSha256'] if mutation and row['path']==mutation['path'] else row['sha256'])
 result=report['partial'] if fault else report['browserResult']['result']
 assert len(result['frames'])==(1 if fault else 14)
 for blob in result['blobs']:
  packed=members[directory+'/'+blob['path']];raw=gzip.decompress(packed)
  assert sha(packed)==blob['gzipSha256'] and sha(raw)==blob['sha256'] and len(raw)==blob['bytes']
 if fault:
  assert result['frames'][0]['history'][-1]['result']['gpuComplete'] and result['frames'][0]['native']['calls'] and not result['frames'][0]['audit']['held']
  original=(ROOT/mutation['path']).read_bytes();actual=members[directory+'/mutation-source.mjs']
  assert sha(original)==mutation['originalSha256'] and sha(actual)==mutation['servedSha256'] and original.replace(mutation['needle'].encode(),mutation['replacement'].encode())==actual
 else:
  assert all(r['held'] for r in result['predictions']) and len(result['rejections'])==2
 assert sha(members[directory+'/'+report['screenshot']['path']])==report['screenshot']['sha256']
 assert sha(members[directory+'/'+report['browserCoverage']['path']])==report['browserCoverage']['sha256']
worker=json.loads((ROOT/'evidence/virgl-standard-points/worker/manifest.json').read_text())
assert json.loads(members['authentication.json'])['archiveSha256']==worker['archiveSha256']
assert json.loads(members['verdict.json'])['verdict']=='verified'
index={'schema':'virgl-standard-points-critic-records-v1','task':'E6-T11d11','workerSubmission':'3d9cfcd03f2eabe900c50173242834aa6ce5f0e6','records':[{'path':n,'bytes':len(b),'sha256':sha(b)} for n,b in sorted(members.items())]}
rawindex=(json.dumps(index,indent=2)+'\n').encode();(HERE/'records.json').write_bytes(rawindex)
archive=io.BytesIO()
with gzip.GzipFile(fileobj=archive,mode='wb',mtime=0) as stream:
 with tarfile.open(fileobj=stream,mode='w') as tar:
  for name,raw in sorted(members.items()):
   info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o644;info.mtime=0;tar.addfile(info,io.BytesIO(raw))
packed=archive.getvalue();(HERE/'recording.tar.gz').write_bytes(packed)
manifest={'schema':'virgl-standard-points-critic-seal-v1','task':'E6-T11d11','verdict':'verified','sourceHead':'3d9cfcd03f2eabe900c50173242834aa6ce5f0e6','workerArchiveSha256':worker['archiveSha256'],'records':len(members),'archiveSha256':sha(packed),'archiveBytes':len(packed),'recordIndexSha256':sha(rawindex),'sources':sources,'guestExecution':False,'productionNegotiation':False,'productionDrawAuthority':False,'authority':'isolated-standard-native-points','reopenedAllWorkerRecords':True}
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for name in ['predictions.json','authentication.json','checks.json','coverage-audit.json','independent-replay.json','novel-replay.json','verdict.json']:(HERE/name).write_bytes(members[name])
with tarfile.open(HERE/'recording.tar.gz','r:gz') as tar:
 actual={m.name:tar.extractfile(m).read() for m in tar}
assert actual==members
print(json.dumps({k:manifest[k] for k in ['verdict','records','archiveSha256','recordIndexSha256','archiveBytes']}))
