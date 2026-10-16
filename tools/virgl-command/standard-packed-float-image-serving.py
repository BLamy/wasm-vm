#!/usr/bin/env python3
"""Prove historical test-server changes only add the required imported source."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT)
def main():
    directory=Path(sys.argv[1]);head=git('rev-parse','HEAD').decode().strip()
    boundary_name='tools/virgl-command/standard-packed-float-image-serving-boundary.json'
    boundary=json.loads((ROOT/boundary_name).read_text());base=boundary['predecessor'];rows=[]
    assert len(boundary['changes'])==26
    for row in boundary['changes']:
        name=row['path'];raw=(ROOT/name).read_bytes();assert raw==git('show',head+':'+name)
        text=raw.decode();assert text.count(row['after'])==1
        original=text.replace(row['after'],row['before'],1).encode();assert original==git('show',base+':'+name)
        assert 'renderer/virgl-command/packed-float-images.mjs' in text
        subprocess.run(['node','--check',str(ROOT/name)],check=True)
        rows.append(dict(path=name,sha256=sha(raw),predecessorSha256=sha(original),scope='test-server-source-declaration',held=True))
    names=[boundary_name,'tools/virgl-command/standard-packed-float-image-serving.py','renderer/virgl-command/resources.mjs','renderer/virgl-command/packed-float-images.mjs']
    sources=[]
    for name in names:
        raw=(ROOT/name).read_bytes();assert raw==git('show',head+':'+name);sources.append(dict(path=name,sha256=sha(raw)))
    assert 'from "./packed-float-images.mjs"' in (ROOT/'renderer/virgl-command/resources.mjs').read_text()
    result=dict(schema='original-packed-test-serving-audit-v1',task='E6-T11d27',gitHead=head,predecessor=base,status='passed',nativeExecuted=False,productionNegotiation=False,authority='source-declarations-only',records=rows,sources=sources)
    (directory/'serving-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Authenticated 26 historical source declarations and unchanged server algorithms.')
if __name__=='__main__':main()
