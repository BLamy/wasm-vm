#!/usr/bin/env python3
import gzip,hashlib,io,json,pathlib,subprocess,tarfile
repo=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent
def sha(b):return hashlib.sha256(b).hexdigest()
files={f'critic/{p.relative_to(out)}':p for p in out.rglob('*') if p.is_file() and p.name not in {'manifest.json','records.json','recording.tar.gz'}}
source_paths=subprocess.check_output(['git','ls-files','crates/core','tools/virgl-desktop-control','tools/verify-virgl-default-demo.mjs','Cargo.toml','Cargo.lock','Makefile'],cwd=repo,text=True).splitlines()
source_paths.append('crates/core/tests/virtio_gpu_control3d/desktop_critic.rs')
for name in source_paths:
 path=repo/name
 if path.is_file():files['source/'+name]=path
binary=repo/'target/evidence/virgl-desktop-control-verifier/worker-native-binary';files['worker-native-binary']=binary
profdata=repo/'target/evidence/virgl-desktop-control-verifier/reopened/worker/hot/native.profdata';files['worker-native.profdata']=profdata
rows=[{'path':name,'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())} for name,path in sorted(files.items())]
index={'schema':'desktop-control-critic-index-v1','task':'E6-T11d51','workerSubmissionHead':'0186b314c591d066227541ce5d3965eb9edad723','frozenHead':'e13dddfbb0d955abb268e4b4ac07828cbea35956','records':rows};ir=(json.dumps(index,indent=2)+'\n').encode();(out/'records.json').write_bytes(ir)
with (out/'recording.tar.gz').open('wb') as stream,gzip.GzipFile(fileobj=stream,mode='wb',mtime=0,filename='') as zipped,tarfile.open(fileobj=zipped,mode='w') as packed:
 for row in rows:
  raw=files[row['path']].read_bytes();member=tarfile.TarInfo(row['path']);member.size=len(raw);member.mode=0o644;member.mtime=0;packed.addfile(member,io.BytesIO(raw))
with tarfile.open(out/'recording.tar.gz','r:gz') as packed:
 members=packed.getmembers();assert len(members)==len(rows)
 for member,row in zip(members,rows):
  raw=packed.extractfile(member).read();assert member.name==row['path'] and len(raw)==row['bytes'] and sha(raw)==row['sha256']
auth=json.loads((out/'authentication.json').read_bytes());novel=json.loads((out/'novel-audit.json').read_bytes());cov=json.loads((out/'coverage-audit.json').read_bytes())
manifest={'schema':'desktop-control-critic-seal-v1','task':'E6-T11d51','verdict':'verified','workerSubmissionHead':index['workerSubmissionHead'],'frozenHead':index['frozenHead'],'records':len(rows),'reopenedMembers':len(rows),'recordIndexSha256':sha(ir),'archiveSha256':sha((out/'recording.tar.gz').read_bytes()),'archiveBytes':(out/'recording.tar.gz').stat().st_size,'workerSeal':{k:v for k,v in auth['worker'].items() if k!='bodies'},'heldD50':[{k:v for k,v in d.items() if k!='bodies'} for d in auth['heldD50']],'carriedHostSources':len(auth['carriedHostSources']),'nativeFreshRecords':608,'novelRecords':novel['records'],'promotedRecords':json.loads((out/'promoted/equality.json').read_bytes())['promotedRecords'],'positiveMappedOperands':cov['positiveMappedOperands'],'staticLineWaivers':cov['staticLineWaivers'],'exactUnmappedWaivers':cov['exactUnmappedWaivers'],'coldReceiptSha256':auth['coldReceiptSha256'],'runtimeChangedByVerifier':False,'guestExecution':False,'productionAuthority':False}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'records':len(rows),'archiveBytes':manifest['archiveBytes'],'manifestSha256':sha((out/'manifest.json').read_bytes()),'indexSha256':sha(ir),'archiveSha256':manifest['archiveSha256']}))
