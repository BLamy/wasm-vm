#!/usr/bin/env python3
"""Losslessly seal/reopen the fresh D41 critic recordings and complete audit bodies."""
import argparse,gzip,hashlib,io,json,subprocess,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
FROZEN='eda91e2569c38de3f56b92fd38b5326b2c6ae3fd'
FRESH_HEAD='2073205506d408d2800b1e65bf112123e9869b34'
sha=lambda b:hashlib.sha256(b).hexdigest()
def reopen(folder,extract=None):
    folder=Path(folder);indexBytes=(folder/'records.json').read_bytes();archive=(folder/'recording.tar.gz').read_bytes();manifest=json.loads((folder/'manifest.json').read_bytes());index=json.loads(indexBytes)
    assert sha(archive)==manifest['archiveSha256'] and sha(indexBytes)==manifest['recordIndexSha256']
    expected={q['path']:q for q in index['records']};assert len(expected)==len(index['records'])==manifest['members']
    physical={};seen=set();logicalBytes=0
    # Expand once. Every hardlink resolves to an earlier physical regular body,
    # never another link, a digest summary, an external file, or reverse gzip seeks.
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(archive)),mode='r:') as tar:
        for entry in tar:
            name=entry.name;assert name in expected and name not in seen and not name.startswith('/') and '..' not in Path(name).parts
            if entry.islnk():assert entry.linkname in physical;body=physical[entry.linkname];actualPhysical=entry.linkname
            else:assert entry.isfile();body=tar.extractfile(entry).read();physical[name]=body;actualPhysical=name
            q=expected[name];assert len(body)==q['bytes'] and sha(body)==q['sha256'] and actualPhysical==q['physical'],name
            seen.add(name);logicalBytes+=len(body)
            if extract:
                target=Path(extract)/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(body)
    assert seen==set(expected) and len(seen)==manifest['reopenedMembers'] and len(physical)==manifest['physicalMembers'] and logicalBytes==manifest['logicalBytes']
    return dict(members=len(seen),physicalMembers=len(physical),archiveSha256=sha(archive),indexSha256=sha(indexBytes),manifestSha256=sha((folder/'manifest.json').read_bytes()))
def seal(fresh,audits,destination):
    fresh=Path(fresh);audits=Path(audits);destination=Path(destination);destination.mkdir(parents=True,exist_ok=True);bodies={}
    def add(name,body):assert name not in bodies;bodies[name]=body
    for path in sorted(fresh.rglob('*')):
        if path.is_file():add('fresh/'+path.relative_to(fresh).as_posix(),path.read_bytes())
    assert len(list(fresh.glob('*/report.json')))==5
    for path in sorted(audits.glob('*')):
        if path.is_file():add('audits/'+path.name,path.read_bytes())
    for path in sorted(audits.glob('scripts/*')):
        if path.is_file():add('audits/scripts/'+path.name,path.read_bytes())
    for name in ['before-evidence.json','novel-before-run.json']:
        path=destination/name;add('predictions/'+name,path.read_bytes())
    for name in ['Makefile','tools/verify-virgl-standard-unorm-depth-critic.mjs','tools/virgl-unorm-depth/critic.mjs','tools/virgl-unorm-depth/critic.py','tools/virgl-unorm-depth/values.py','tools/virgl-unorm-depth/transfers.py','tools/virgl-unorm-depth/lifetimes.py']:
        body=(ROOT/name).read_bytes();assert body==subprocess.check_output(['git','show',FRESH_HEAD+':'+name],cwd=ROOT);add('source/'+name,body)
    add('seal-tool/seal.py',Path(__file__).read_bytes())
    add('diff/worker-frozen.patch',subprocess.check_output(['git','diff','d64b2f5e782fee2090f7a0f435bdb0ea7a0a1081',FROZEN],cwd=ROOT))
    add('diff/critic-promotions.patch',subprocess.check_output(['git','diff','0cf33c7c19a4f1f5211197e4f243cc199e290a15',FRESH_HEAD],cwd=ROOT))
    result=json.loads(bodies['audits/prediction-results.json']);assert result['verdict']=='verified' and len(result['results'])==15 and all(q['status']=='HELD' for q in result['results'])
    assert sha(bodies['predictions/before-evidence.json'])=='20ceb3c68d578649472a36d136fde0878293bd0d2e453c95a8f83d9a36fe27fb'
    assert sha(bodies['predictions/novel-before-run.json'])=='62bc97d718a2cbf4fb93331ede46df97308ee043b5c6db5c70efb84b44272678'
    for p in fresh.glob('*/report.json'):assert json.loads(p.read_bytes())['gitHead']==FRESH_HEAD
    records=[];deduplicated={};raw=io.BytesIO()
    with tarfile.open(fileobj=raw,mode='w',format=tarfile.PAX_FORMAT) as tar:
        for name,body in sorted(bodies.items()):
            digest=sha(body);key=(len(body),digest);entry=tarfile.TarInfo(name);entry.mode=0o644;entry.uid=entry.gid=0;entry.mtime=0;entry.uname=entry.gname=''
            if key in deduplicated:
                first=deduplicated[key];assert bodies[first]==body;entry.type=tarfile.LNKTYPE;entry.linkname=first;entry.size=0;tar.addfile(entry)
            else:
                first=name;deduplicated[key]=name;entry.size=len(body);tar.addfile(entry,io.BytesIO(body))
            records.append(dict(path=name,bytes=len(body),sha256=digest,physical=first))
    archive=gzip.compress(raw.getvalue(),compresslevel=9,mtime=0);(destination/'recording.tar.gz').write_bytes(archive)
    index=dict(schema='d41-fresh-critic-lossless-index-v1',frozenRuntimeHead=FROZEN,freshSourceHead=FRESH_HEAD,records=records);indexBytes=(json.dumps(index,indent=2)+'\n').encode();(destination/'records.json').write_bytes(indexBytes)
    custody=json.loads(bodies['audits/custody.json'])
    manifest=dict(schema='d41-fresh-critic-lossless-seal-v1',task='E6-T11d41',verdict='verified',frozenRuntimeHead=FROZEN,freshSourceHead=FRESH_HEAD,members=len(records),physicalMembers=len(deduplicated),logicalBytes=sum(q['bytes'] for q in records),archiveBytes=len(archive),archiveSha256=sha(archive),recordIndexSha256=sha(indexBytes),reopenedMembers=len(records),allPredictionsHeld=15,originalPredictionsSha256=sha(bodies['predictions/before-evidence.json']),novelPredictionsSha256=sha(bodies['predictions/novel-before-run.json']),workerSeal=custody['worker']['digests'],heldD40Seals=[dict(folder=q['folder'],digests=q['digests'],members=q['members']) for q in custody['held']],freshRecordings=5,newSchedules=['0x6a09e667','0xbb67ae85','0x3c6ef372'],novel='odd-stride original mip subrectangle, stale PBO, retained generation',sabotage='actual completed native clear341 after consumed337, consumed second fence345, unchanged inverse refuted',productionAuthority=False)
    (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return reopen(destination)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--fresh',default=str(ROOT/'target/evidence/virgl-standard-unorm-depth-critic'));p.add_argument('--audits');p.add_argument('--destination',default=str(Path(__file__).parent));p.add_argument('--reopen-only',action='store_true');p.add_argument('--extract');a=p.parse_args()
    if a.reopen_only:r=reopen(a.destination,a.extract)
    else:assert a.audits;r=seal(a.fresh,a.audits,a.destination)
    print(json.dumps(r))
