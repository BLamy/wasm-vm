#!/usr/bin/env python3
import gzip,hashlib,json,pathlib,subprocess,tarfile
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent
sha=lambda x:hashlib.sha256(x).hexdigest();BASE='a19b49441e932e64446f756cefe0c18e6b5b71b3'
git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT)
folder=ROOT/'evidence/virgl-production-readiness'
metadata=(folder/'standard-instanced-stencil-consumer-gap.json').read_bytes()
assert sha(metadata)=='1f0c8711c52b457b38a1678abba079e0f355ff5abdef0a4536b29c94e43b1222'
r=json.loads(metadata);assert r['sourceHead']==BASE and not r['nativeDrawExecuted'] and len(r['records'])==3
for row in r['records']:
 assert row['actual']['ok'] and row['old']['ok'] and not row['selectedConsumer']['ok'] and row['heldConsumer']['ok']
for pin in r['pins']:
 if pin['path'].endswith('standard-instanced-stencil-consumer-gap.mjs'):continue
 raw=(ROOT/pin['path']).read_bytes() if '/build/wasm/' in pin['path'] else git('show',BASE+':'+pin['path'])
 assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
manifest=json.loads((folder/'standard-instanced-stencil-native-gap.json').read_text())
indexraw=(folder/manifest['index']['path']).read_bytes();assert sha(indexraw)==manifest['index']['sha256']
index=json.loads(indexraw);expected={r['path']:r for r in index['records']};assert len(expected)==1357
archive=(folder/manifest['archive']['path']).read_bytes();assert sha(archive)=='3e3aef1c61d0a045fdd20da9d14a8416f7d770e3601a0d7cdd46d45eabbbf8e0'
seen=set();dest=OUT/'predecessor-gap';dest.mkdir(exist_ok=True)
with tarfile.open(folder/manifest['archive']['path'],'r|gz') as tar:
 for member in tar:
  assert member.isfile() and member.name not in seen and member.name in expected
  assert not pathlib.PurePosixPath(member.name).is_absolute() and '..' not in pathlib.PurePosixPath(member.name).parts
  raw=tar.extractfile(member).read();pin=expected[member.name];assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256']
  p=dest/member.name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);seen.add(member.name)
assert seen==set(expected)
report=json.loads((dest/'report.json').read_text());assert report['gitHead']==BASE and report['browserErrors']=={'console':[],'page':[],'requests':[]}
negative=[]
for ref in report['browserResult']['result']['runs']:
 raw=(dest/ref['path']).read_bytes();assert sha(raw)==ref['sha256'];row=json.loads(raw)
 if row.get('failurePhase')!='instances':continue
 e=row['execution'];result=e['result'];assert result['error']=={'code':'unsupported-stencil','message':'Ordered two-face stencil draws require one original instance.','byteOffset':0,'opcode':8}
 assert not result['ok'] and result['appliedCommands']==0 and result['draws']==[] and result['gpuComplete']
 calls=[x for x in row['events'] if x['label']==e['label'] and x['name'].startswith('draw')];assert calls==[]
 negative.append({'path':ref['path'],'sha256':ref['sha256'],'format':row['format'],'result':result})
assert len(negative)==2 and {r['format'] for r in negative}=={20,126}
carried=[];superseded=[]
for family in ['virgl-instance-base','virgl-ordered-stencil']:
 for role in ['worker','verifier']:
  prefix=OUT/'predecessor'/family/role
  for sourcefolder in ['source','held-source']:
   src=prefix/sourcefolder
   if not src.exists():continue
   for source in sorted(src.rglob('*')):
    if not source.is_file():continue
    name=source.relative_to(src).as_posix()
    if not (name.startswith(('renderer/virgl-shader/','crates/','web/','tools/guest/')) or name in ['renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources.mjs']):continue
    if name in ['renderer/virgl-shader/README.md']:continue
    raw=source.read_bytes()
    if not (ROOT/name).is_file():continue
    if raw!=(ROOT/name).read_bytes():
     assert family=='virgl-ordered-stencil' and name.startswith('renderer/virgl-shader/'),(family,role,name)
     superseded.append({'family':family,'role':role,'path':name,'oldSha256':sha(raw),'currentSha256':sha((ROOT/name).read_bytes()),'classification':'not carried: compiler changed by independently verified D46; old-response equivalence uses D46 native/Wasm legacy matrix evidence'})
     continue
    carried.append({'family':family,'role':role,'path':source.relative_to(prefix).as_posix(),'sha256':sha(raw),'unchangedDependency':name})
assert not git('diff','--name-only',BASE,'HEAD','--','renderer/virgl-shader','crates','web','tools/guest','renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs')
result={'schema':'fresh-instanced-stencil-gap-carry-v1','status':'passed','predecessor':BASE,'gapMetadataSha256':sha(metadata),'gapArchiveSha256':sha(archive),'gapReopenedMembers':len(seen),'nativeOriginalRefusals':negative,'carriedSources':carried,'supersededCompilerSources':superseded,'carryScope':'Unchanged compiler, generated Wasm, decoder/resources/storage, Rust/guest/web facts only. Changed consumer state and metadata are freshly interrogated.'}
(OUT/'gap-and-carry.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','gapMembers':len(seen),'nativeRefusals':len(negative),'carriedSourceIdentities':len(carried)}))
