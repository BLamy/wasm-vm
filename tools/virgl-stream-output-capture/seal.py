"""Portable full-body worker custody, reopened through the gzip trailer."""
import gzip,hashlib,importlib.util,io,json,subprocess,sys,tarfile
from pathlib import Path
repo=Path(__file__).resolve().parents[2];cold=Path(sys.argv[1]).resolve();output=Path(sys.argv[2]).resolve();assert not output.exists();output.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest();report=json.loads((cold/'report.json').read_bytes());receipt=json.loads((cold/'recording/receipt.json').read_bytes());assert report['exitCode']==0 and report['head']==receipt['head'] and report['cleanBefore']==report['cleanAfter']==''
assert all(c['exitCode']==c['expected'] for c in receipt['commands'])
files={'cold/'+p.relative_to(cold).as_posix():p for p in cold.rglob('*') if p.is_file()}
for argument in sys.argv[3:]:
    directory=Path(argument).resolve();prefix='earlier/'+directory.name
    if directory.is_dir():files.update({prefix+'/'+p.relative_to(directory).as_posix():p for p in directory.rglob('*') if p.is_file()})
    else:files[prefix]=directory
files['tools/seal.py']=Path(__file__).resolve()
rows=[];seen={}
for name,file in sorted(files.items()):
    body=file.read_bytes();pin=sha(body);row=dict(path=name,bytes=len(body),sha256=pin)
    if pin in seen:row['target']=seen[pin]
    else:seen[pin]=name
    rows.append(row)
raw=(json.dumps(rows,indent=2)+'\n').encode();(output/'records.json').write_bytes(raw);archive=output/'recording.tar.gz'
with archive.open('wb') as raw_file,gzip.GzipFile(fileobj=raw_file,mode='wb',mtime=0,compresslevel=9) as compressed,tarfile.open(fileobj=compressed,mode='w|') as packed:
    for row in rows:
        info=tarfile.TarInfo(row['path']);info.mtime=0;info.mode=0o644
        if 'target' in row:info.type=tarfile.LNKTYPE;info.linkname=row['target'];packed.addfile(info)
        else:
            body=files[row['path']].read_bytes();assert len(body)==row['bytes'] and sha(body)==row['sha256'];info.size=len(body);packed.addfile(info,io.BytesIO(body))
manifest=dict(schema='stream-output-capture-seal-v1',task='E6-T11d66',head=report['head'],runtimeHead=(receipt.get('carried') or {}).get('runtimeHead',report['head']),recordIndexSha256=sha(raw),archiveSha256=sha(archive.read_bytes()),archiveBytes=archive.stat().st_size,records=len(rows),logicalBytes=sum(r['bytes'] for r in rows),authoritativeRecording='cold/recording',heldRecording='cold/recording/held-cold/recording' if receipt.get('carried') else None,actualLinuxGuest=False,productionAuthority=False)
if archive.stat().st_size>=50*1024*1024:
    parts=[]
    with archive.open('rb') as stream:
        while True:
            body=stream.read(16*1024*1024)
            if not body:break
            name='recording.tar.gz.part-'+str(len(parts)).zfill(4);(output/name).write_bytes(body);parts.append(dict(path=name,bytes=len(body),sha256=sha(body)))
    manifest['archiveParts']=parts;archive.unlink()
(output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');spec=importlib.util.spec_from_file_location('custody',repo/'tools/virgl-dimensional-depth-surfaces/custody.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);auth,_=module.reopen(output,sha((output/'manifest.json').read_bytes()));assert auth['reopenedMembers']==len(rows);print(json.dumps({'manifestSha256':sha((output/'manifest.json').read_bytes()),'manifest':manifest,'authentication':auth}))
