"""Seal every complete final-clone body; authenticate links, payloads and gzip EOF."""
import gzip,hashlib,io,json,sys,tarfile
from pathlib import Path
import subprocess
repo=Path(__file__).resolve().parents[2]
assert len(sys.argv)==3,'usage: seal.py COLD OUTPUT'
cold,output=[Path(v).resolve() for v in sys.argv[1:]];assert not output.exists()
sha=lambda b:hashlib.sha256(b).hexdigest()
report=json.loads((cold/'report.json').read_bytes());receipt=json.loads((cold/'recording/receipt.json').read_bytes())
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
assert report['head']==receipt['head']==head and not report['cleanBefore'] and not report['cleanAfter'] and report['exitCode']==0
assert report['receiptSha256']==sha((cold/'recording/receipt.json').read_bytes())
assert all(v['exitCode']==v['expected'] for v in receipt['commands'])
for name in ['hardware-27461','hardware-82013','hardware-164021','compile-link','fault-wrong-layer']:
    r=json.loads((cold/('recording/'+name+'/report.json')).read_bytes());assert r['gitHead']==head
    assert r['status']==('failed' if name=='fault-wrong-layer' else 'passed')
files={'cold/'+str(p.relative_to(cold)):p for p in cold.rglob('*') if p.is_file()}
files['sealing/seal.py']=Path(__file__).resolve()
rows=[];first={}
for name,p in sorted(files.items()):
    body=p.read_bytes();digest=sha(body);key=(len(body),digest)
    row=dict(path=name,bytes=len(body),sha256=digest,kind='hardlink' if key in first else 'file')
    if key in first:row['target']=first[key]
    else:first[key]=name
    rows.append(row)
output.mkdir(parents=True)
index=dict(schema='dimensional-shadow-shader-index-v1',task='E6-T11d61',head=head,records=rows)
raw=(json.dumps(index,indent=2)+'\n').encode();(output/'records.json').write_bytes(raw)
archive=output/'recording.tar.gz'
with archive.open('wb') as stream,gzip.GzipFile(fileobj=stream,mode='wb',mtime=0,filename='') as zipped,tarfile.open(fileobj=zipped,mode='w') as packed:
    for row in rows:
        info=tarfile.TarInfo(row['path']);info.mode,info.mtime=0o644,0
        if row['kind']=='hardlink':
            info.type,info.linkname=tarfile.LNKTYPE,row['target'];packed.addfile(info)
        else:
            body=files[row['path']].read_bytes();assert len(body)==row['bytes'] and sha(body)==row['sha256']
            info.size=len(body);packed.addfile(info,io.BytesIO(body))
seen={};count=0
with gzip.open(archive,'rb') as decoded:
    with tarfile.open(fileobj=decoded,mode='r|') as packed:
        for member in packed:
            assert count<len(rows);row=rows[count];count+=1;assert member.name==row['path']
            if member.islnk():
                assert row['kind']=='hardlink' and member.linkname==row['target'] and member.linkname in seen
                assert seen[member.linkname]==(row['bytes'],row['sha256'])
            else:
                assert member.isfile() and row['kind']=='file'
                body=packed.extractfile(member).read();assert len(body)==row['bytes'] and sha(body)==row['sha256']
            seen[row['path']]=(row['bytes'],row['sha256'])
    while decoded.read(1024*1024):pass
assert count==len(rows)
manifest=dict(schema='dimensional-shadow-shader-seal-v1',task='E6-T11d61',head=head,records=len(rows),uniqueBodies=len(first),backwardLinks=len(rows)-len(first),reopenedMembers=count,gzipEofChecked=True,
              recordIndexSha256=sha(raw),archiveSha256=sha(archive.read_bytes()),archiveBytes=archive.stat().st_size,logicalBytes=sum(r['bytes'] for r in rows),
              compilerBaseline=json.loads((cold/'recording/native/predecessor/authentication.json').read_bytes()),authoritativeRecording='cold/recording',commands=len(receipt['commands']),guestExecution=False,productionAuthority=False)
(output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
