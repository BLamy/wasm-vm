#!/usr/bin/env python3
"""Reopen D35 seals and carry unchanged compiler/storage/contract facts only."""
import hashlib,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='3e5e41429aadc9acbe68fade926d2763d1e2a356'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT)

def main(directory):
    output=Path(directory).resolve();output.mkdir(parents=True,exist_ok=True);seals=[];generated={}
    for role in ['worker','verifier']:
        base=ROOT/'evidence/virgl-standard-packed-normalized-images'/role
        manifest_raw=(base/'manifest.json').read_bytes();manifest=json.loads(manifest_raw);index_raw=(base/'records.json').read_bytes()
        assert sha(index_raw)==manifest['recordIndexSha256'] and sha((base/'recording.tar.gz').read_bytes())==manifest['archiveSha256']
        records=json.loads(index_raw)['records'];wanted={r['path']:r for r in records};assert len(wanted)==len(records)==manifest['records'];seen=set()
        with tarfile.open(base/'recording.tar.gz','r:gz') as archive:
            for member in archive:
                assert member.isfile() and member.name in wanted and member.name not in seen
                raw=archive.extractfile(member).read();r=wanted[member.name];assert len(raw)==r['bytes'] and sha(raw)==r['sha256'];seen.add(member.name)
                if role=='worker' and member.name.startswith('hot-generated/renderer/virgl-shader/build/wasm/'):
                    name=member.name[len('hot-generated/'):];assert (ROOT/name).read_bytes()==raw;generated[name]=r['sha256']
        assert seen==set(wanted)
        for name in ['manifest.json','records.json','recording.tar.gz']:
            relative=(base/name).relative_to(ROOT).as_posix();assert (base/name).read_bytes()==git('show',BASE+':'+relative)
        seals.append(dict(role=role,members=len(seen),archiveSha256=manifest['archiveSha256'],recordIndexSha256=sha(index_raw),manifestSha256=sha(manifest_raw)))
    assert set(generated)=={'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
    unchanged=[]
    prefixes=['renderer/virgl-shader','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/resources.mjs',
        'renderer/virgl-command/packed-normalized-images.mjs','renderer/virgl-command/integer-images.mjs',
        'renderer/virgl-command/shared-exponent-gpu.mjs','renderer/virgl-command/color-images.mjs','renderer/virgl-command/float-images.mjs',
        'renderer/virgl-command/packed-float-images.mjs','renderer/virgl-command/shared-exponent-images.mjs']
    for name in git('ls-tree','-r','--name-only',BASE,'--',*prefixes).decode().splitlines():
        raw=(ROOT/name).read_bytes();assert raw==git('show',BASE+':'+name);unchanged.append(dict(path=name,bytes=len(raw),sha256=sha(raw)))
    negative=json.loads((ROOT/'evidence/virgl-production-readiness/standard-packed-normalized-consumer-gap.json').read_text())
    assert negative['gitHead']==BASE and len(negative['records'])==39 and not negative['nativeExecuted']
    for source in negative['sources']:
        raw=git('show',BASE+':'+source['path']);assert sha(raw)==source['sha256'] and len(raw)==source['bytes']
    result=dict(status='passed',predecessor=BASE,seals=seals,generated=generated,unchanged=unchanged,
        historicalConsumerRuntimeCarried=False,compilerStorageContractFactsCarried=True,guestExecution=False,productionNegotiation=False)
    (output/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status='passed',members=sum(row['members'] for row in seals),unchanged=len(unchanged))))

if __name__=='__main__':main(sys.argv[1])
