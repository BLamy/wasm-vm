#!/usr/bin/env python3
"""Authenticate held packed storage/consumer custody, scoped to unchanged sources."""
import hashlib,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='d64b2f5e782fee2090f7a0f435bdb0ea7a0a1081'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def need(value,message):
    if not value:raise ValueError(message)
def main(directory):
    Path(directory).mkdir(parents=True,exist_ok=True);rows=[]
    for family in ('virgl-floating-depth-consumer',):
        for role in ('worker','verifier'):
            folder='evidence/'+family+'/'+role;files={}
            for name in ('manifest.json','records.json','recording.tar.gz'):
                path=folder+'/'+name;raw=(ROOT/path).read_bytes()
                need(raw==subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT),'held seal changed '+path)
                files[name]=sha(raw)
            manifest=json.loads((ROOT/folder/'manifest.json').read_text());index=json.loads((ROOT/folder/'records.json').read_text())
            need(manifest['archiveSha256']==files['recording.tar.gz'] and manifest['recordIndexSha256']==files['records.json'],'held custody digests')
            expected={row['path']:row for row in index['records']};seen=set();total=0
            with tarfile.open(ROOT/folder/'recording.tar.gz','r:gz') as archive:
                for entry in archive:
                    need((entry.isfile() or entry.islnk()) and entry.name in expected and entry.name not in seen,'held archive membership')
                    seen.add(entry.name);raw=archive.extractfile(entry).read();record=expected[entry.name];total+=len(raw)
                    need(len(raw)==record['bytes'] and sha(raw)==record['sha256'],'held member drift '+entry.name)
            need(seen==set(expected),'held archive incomplete')
            rows.append(dict(path=folder,members=len(seen),uncompressedBytes=total,digests=files))
    boundaries={}
    names=('floating-depth-images','floating-depth-gpu','constant-domain','integer-images','packed-normalized-images','float-images','packed-float-images','shared-exponent-images','shared-exponent-gpu','color-images','packed-unsigned-images')
    for name in names:
        path='renderer/virgl-command/'+name+'.mjs';raw=(ROOT/path).read_bytes()
        need(raw==subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT),'held runtime boundary '+path);boundaries[path]=sha(raw)
    paths=subprocess.check_output(['git','ls-files','renderer/virgl-shader'],cwd=ROOT,text=True).splitlines()
    for path in paths:
        raw=(ROOT/path).read_bytes();need(raw==subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT),'held actual compiler '+path);boundaries[path]=sha(raw)
    negative='evidence/virgl-production-readiness/standard-unorm-depth-image-gap.json'
    refusal=json.loads((ROOT/negative).read_text())
    need(refusal['gitHead']==BASE and len(refusal['rows'])==16 and refusal['nativeExecuted'] is False,'exact predecessor original refusals')
    need(sum(not r['result']['ok'] for r in refusal['rows'])==13 and sum(r['legacy'] and r['result']['ok'] for r in refusal['rows'])==3,'thirteen refusals and three held legacy admissions')
    for row in refusal['sources']:
        raw=subprocess.check_output(['git','show',BASE+':'+row['path']],cwd=ROOT)
        need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'negative source pin '+row['path'])
    generated={}
    pins={'virgl-shader.wasm':'acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc','virgl-shader.mjs':'6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa'}
    for name,digest in pins.items():
        path='renderer/virgl-shader/build/wasm/'+name;need(sha((ROOT/path).read_bytes())==digest,'unchanged built actual C/Wasm '+name);generated[path]=digest
    primary=json.loads((ROOT/'tools/virgl-unorm-depth/primary.json').read_text())
    for row in primary['sources']:
        raw=(ROOT/row['path']).read_bytes();need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'whole original primary source '+row['path'])
    result=dict(primary=primary,schema='unorm-depth-held-predecessors-v1',status='passed',predecessor=BASE,records=rows,reopenedMembers=sum(row['members'] for row in rows),unchangedBoundaries=boundaries,generated=generated,negativeRecordSha256=sha((ROOT/negative).read_bytes()))
    Path(directory,'predecessor-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({key:result[key] for key in ('status','reopenedMembers')}))
if __name__=='__main__':main(sys.argv[1])
