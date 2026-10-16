#!/usr/bin/env python3
"""Seal and reopen every complete body of the final exact-head pristine run."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
repo=Path(__file__).resolve().parents[2]
assert len(sys.argv)==3,'usage: seal.py COLD OUTPUT'
cold,output=[Path(v).resolve() for v in sys.argv[1:]]
assert not output.exists()
report=json.loads((cold/'report.json').read_bytes())
receipt=json.loads((cold/'recording/receipt.json').read_bytes())
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
assert report['head']==receipt['head']==head
assert not report['cleanBefore'] and not report['cleanAfter'] and report['exitCode']==0
for seed in [27449,84131,176129]:
    name='hardware-'+str(seed);report_head=json.loads((cold/('recording/'+name)/'report.json').read_bytes())['head']
    if report_head!=head:
        assert name in receipt['carriedCommands'] and report_head==receipt['carriedCommandOrigins'][name]['head'] and receipt['carriedSourceBoundary']['unchangedRuntime']
        assert not subprocess.check_output(['git','diff','--name-only',report_head,head,'--','crates','renderer','Cargo.toml','Cargo.lock','web','tools/virgl-dimensional-depth-views/browser.mjs','tools/virgl-dimensional-depth-views/fixtures.mjs'],cwd=repo)
assert all(v['exitCode']==v['expected'] for v in receipt['commands'])
sha=lambda b:hashlib.sha256(b).hexdigest()
assert report['receiptSha256']==sha((cold/'recording/receipt.json').read_bytes())
files={'cold/'+str(p.relative_to(cold)):p for p in cold.rglob('*') if p.is_file()}
files['sealing/seal.py']=Path(__file__).resolve()
rows=[{'path':name,'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for name,p in sorted(files.items())]
output.mkdir(parents=True)
index={'schema':'dimensional-depth-view-index-v1','task':'E6-T11d60','head':head,'records':rows}
raw=(json.dumps(index,indent=2)+'\n').encode();(output/'records.json').write_bytes(raw)
archive=output/'recording.tar.gz'
unique={};links=0
with archive.open('wb') as stream,gzip.GzipFile(fileobj=stream,mode='wb',mtime=0,filename='') as zipped,tarfile.open(fileobj=zipped,mode='w') as packed:
    for row in rows:
        body=files[row['path']].read_bytes();info=tarfile.TarInfo(row['path']);info.size,info.mode,info.mtime=len(body),0o644,0
        key=(row['bytes'],row['sha256'])
        if key in unique:
            info.type,info.linkname,info.size=tarfile.LNKTYPE,unique[key],0;packed.addfile(info);links+=1
        else:
            packed.addfile(info,io.BytesIO(body));unique[key]=row['path']
with tarfile.open(archive,'r:gz') as packed:
    members=packed.getmembers();assert len(members)==len(rows)
    for member,row in zip(members,rows):
        body=packed.extractfile(member).read();assert member.name==row['path'] and len(body)==row['bytes'] and sha(body)==row['sha256']
manifest={'schema':'dimensional-depth-view-seal-v1','task':'E6-T11d60','head':head,'records':len(rows),'reopenedMembers':len(rows),
          'recordIndexSha256':sha(raw),'archiveSha256':sha(archive.read_bytes()),'archiveBytes':archive.stat().st_size,
          'dependencySeals':receipt['dependencySeals'],'authoritativeRecording':'cold/recording','commands':len(receipt['commands']),
          'guestExecution':False,'productionAuthority':False}
manifest.update(uniqueCompleteBodies=len(unique),deduplicatedHardlinks=links,logicalBytes=sum(r['bytes'] for r in rows))
parts=[]
with archive.open('rb') as stream:
    while True:
        chunk=stream.read(16*1024*1024)
        if not chunk:break
        name='recording.tar.gz.part-'+str(len(parts)).zfill(4);(output/name).write_bytes(chunk);parts.append(dict(path=name,bytes=len(chunk),sha256=sha(chunk)))
assert sha(b''.join((output/p['path']).read_bytes() for p in parts))==manifest['archiveSha256']
manifest['archiveParts']=parts;manifest['guestInstructionTraces']=True
archive.unlink()
(output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
