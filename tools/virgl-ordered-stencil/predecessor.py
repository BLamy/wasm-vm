#!/usr/bin/env python3
"""Authenticate complete held original packed consumers and unchanged surrounding boundaries."""
import gzip,hashlib,io,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='ff80836249c9f235cae516421498a574b51b6f9c'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def need(value,message):
    if not value:raise ValueError(message)
def main(directory):
    Path(directory).mkdir(parents=True,exist_ok=True);rows=[]
    for role in ('worker','verifier'):
        folder='evidence/virgl-stencil/'+role;files={}
        manifest=json.loads((ROOT/folder/'manifest.json').read_text());index=json.loads((ROOT/folder/'records.json').read_text());parts=manifest.get('archiveParts',[manifest.get('archive')]);bodies=[]
        for name in ['manifest.json','records.json']+[p['path'] for p in parts]:
            path=folder+'/'+name;raw=(ROOT/path).read_bytes();need(raw==subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT),'held seal changed '+path);files[name]=sha(raw)
        for p in parts:
            raw=(ROOT/folder/p['path']).read_bytes();need(len(raw)==p['bytes'] and sha(raw)==p['sha256'],'held multipart part');bodies.append(raw)
        joined=b''.join(bodies);need(manifest.get('archiveSha256',manifest.get('archive',{}).get('sha256'))==sha(joined) and manifest.get('recordIndexSha256',manifest.get('index',{}).get('sha256'))==files['records.json'],'held full custody pins')
        expected={r['path']:r for r in index['records']};seen=set();total=0
        with tarfile.open(fileobj=io.BytesIO(gzip.decompress(joined)),mode='r:') as archive:
            entries=archive.getmembers();physical={e.name:e for e in entries}
            for entry in entries:
                need((entry.isfile() or entry.islnk()) and entry.name in expected and entry.name not in seen,'held archive membership');seen.add(entry.name);target=entry
                if entry.islnk():
                    target=physical[entry.linkname];need(target.isfile() and target.offset<entry.offset,'held earlier physical hardlink body')
                raw=archive.extractfile(target).read();record=expected[entry.name];total+=len(raw);need(len(raw)==record['bytes'] and sha(raw)==record['sha256'],'complete held member '+entry.name)
        need(seen==set(expected),'held archive incomplete');rows.append(dict(path=folder,members=len(seen),uncompressedBytes=total,digests=files))
    boundaries={}
    names=('decoder','resources','unorm-depth-images','floating-depth-gpu','floating-depth-images','constant-domain','integer-images','packed-normalized-images','float-images','packed-float-images','shared-exponent-images','shared-exponent-gpu','floating-depth-gpu','color-images','packed-unsigned-images')
    for name in names:
        path='renderer/virgl-command/'+name+'.mjs';raw=(ROOT/path).read_bytes();need(raw==subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT),'held boundary '+path);boundaries[path]=sha(raw)
    for path in subprocess.check_output(['git','ls-files','renderer/virgl-shader'],cwd=ROOT,text=True).splitlines():
        raw=(ROOT/path).read_bytes();need(raw==subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT),'unchanged actual compiler '+path);boundaries[path]=sha(raw)
    negative='evidence/virgl-production-readiness/standard-ordered-stencil-gap.json'
    need(sha((ROOT/negative).read_bytes())=='ab0246ef23fb77e353bbbe451c86372050a97e3fb748ce676a71c1f5a06cff4c','whole original negative identity')
    refusal=json.loads((ROOT/negative).read_text());need(refusal['sourceHead']==BASE and len(refusal['nativeNegatives'])==6,'six original actual asymmetric S8 refusals')
    gap_folder=ROOT/'evidence/virgl-production-readiness/ordered-stencil-gap'
    need(sha((gap_folder/'recording.tar.gz').read_bytes())=='e37ee5c94be466e78b59271f0a2d9d1cf4afe52bf07b35e2d3b33143935be41b','whole original gap archive identity')
    need(sha((gap_folder/'records.json').read_bytes())=='d62a3e86621ec234a2ca29bc5bd571a978e849af83813386d24a211ec8797a8c','whole original gap index identity')
    gap_index=json.loads((gap_folder/'records.json').read_text());expected={r['path']:r for r in gap_index};seen=set()
    with tarfile.open(gap_folder/'recording.tar.gz','r:gz') as archive:
        for entry in archive.getmembers():
            need(entry.isfile() and entry.name in expected and entry.name not in seen,'full original gap membership');seen.add(entry.name)
            raw=archive.extractfile(entry).read();r=expected[entry.name];need(len(raw)==r['bytes'] and sha(raw)==r['sha256'],'whole original gap body '+entry.name)
    need(seen==set(expected),'original gap omitted body')
    generated={}
    for name,digest in {'virgl-shader.wasm':'acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc','virgl-shader.mjs':'6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa'}.items():
        path='renderer/virgl-shader/build/wasm/'+name;need(sha((ROOT/path).read_bytes())==digest,'unchanged generated compiler '+name);generated[path]=digest
    primary=json.loads((ROOT/'tools/virgl-stencil/primary.json').read_text());primary['sources']+=json.loads((ROOT/'tools/virgl-floating-depth/primary.json').read_text())['sources']+json.loads((ROOT/'tools/virgl-floating-depth-consumer/primary.json').read_text())['sources']
    for row in primary['sources']:
        raw=(ROOT/row['path']).read_bytes();need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'whole pinned primary '+row['path'])
    result=dict(schema='original-ordered-stencil-held-predecessors-v1',status='passed',predecessor=BASE,records=rows,reopenedMembers=sum(r['members'] for r in rows),unchangedBoundaries=boundaries,generated=generated,primary=primary,negativeRecordSha256=sha((ROOT/negative).read_bytes()),gapReopenedMembers=len(seen))
    Path(directory,'predecessor-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status='passed',reopenedMembers=result['reopenedMembers'])))
if __name__=='__main__':main(sys.argv[1])
