#!/usr/bin/env python3
import gzip,hashlib,io,json,subprocess,tarfile
from pathlib import Path
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
sha=lambda b:hashlib.sha256(b).hexdigest()
freeze='700f424c8a9af222c00be63146016df2417a488d'
required=['predictions.json','authentication.json','recording-audit.json','coverage-audit.json','coverage-waivers.json','hunk-audit.json','profile-reexport.json','native-replay.json','carry-forward.json','fresh-audit.json','sabotage-final.json','citations.json','verdict.json','task-diff.patch','authenticate.py','recording_audit.mjs','coverage_audit.py','fresh_audit.mjs','citations.py','seal.py']
members={name:(OUT/name).read_bytes() for name in required}
for directory in ['final-gpu','final-fault-native-signedness','final-fault-constant-word','final-fault-shader-conversion','facade-replay','facade-v8']:
 for file in sorted((OUT/directory).rglob('*')):
  if file.is_file():members[file.relative_to(OUT).as_posix()]=file.read_bytes()
for name in ['hot-matrix-replay.profraw','hot-allocations-replay.profraw','cold-matrix-replay.profraw','cold-allocations-replay.profraw','final-fault-native-signedness.log','final-fault-constant-word.log','final-fault-shader-conversion.log']:
 members[name]=(OUT/name).read_bytes()
for name in ['renderer/virgl-command/tests/standard-integer-vertex-inputs-adversarial.mjs','tools/virgl-command/standard-integer-adversarial-oracle.mjs']:
 original=subprocess.check_output(['git','show',freeze+':'+name],cwd=ROOT);assert original==(ROOT/name).read_bytes();members['sources/'+name]=original
for row in json.loads((OUT/'final-gpu/report.json').read_text())['sources']:
 members['sources/'+row['path']]=(ROOT/row['path']).read_bytes();assert sha(members['sources/'+row['path']])==row['sha256']
records={'schema':'standard-integer-critic-records-v1','task':'E6-T11d14','workerRuntimeHead':'12bb78e1b7f4b9d636f8d46091b9a1a1766fbe4b','workerSubmission':'b7a9f1c670f8a986941f2e9c287d800578dce4c2','promotedTestHead':freeze,'records':[{'path':name,'bytes':len(data),'sha256':sha(data)} for name,data in sorted(members.items())]}
index=(json.dumps(records,indent=2)+'\n').encode();(OUT/'records.json').write_bytes(index)
archive=io.BytesIO()
with gzip.GzipFile(fileobj=archive,mode='wb',mtime=0) as zipped:
 with tarfile.open(fileobj=zipped,mode='w') as tar:
  for name,data in sorted(members.items()):
   info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;info.mtime=0;tar.addfile(info,io.BytesIO(data))
raw=archive.getvalue();(OUT/'recording.tar.gz').write_bytes(raw)
manifest={'schema':'standard-integer-critic-seal-v1','task':'E6-T11d14','verdict':'verified','workerRuntimeHead':records['workerRuntimeHead'],'workerSubmission':records['workerSubmission'],'promotedTestHead':freeze,'workerArchiveSha256':'a4f79256677d3f5ef6e2de5f1b2c15ca6b85b6b9c7f7ba5ccbb222424459b93a','records':len(members),'recordIndexSha256':sha(index),'archiveSha256':sha(raw),'archiveBytes':len(raw),'guestExecution':False,'productionNegotiation':False,'productionDrawAuthority':False,'portableDomainCertified':False,'authority':'isolated-standard-pure-integer-fetch'}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
