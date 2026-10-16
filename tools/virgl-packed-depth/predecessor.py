#!/usr/bin/env python3
"""Authenticate complete held UN16 seals and unchanged surrounding boundaries."""
import gzip,hashlib,io,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='c34b00e91f6e84501f0eff731a74857a10eb4250'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def need(value,message):
    if not value:raise ValueError(message)
def main(directory):
    Path(directory).mkdir(parents=True,exist_ok=True);rows=[]
    for role in ('worker','verifier'):
        folder='evidence/virgl-unorm-depth-images/'+role;files={}
        for name in ('manifest.json','records.json','recording.tar.gz'):
            path=folder+'/'+name;raw=(ROOT/path).read_bytes();need(raw==subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT),'held seal changed '+path);files[name]=sha(raw)
        manifest=json.loads((ROOT/folder/'manifest.json').read_text());index=json.loads((ROOT/folder/'records.json').read_text());need(manifest['archiveSha256']==files['recording.tar.gz'] and manifest['recordIndexSha256']==files['records.json'],'held full custody pins')
        expected={r['path']:r for r in index['records']};seen=set();total=0
        with tarfile.open(fileobj=io.BytesIO(gzip.decompress((ROOT/folder/'recording.tar.gz').read_bytes())),mode='r:') as archive:
            entries=archive.getmembers();physical={e.name:e for e in entries}
            for entry in entries:
                need((entry.isfile() or entry.islnk()) and entry.name in expected and entry.name not in seen,'held archive membership');seen.add(entry.name);target=entry
                if entry.islnk():
                    target=physical[entry.linkname];need(target.isfile() and target.offset<entry.offset,'held earlier physical hardlink body')
                raw=archive.extractfile(target).read();record=expected[entry.name];total+=len(raw);need(len(raw)==record['bytes'] and sha(raw)==record['sha256'],'complete held member '+entry.name)
        need(seen==set(expected),'held archive incomplete');rows.append(dict(path=folder,members=len(seen),uncompressedBytes=total,digests=files))
    boundaries={}
    names=('decoder','state','floating-depth-images','constant-domain','integer-images','packed-normalized-images','float-images','packed-float-images','shared-exponent-images','shared-exponent-gpu','color-images','packed-unsigned-images')
    for name in names:
        path='renderer/virgl-command/'+name+'.mjs';raw=(ROOT/path).read_bytes();need(raw==subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT),'held boundary '+path);boundaries[path]=sha(raw)
    for path in subprocess.check_output(['git','ls-files','renderer/virgl-shader'],cwd=ROOT,text=True).splitlines():
        raw=(ROOT/path).read_bytes();need(raw==subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT),'unchanged actual compiler '+path);boundaries[path]=sha(raw)
    negative='evidence/virgl-production-readiness/standard-packed-depth-image-gap.json';refusal=json.loads((ROOT/negative).read_text());need(refusal['gitHead']==BASE and len(refusal['rows'])==30 and refusal['nativeExecuted'] is False and all(not r['result']['ok'] for r in refusal['rows']),'original24 storage and6 consumer refusals')
    for row in refusal['sources']:
        raw=subprocess.check_output(['git','show',BASE+':'+row['path']],cwd=ROOT);need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'original refusal source '+row['path'])
    generated={}
    for name,digest in {'virgl-shader.wasm':'acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc','virgl-shader.mjs':'6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa'}.items():
        path='renderer/virgl-shader/build/wasm/'+name;need(sha((ROOT/path).read_bytes())==digest,'unchanged generated compiler '+name);generated[path]=digest
    primary=json.loads((ROOT/'tools/virgl-packed-depth/primary.json').read_text())
    for row in primary['sources']:
        raw=(ROOT/row['path']).read_bytes();need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'whole pinned primary '+row['path'])
    result=dict(schema='packed-depth-held-predecessors-v1',status='passed',predecessor=BASE,records=rows,reopenedMembers=sum(r['members'] for r in rows),unchangedBoundaries=boundaries,generated=generated,primary=primary,negativeRecordSha256=sha((ROOT/negative).read_bytes()))
    Path(directory,'predecessor-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status='passed',reopenedMembers=result['reopenedMembers'])))
if __name__=='__main__':main(sys.argv[1])
