#!/usr/bin/env python3
"""Seal this independent verifier's supplemental probes; worker archives stay separate."""
from pathlib import Path
import gzip,hashlib,io,json,tarfile,subprocess
ROOT=Path.cwd();BASE=Path(__file__).resolve().parent;OUT=ROOT/'target/evidence/virgl-standard-uniform-offset-critic';sha=lambda raw:hashlib.sha256(raw).hexdigest()
assert json.loads((BASE/'verdict.json').read_text())['verdict']=='verified'
files={}
for source in sorted(OUT.rglob('*')):
 if not source.is_file():continue
 name=source.relative_to(OUT).as_posix()
 if name.startswith('unpacked/') or '.dSYM/'in name or '/__pycache__/'in '/'+name:continue
 if source.suffix=='.profdata'and name.startswith(('hot-','cold-')):continue
 assert not source.is_symlink()
 files[name]=source.read_bytes()
for source in [ROOT/'Makefile',*sorted((ROOT/'tools/virgl-standard-uniform/adversarial').glob('*'))]:
 assert source.is_file()and not source.is_symlink();files['promoted/'+source.relative_to(ROOT).as_posix()]=source.read_bytes()
files['runtime/renderer/virgl-shader/standard_guard.c']=subprocess.check_output(['git','show','d3e0dc04431b64f7585565fdbf0a9c5065078152:renderer/virgl-shader/standard_guard.c'],cwd=ROOT)
for name in ['hot/receipt.json','cold/receipt.json','cold/report.json','sealing/seal-test.log']:
 files['worker-custody/'+name]=(OUT/'unpacked'/name).read_bytes()
records=[]
with (BASE/'recording.tar.gz').open('wb')as destination:
 with gzip.GzipFile(fileobj=destination,filename='',mode='wb',mtime=0,compresslevel=9)as compressed:
  with tarfile.open(fileobj=compressed,mode='w')as archive:
   for name,raw in sorted(files.items()):
    member=tarfile.TarInfo(name);member.size=len(raw);member.mtime=0;member.uid=member.gid=0;member.uname=member.gname='';member.mode=0o755 if name in ['original-offsets','narrow-native','promotion/native/original-offsets']else 0o644
    archive.addfile(member,io.BytesIO(raw));records.append(dict(path=name,bytes=len(raw),sha256=sha(raw)))
index=dict(schema='E6-T11d16-offset-repair-critic-records-v1',task='E6-T11d16',records=records)
(BASE/'records.json').write_text(json.dumps(index,indent=2)+'\n')
archive=(BASE/'recording.tar.gz').read_bytes()
manifest=dict(schema='E6-T11d16-offset-repair-critic-seal-v1',task='E6-T11d16',verdict='verified',workerSubmission='81a7a5aba30dd742645336621228a4bd88425d2d',runtimeHead='d3e0dc04431b64f7585565fdbf0a9c5065078152',diffBase='ea2906ee1e6abece757fcbb3bc549b881f1336b6',records=len(records),archiveBytes=len(archive),archiveSha256=sha(archive),recordIndexSha256=sha((BASE/'records.json').read_bytes()),verdictSha256=sha((BASE/'verdict.json').read_bytes()),predictionsSha256=sha((BASE/'predictions.json').read_bytes()),newWorkerArchiveSha256='e481c471060723b3e183781836fa413eb76722ad53f8e97e2146308ad6046943',newWorkerIndexSha256='d041a75220720bf43f24148b8e6d4add2b2c7518739299cf7e1596fef673df55',originalWorkerArchiveSha256='25436c66b4a320aa7bd68d407d37cf8c675438047e1fb8f0160964504e601fe0',originalWorkerIndexSha256='8ea043b6586f2309d516e7d5f5ed6403ed413de7f8f6b4f16d317d031ff056b8',originalCriticArchiveSha256='68cb3cb849be72cd465423ced2c23d20a61a141f0f48fdfa3a3ae03c0e797c44',originalCriticIndexSha256='b3d707e7e5831c1995e03f9b829f18fb838a051e74e5f92b0a5afc9e1fff7fa6',originalCriticVerdictSha256='0b347a134310a73061bf0f45b6d6f67caddd63aea6b9b17e554c5776e9e3f14d',carriedHeldIds=['P'+str(i)for i in range(1,13)],implementationEdited=False,authority='isolated-standard-uniform-shader',productionAuthority=False,guestExecution=False)
(BASE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
