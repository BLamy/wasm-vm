from pathlib import Path
import gzip,hashlib,io,json,tarfile
ROOT=Path.cwd(); V=ROOT/'evidence/virgl-vertex-constant/verifier'
sha=lambda b:hashlib.sha256(b).hexdigest()
final=json.loads((V/'final-audit.json').read_bytes());assert final['verdict']=='verified'
members={}
for path in V.rglob('*'):
    if not path.is_file():continue
    name=path.relative_to(V).as_posix()
    if name.startswith(('unpacked/','__pycache__/'))or'.dSYM/'in name or path.suffix in ['.o','.profdata']or name in ['recording.tar.gz','records.json','manifest.json']:continue
    members[name]=path.read_bytes()
for name in ['renderer/virgl-command/tests/vertex-constant-boundaries.mjs','renderer/virgl-shader/native_tests/tgsi_scratch_boundaries.c']:
    members['promoted/'+name]=(ROOT/name).read_bytes()
index={'schema':'virgl-vertex-constant-critic-records-v1','task':'E6-T11d1','sourceHead':final['sourceHead'],
       'records':[{'path':name,'bytes':len(raw),'sha256':sha(raw)}for name,raw in sorted(members.items())]}
index_bytes=(json.dumps(index,indent=2)+'\n').encode();(V/'records.json').write_bytes(index_bytes)
buffer=io.BytesIO()
with gzip.GzipFile(fileobj=buffer,mode='wb',mtime=0)as gz:
    with tarfile.open(fileobj=gz,mode='w')as tar:
        for name,raw in sorted(members.items()):
            info=tarfile.TarInfo(name);info.size=len(raw);info.mtime=0;info.mode=0o755 if name=='scratch-boundary-test' else 0o644
            tar.addfile(info,io.BytesIO(raw))
packed=buffer.getvalue();(V/'recording.tar.gz').write_bytes(packed)
manifest={'schema':'virgl-vertex-constant-critic-seal-v1','task':'E6-T11d1','verdict':'verified','sourceHead':final['sourceHead'],
 'records':len(members),'archiveBytes':len(packed),'archiveSha256':sha(packed),'recordIndexSha256':sha(index_bytes),
 'workerArchiveSha256':'0438914308a3ccd17516af6a696ad65cfe9afbb5af589afd882ee7cc919c2d3c',
 'finalAuditSha256':sha((V/'final-audit.json').read_bytes()),'coverageAuditSha256':sha((V/'coverage-audit.json').read_bytes()),
 'promotedTests':final['promotedTests'],'predictionResults':final['predictionResults'],'initialP8':final['initialP8'],
 'authority':final['authority'],'guestExecution':False,'productionDrawAuthority':False}
(V/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
