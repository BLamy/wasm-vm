#!/usr/bin/env python3
"""Seal direct critic proof; carry exact published dependency indexes, no archives."""
import gzip,hashlib,io,json,subprocess,tarfile
from pathlib import Path
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
FREEZE='58138a0d370718744e8c74f52860faa1200d0928';RUNTIME='17b9d9334dfa1b2b209df36e0105e2ec96549fa7'
FRESH=ROOT/'target/evidence/virgl-shadow-samplers-critic/final';sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT)
members={}
def add(name,raw):
 assert name not in members;members[name]=raw
assert b'FRESH_SHADOW_CRITIC_RECORDING_COMPLETE\n' in (FRESH/'critic.log').read_bytes()
reports={}
for file in sorted(FRESH.rglob('*')):
 if file.is_file():add('fresh/'+file.relative_to(FRESH).as_posix(),file.read_bytes())
for directory in sorted(FRESH.iterdir()):
 if not directory.is_dir() or not (directory/'report.json').exists():continue
 report=json.loads((directory/'report.json').read_text());assert report['status']=='passed' and report['gitHead']==FREEZE
 assert report['browserErrors']==dict(console=[],page=[],requests=[]);e=report['browserResult']['result'];assert 'Metal' in e['gpu'] and 'M4' in e['gpu'] and not report['browser']['headless'];assert not e['guestExecution'] and not e['productionNegotiation']
 for source in report['sources']:
  raw=(directory/'source'/source['path']).read_bytes();assert sha(raw)==source['sha256'] and len(raw)==source['bytes']
  assert raw==(ROOT/source['path']).read_bytes()
  if '/build/wasm/' not in source['path']:assert raw==git('show',FREEZE+':'+source['path'])
 for blob in e['blobs']:
  zipped=(directory/blob['path']).read_bytes();raw=gzip.decompress(zipped);assert sha(zipped)==blob['gzipSha256'] and len(raw)==blob['bytes'] and sha(raw)==blob['sha256']
 for r in e['runs']:
  if 'path' in r:
   raw=(directory/r['path']).read_bytes();assert sha(raw)==r['sha256'] and len(raw)==r['bytes'];row=json.loads(raw)
  else:row=r
  assert all(p['held'] for p in row.get('predictions',[]))
  assert all(o['deleted']==1 for o in row['nativeObjects']) and all(o['deleted']==1 for o in row['fenceObjects'])
  for side in ('renderer','resources'):assert all(v==0 for v in row['final'][side]['budgets'].values())
 for k in ['screenshot','browserCoverage']:
  assert sha((directory/report[k]['path']).read_bytes())==report[k]['sha256']
 coverage=json.loads((directory/'browser-coverage.json').read_text());served={r['path']:r['sha256'] for r in report['servedFiles']}
 for script in coverage['scripts']:assert sha(script['sourceBody'].encode())==script['sha256']==served['/'+script['source']]
 reports[directory.name]=dict(reportSha256=sha((directory/'report.json').read_bytes()),gpu=e['gpu'],seed=e.get('seed'),fault=e.get('fault'),runs=len(e['runs']))
for leaf in ['predictions.json','attack-predictions.json','authentication.json','original-word-audit.json','finest-coverage-audit.json','inherited-hot-audit.json','inherited-cold-audit.json','custody.json','verdict.json']:
 raw=(OUT/leaf).read_bytes();add('critic/'+leaf,raw)
for name in git('ls-files','evidence/virgl-shadow-samplers/verifier').decode().splitlines():
 if name==(OUT/'seal.py').relative_to(ROOT).as_posix():continue
 if name.endswith(('.mjs','.py','.sh')) or name.endswith('predictions.json'):
  raw=(ROOT/name).read_bytes();assert raw==git('show',FREEZE+':'+name);add('source/'+name,raw)
# The sealing program is additive delivery metadata; native/audit harnesses stay frozen.
add('source/'+(OUT/'seal.py').relative_to(ROOT).as_posix(),(OUT/'seal.py').read_bytes())
for name in ['renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs']:
 raw=(ROOT/name).read_bytes();assert raw==git('show',RUNTIME+':'+name);add('source/'+name,raw)
