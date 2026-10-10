#!/usr/bin/env python3
"""Seal only authoritative fresh-critic records and source bytes."""
from pathlib import Path
import gzip,hashlib,io,json,subprocess,tarfile
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
SUB='520dbc10ad15f3ae328de577db724b1ff99cb32a'
FREEZE='e7a85906622794c60872876f9d3e80da83df9ccd'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==SUB
verdict=json.loads((HERE/'verdict.json').read_text());assert verdict['verdict']=='verified'
members={}
flat=['predictions.json','prediction-correction.json','authentication.json','recording-audit.json','independent-audit.json','coverage-regions.json','coverage-summary.json',
 'coverage-classification.json','reexport-coverage.json','boundary-audit.jsonl','verdict.json','narrow-admission.json',
 'authenticate.py','audit-recording.mjs','audit-independent.mjs','coverage-audit.py','coverage-classification.py','reexport-coverage.py','boundary-audit.py','make-verdict.py','narrow-admission.mjs','seal.py','verify-seal.py']
flat += [p.name for p in HERE.glob('*-audit.jsonl')]
flat += [p.name for p in HERE.glob('*.profdata')]
for name in flat:members[name]=(HERE/name).read_bytes()
for name in ['promoted','narrow-node-coverage','narrow-scalar-admission','narrow-packed-smoke']:
 for file in (HERE/name).rglob('*'):
  if file.is_file():members[file.relative_to(HERE).as_posix()]=file.read_bytes()
for name in ['independent-initial/report.json','independent-initial/original-harness.mjs']:
 members[name]=(HERE/name).read_bytes()
sources={};runtime={}
promoted=json.loads((HERE/'promoted/hardware/report.json').read_text())
for row in promoted['sources']:
 raw=(ROOT/row['path']).read_bytes();assert sha(raw)==row['sha256'];sources[row['path']]=sha(raw)
 members['sources/'+row['path']]=raw
 if not row['path'].startswith(('renderer/virgl-command/tests/standard-packed-vertex-fetch-adversarial','tools/virgl-command/standard-packed-adversarial')):
  runtime[row['path']]=sha(raw)
for name in ['Makefile','tools/verify-virgl-standard-packed-adversarial.mjs','tools/virgl-command/standard-packed-adversarial-compiler.mjs']:
 raw=(ROOT/name).read_bytes();sources[name]=sha(raw);members['sources/'+name]=raw
generated={}
for name in ['renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm','renderer/virgl-shader/build/standard-packed-native/standard-packed-test']:
 raw=(ROOT/name).read_bytes();generated[name]=sha(raw);members['generated/'+name]=raw
 worker_index=json.loads((HERE.parent/'worker/records.json').read_text())
 assert next(r['sha256'] for r in worker_index['records'] if r['path']=='hot-generated/'+name)==sha(raw)
index=dict(schema='standard-packed-critic-records-v1',task='E6-T11d15',submission=SUB,sourceFreeze=FREEZE,
 records=[dict(path=name,bytes=len(raw),sha256=sha(raw)) for name,raw in sorted(members.items())])
index_raw=(json.dumps(index,indent=2)+'\n').encode();(HERE/'records.json').write_bytes(index_raw)
buffer=io.BytesIO()
with gzip.GzipFile(fileobj=buffer,mode='wb',mtime=0) as gz:
 with tarfile.open(fileobj=gz,mode='w') as tar:
  for name,raw in sorted(members.items()):
   info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o644;info.mtime=0;tar.addfile(info,io.BytesIO(raw))
archive=buffer.getvalue();(HERE/'recording.tar.gz').write_bytes(archive)
worker=json.loads((HERE.parent/'worker/manifest.json').read_text())
manifest=dict(schema='standard-packed-critic-seal-v1',task='E6-T11d15',verdict='verified',submission=SUB,sourceFreeze=FREEZE,
 predecessor=verdict['predecessor'],records=len(members),archiveBytes=len(archive),archiveSha256=sha(archive),recordIndexSha256=sha(index_raw),
 workerArchiveSha256=worker['archiveSha256'],workerIndexSha256=worker['recordIndexSha256'],sources=sources,generated=generated,
 freshCriticFrames=92,freshCriticPixels=23552,completedSabotages=3,originalWorkerFramesReconstructed=428,originalWorkerPixelsReconstructed=115200,
 risk='high',productionDrawAuthority=False,guestExecution=False,portableInteriorNormalizedWords=False,
 prototypes='The initial arithmetic-error report/harness are retained only to document the critic correction, not used as positive product evidence. Its provisional blobs are deliberately not duplicated.',
 replay='Authenticate/extract the unchanged worker seal with authenticate.py, then authenticate/extract this seal with verify-seal.py --extract. Use archived source bytes and sourceFreeze for replay; newer branch sources may differ.')
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({k:manifest[k] for k in ['verdict','records','archiveBytes','archiveSha256','recordIndexSha256']}))
