"""Seal source-closed fresh critic evidence without rewriting worker records."""
from pathlib import Path
import gzip,hashlib,io,json,subprocess,tarfile
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2];PHYSICAL=ROOT/'target/evidence/virgl-standard-topology-critic-final'
def sha(b):return hashlib.sha256(b).hexdigest()
verdict=json.loads((HERE/'verdict.json').read_text());assert verdict['verdict']=='verified'
members={}
for name in ['predictions.json','authenticate.py','authentication.json','audit_originals.mjs','original-audit.json','audit_coverage.py','coverage-audit.json','write_verdict.py','verdict.json','seal_critic.py']:
    members['critic/'+name]=(HERE/name).read_bytes()
for p in sorted(PHYSICAL.rglob('*')):
    if p.is_file():members['physical/'+p.relative_to(PHYSICAL).as_posix()]=p.read_bytes()
report=json.loads((PHYSICAL/'hardware/report.json').read_text())
for s in report['sources']:
    raw=(ROOT/s['path']).read_bytes();assert sha(raw)==s['sha256'];members['sources/'+s['path']]=raw
for name in ['Makefile','tools/verify-virgl-standard-topology-adversarial.sh','tools/virgl-command/standard-topology-adversarial-pixels.mjs']:
    members['sources/'+name]=(ROOT/name).read_bytes()
for name in ['renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/cache.mjs','renderer/virgl-command/constant-domain.mjs']:
    assert (ROOT/name).read_bytes()==subprocess.check_output(['git','show','dff28ee8cb1c494a52a6fbb5af872ed377605f66:'+name],cwd=ROOT)
index={'schema':'standard-topology-critic-records-v1','task':'E6-T11d8','runtimeSourceHead':'dff28ee8cb1c494a52a6fbb5af872ed377605f66','workerSubmission':'2d1303bfd1f476ac33eda616ea380f5df52d1e0f','records':[{'path':name,'bytes':len(raw),'sha256':sha(raw)} for name,raw in sorted(members.items())]}
raw_index=(json.dumps(index,indent=2)+'\n').encode();(HERE/'records.json').write_bytes(raw_index)
archive=io.BytesIO()
with gzip.GzipFile(fileobj=archive,mode='wb',mtime=0) as compressed:
    with tarfile.open(fileobj=compressed,mode='w') as tar:
        for name,raw in sorted(members.items()):
            info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o644;info.mtime=0;tar.addfile(info,io.BytesIO(raw))
packed=archive.getvalue();(HERE/'recording.tar.gz').write_bytes(packed)
manifest={'schema':'standard-topology-critic-seal-v1','task':'E6-T11d8','verdict':'verified','authority':'isolated-standard-core-topologies',
 'runtimeSourceHead':index['runtimeSourceHead'],'workerSubmission':index['workerSubmission'],'workerArchiveSha256':'c192468202cec8d341e6074cc241d19d699cde78d58e7361b2e09d58da1ba8cf',
 'records':len(members),'archiveBytes':len(packed),'archiveSha256':sha(packed),'recordIndexSha256':sha(raw_index),
 'predictionsSha256':sha((HERE/'predictions.json').read_bytes()),'verdictSha256':sha((HERE/'verdict.json').read_bytes()),
 'physicalAuditSha256':sha((PHYSICAL/'independent-audit.json').read_bytes()),'physicalFrames':44,'checkedPhysicalPixels':24576,'originalFramesChecked':174,'originalPixelsChecked':100352,
 'guestExecution':False,'productionNegotiation':False,'productionDrawAuthority':False}
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