dependencies=[]
for family,role in [('virgl-shadow-samplers','worker'),('virgl-shadow-shaders','worker'),('virgl-shadow-shaders','verifier'),('virgl-instanced-stencil','worker')]:
 folder=ROOT/'evidence'/family/role;mraw=(folder/'manifest.json').read_bytes();iraw=(folder/'records.json').read_bytes();m=json.loads(mraw)
 for leaf,raw in [('manifest.json',mraw),('records.json',iraw)]:add('dependency-index/'+(folder/leaf).relative_to(ROOT).as_posix(),raw)
 dependencies.append(dict(evidence=folder.relative_to(ROOT).as_posix(),manifestSha256=sha(mraw),recordsSha256=sha(iraw),archiveSha256=m['archiveSha256'],records=m['records'],sourceHead=m['sourceHead'],authority='published external seal; archives deliberately not recursively copied'))
auth=json.loads((OUT/'authentication.json').read_text());assert auth['status']=='passed'
for dep,r in zip(dependencies[:3],auth['seals']):assert dep['manifestSha256']==r['manifestSha256'] and dep['recordsSha256']==r['recordsSha256'] and dep['archiveSha256']==r['archiveSha256']
index=(json.dumps(dict(schema='fresh-original-shadow-sampler-critic-records-v1',task='E6-T11d49',sourceHead=FREEZE,runtimeHead=RUNTIME,records=[dict(path=k,bytes=len(v),sha256=sha(v)) for k,v in sorted(members.items())]),indent=2)+'\n').encode();(OUT/'records.json').write_bytes(index)
buf=io.BytesIO()
with gzip.GzipFile(fileobj=buf,mode='wb',mtime=0) as zipped:
 with tarfile.open(fileobj=zipped,mode='w') as tar:
  physical={}
  for name,raw in sorted(members.items()):
   t=tarfile.TarInfo(name);t.mtime=0;t.mode=0o644;t.size=len(raw);key=len(raw),sha(raw)
   if key in physical:t.type=tarfile.LNKTYPE;t.linkname=physical[key];t.size=0;tar.addfile(t)
   else:tar.addfile(t,io.BytesIO(raw));physical[key]=name
archive=buf.getvalue();(OUT/'recording.tar.gz').write_bytes(archive);assert (OUT/'recording.tar.gz').read_bytes()==archive
expected={r['path']:r for r in json.loads((OUT/'records.json').read_text())['records']};seen=set();originals={};links=0
with tarfile.open(fileobj=io.BytesIO((OUT/'recording.tar.gz').read_bytes()),mode='r|gz') as tar:
 for t in tar:
  assert t.name in expected and t.name not in seen and (t.isfile() or t.islnk())
  if t.islnk():assert t.linkname in originals;raw=originals[t.linkname];links+=1
  else:raw=tar.extractfile(t).read();originals[t.name]=raw
  assert len(raw)==expected[t.name]['bytes'] and sha(raw)==expected[t.name]['sha256'];seen.add(t.name)
assert seen==set(expected)
manifest=dict(schema='fresh-original-shadow-sampler-critic-seal-v1',task='E6-T11d49',verdict='verified',sourceHead=FREEZE,runtimeHead=RUNTIME,workerSubmission='c859d95f2a7b966480e3944010ae631316068787',archiveParts=[dict(path='recording.tar.gz',bytes=len(archive),sha256=sha(archive))],archiveBytes=len(archive),archiveSha256=sha(archive),recordIndexSha256=sha(index),records=len(members),reopenedMembers=len(seen),physicalBodies=len(originals),hardlinks=links,dependencies=dependencies,reopenedCurrentWorkerMembers=44665,reopenedD48Members=53210,reports=reports,sourceClosureIncluded=True,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False,authority='isolated original native comparison sampler consumer; fresh critic',generated=auth['generated'],sourceDigests={n:sha((ROOT/n).read_bytes()) for n in ['renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs']})
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:v for k,v in manifest.items() if k not in ['reports','dependencies']}))
