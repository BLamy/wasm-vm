#!/usr/bin/env python3
"""Reopen D37 storage and D36 consumer seals and carry unchanged compiler/storage/contract facts only."""
import hashlib,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='f9f479c20d37d89d0d6da18675777a4a8fd7a7b9'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT)

def main(directory):
    output=Path(directory).resolve();output.mkdir(parents=True,exist_ok=True);seals=[];generated={}
    for family,role in [(family,role) for family in ['virgl-standard-packed-unsigned-images','virgl-packed-normalized-consumer'] for role in ['worker','verifier']]:
        base=ROOT/'evidence'/family/role
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
        seals.append(dict(family=family,role=role,members=len(seen),archiveSha256=manifest['archiveSha256'],recordIndexSha256=sha(index_raw),manifestSha256=sha(manifest_raw)))
    assert set(generated)=={'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
    unchanged=[]
    prefixes=['renderer/virgl-shader','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/resources.mjs',
        'renderer/virgl-command/packed-unsigned-images.mjs','renderer/virgl-command/packed-normalized-images.mjs','renderer/virgl-command/integer-images.mjs',
        'renderer/virgl-command/shared-exponent-gpu.mjs','renderer/virgl-command/color-images.mjs','renderer/virgl-command/float-images.mjs',
        'renderer/virgl-command/packed-float-images.mjs','renderer/virgl-command/shared-exponent-images.mjs']
    for name in git('ls-tree','-r','--name-only',BASE,'--',*prefixes).decode().splitlines():
        raw=(ROOT/name).read_bytes();assert raw==git('show',BASE+':'+name);unchanged.append(dict(path=name,bytes=len(raw),sha256=sha(raw)))
    negative=json.loads((ROOT/'evidence/virgl-production-readiness/standard-packed-unsigned-consumer-gap.json').read_text())
    assert negative['gitHead']==BASE and len(negative['records'])==6 and not negative['nativeExecuted']
    for source in negative['sources']:
        raw=git('show',BASE+':'+source['path']);assert sha(raw)==source['sha256'] and len(raw)==source['bytes']
    primary=[]
    for name,expected in [('u_format_pack.py','a4a2510d443c84059d25f2346c521d28d503c1744b76b2aa3079198ecc33f2bc'),('u_format_parse.py','d523a751f6a3334f7cbe2e5bdede1065c3629390cdbbe98e5d41109e3cf63ebb')]:
        relative='tools/virgl-packed-unsigned-consumer/spec/'+name;raw=(ROOT/relative).read_bytes();assert sha(raw)==expected
        primary.append(dict(path=relative,bytes=len(raw),sha256=sha(raw),archiveSha256='eeb29ca7e56cfaa8e8a79538dcf834e3b18e501c31bef5145e959ea437cc4216',upstreamPath='mesa-26.2.2/src/util/format/'+name))
    pack=(ROOT/primary[0]['path']).read_text();clamp=pack[pack.index('def clamp_expr('):pack.index('def conversion_expr(')]
    conversion=pack[pack.index('def conversion_expr('):pack.index('def generate_pack_kernel(')]
    kernel=pack[pack.index('def generate_pack_kernel('):pack.index('def generate_pack_kernel(')+5000]
    assert "return 'MIN2(%s, %s)' % (value, dst_max_native)" in clamp and 'clamp=True' in conversion and 'value = clamp_expr(src_channel, dst_channel, dst_native_type, value)' in conversion
    assert "if not src_norm and not dst_channel.norm:\n            # neither is normalized -- just cast" in conversion and 'value = conversion_expr(src_channel,' in kernel and 'clamp=False' not in kernel
    table=json.loads((ROOT/'tools/virgl-command/standard-packed-unsigned-formats.json').read_text());assert [r['originalFormat'] for r in table['records']]==[225,253]
    assert all(r['channels']==['UP10','UP10','UP10','UP2'] and [f['bits'] for f in r['rgbaFields']]==[10,10,10,2] and r['readPixelBytes']==16 and r['guestPixelBytes']==4 for r in table['records'])
    result=dict(status='passed',predecessor=BASE,seals=seals,generated=generated,unchanged=unchanged,primary=primary,pureUnsignedNarrowing=dict(rgbMaximum=1023,alphaMaximum=3,operation='saturate-before-packing'),
        historicalConsumerRuntimeCarried=False,compilerStorageContractFactsCarried=True,guestExecution=False,productionNegotiation=False)
    (output/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status='passed',members=sum(row['members'] for row in seals),unchanged=len(unchanged))))

if __name__=='__main__':main(sys.argv[1])
