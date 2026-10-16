#!/usr/bin/env python3
"""Authenticate held storage and multiple-attachment seals without reinterpreting claims."""
import hashlib,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='b57c3ae04e0bd306e6bb5877ff94c5d8f4d6df06'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def main(directory):
    rows=[]
    for family in ('virgl-standard-integer-images','virgl-multiple-color'):
        for role in ('worker','verifier'):
            folder='evidence/'+family+'/'+role;files={}
            for name in ('manifest.json','records.json','recording.tar.gz'):
                path=folder+'/'+name;raw=(ROOT/path).read_bytes()
                if raw!=subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT):raise ValueError('held seal changed '+path)
                files[name]=sha(raw)
            manifest=json.loads((ROOT/folder/'manifest.json').read_text());index=json.loads((ROOT/folder/'records.json').read_text())
            if manifest['archiveSha256']!=files['recording.tar.gz'] or manifest['recordIndexSha256']!=files['records.json']:raise ValueError('held seal digest')
            expected={row['path']:row for row in index['records']};seen=set();total=0
            with tarfile.open(ROOT/folder/'recording.tar.gz','r:gz') as archive:
                for entry in archive:
                    if not entry.isfile() or entry.name not in expected or entry.name in seen:raise ValueError('held archive membership')
                    seen.add(entry.name);raw=archive.extractfile(entry).read();record=expected[entry.name];total+=len(raw)
                    if len(raw)!=record['bytes'] or sha(raw)!=record['sha256']:raise ValueError('held member drift '+entry.name)
            if seen!=set(expected):raise ValueError('held archive incomplete')
            rows.append(dict(path=folder,members=len(seen),uncompressedBytes=total,digests=files))
    result=dict(schema='packed-normalized-held-predecessors-v1',status='passed',predecessor=BASE,records=rows,reopenedMembers=sum(row['members'] for row in rows))
    Path(directory,'predecessor-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({key:result[key] for key in ('status','reopenedMembers')}))
if __name__=='__main__':main(sys.argv[1])
