from pathlib import Path
import gzip,hashlib,json,shutil,subprocess,tarfile
repo=Path('/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm');out=repo/'evidence/virgl-dimensional-depth-views/worker';cold=Path('/tmp/wasmvm-dimensional-depth-views-cold-configuration-final')
sha=lambda b:hashlib.sha256(b).hexdigest();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();assert head=='9698c0a91086cd419087154875d7200efcfded69'
report=json.loads((cold/'report.json').read_bytes());receipt=json.loads((cold/'recording/receipt.json').read_bytes());assert report['head']==receipt['head']==head and report['exitCode']==0 and not report['cleanBefore'] and not report['cleanAfter'];assert report['receiptSha256']==sha((cold/'recording/receipt.json').read_bytes());assert all(v['exitCode']==v['expected'] for v in receipt['commands'])
indexBytes=(out/'records.json').read_bytes();index=json.loads(indexBytes);assert index['head']==head;rows=index['records'];archive=out/'recording.tar.gz';assert archive.stat().st_size==460967357 and not (out/'manifest.json').exists()
cache={};links=0;reopened=0
with gzip.open(archive,'rb') as unzipped:
 with tarfile.open(fileobj=unzipped,mode='r|') as packed:
  for member in packed:
   assert reopened<len(rows);row=rows[reopened];assert member.name==row['path']
   if member.islnk():assert member.linkname in cache;body=cache[member.linkname];links+=1
   else:assert member.isfile();body=packed.extractfile(member).read();cache[member.name]=body
   assert len(body)==row['bytes'] and sha(body)==row['sha256'],member.name
   reopened+=1
 while True:
  padding=unzipped.read(1024*1024)
  if not padding:break
  assert not any(padding)
assert reopened==len(rows)
manifest=dict(schema='dimensional-depth-view-seal-v1',task='E6-T11d60',head=head,records=len(rows),reopenedMembers=reopened,recordIndexSha256=sha(indexBytes),archiveSha256=sha(archive.read_bytes()),archiveBytes=archive.stat().st_size,dependencySeals=receipt['dependencySeals'],authoritativeRecording='cold/recording',commands=len(receipt['commands']),guestExecution=False,productionAuthority=False,guestInstructionTraces=True,uniqueCompleteBodies=len(cache),deduplicatedHardlinks=links,logicalBytes=sum(r['bytes'] for r in rows))
parts=[]
with archive.open('rb') as stream:
 while True:
  chunk=stream.read(16*1024*1024)
  if not chunk:break
  name='recording.tar.gz.part-'+str(len(parts)).zfill(4);assert not (out/name).exists();(out/name).write_bytes(chunk);parts.append(dict(path=name,bytes=len(chunk),sha256=sha(chunk)))
assert sha(b''.join((out/p['path']).read_bytes() for p in parts))==manifest['archiveSha256'];manifest['archiveParts']=parts
for name,source in [('sealing-finisher.py',Path(__file__)),('sealing-original.log',Path('/tmp/wasmvm-d60-worker-seal-9698c0a9.log'))]:
 assert not (out/name).exists();shutil.copy2(source,out/name)
manifest['sealingContinuation']={name:dict(bytes=(out/name).stat().st_size,sha256=sha((out/name).read_bytes())) for name in ['sealing-finisher.py','sealing-original.log','sealing-resumption.json']}
archive.unlink();(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:manifest[k] for k in ['head','records','reopenedMembers','uniqueCompleteBodies','deduplicatedHardlinks','logicalBytes','archiveBytes','recordIndexSha256','archiveSha256']}));print('manifestSha256',sha((out/'manifest.json').read_bytes()))
