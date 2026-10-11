#!/usr/bin/env python3
"""Authenticate the complete frozen original command/native recording."""
import gzip,hashlib,json,subprocess,sys,time
from pathlib import Path
from predecessor import BASE
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
RUNTIME={'renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs'}
def main(directory):
    directory=Path(directory);head=git('rev-parse','HEAD');assert not git('diff','--name-only','HEAD')
    for _ in range(500):
        if b'\nPACKED_DEPTH_CONSUMER_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete frozen recording')
    load=lambda name:json.loads((directory/name).read_text());sources={};generated={}
    predecessor=load('predecessor-audit.json');assert predecessor['status']=='passed' and predecessor['predecessor']==BASE and predecessor['reopenedMembers']==43044
    values=load('independent-values.json');assert values['status']=='passed' and not values['oracleImportsProductCode'];audits=values['records']
    names=['wire','hardware-samples','hardware-surfaces','hardware-domain','hardware-failures']+['hardware-boundaries-'+seed for seed in ['0xa5471e03','0x13579bdf','0x9e3779b9']]+['fault-'+fault for fault in ['sample-plane','completed-output','depth-attachment','completed-depth','completed-stencil']]
    legacy=['retained-un16-samples','retained-un16-surfaces','retained-floating-samples','retained-floating-surfaces','retained-packed-storage']
    def source(name,digest=None):
        raw=(ROOT/name).read_bytes();actual=sha(raw);assert digest is None or actual==digest,name
        if '/build/wasm/' in name:generated[name]=actual
        elif name not in sources:
            assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),name;sources[name]=actual
        else:assert actual==sources[name],name
    for name in names+legacy:
        report=load(name+'/report.json');assert report['gitHead']==head and report['status']==('failed' if name.startswith('fault-') else 'passed')
        assert report['browserErrors']==dict(console=[],page=[],requests=[])
        for row in report['sources']:
            source(row['path'],row['sha256']);assert sha((directory/name/'source'/row['path']).read_bytes())==row['sha256']
        if name=='wire':
            assert len(report['wire']['records'])==22 and all(p['held'] for p in report['wire']['predictions']);continue
        assert report['browser']['headless'] is False and not any(any(s in arg.lower() for s in ['swiftshader','llvmpipe','softpipe','lavapipe']) or arg.startswith('--disable-gpu') for arg in report['browser']['commandLine'])
        evidence=report.get('partial') or report['browserResult']['result'];assert 'Metal' in str(evidence.get('gpu',evidence.get('renderer'))) and 'M4' in str(evidence.get('gpu',evidence.get('renderer')))
        assert not evidence['guestExecution'] and not evidence['productionNegotiation']
        if name in names:
            if name.startswith('hardware-'):
                assert all(p['held'] for p in evidence['predictions']) and audits[name]['status']=='passed'
                for ref in evidence['runs']:
                    if 'path' in ref:
                        body=(directory/name/ref['path']).read_bytes();assert len(body)==ref['bytes'] and sha(body)==ref['sha256'];row=json.loads(body)
                    else:row=ref
                    assert all(p['held'] for p in row.get('predictions',[]))
                assert len(evidence['runs'])=={'hardware-samples':22,'hardware-surfaces':120,'hardware-domain':2,'hardware-failures':10}.get(name,8)
                if name=='hardware-domain':assert audits[name]['counts']['stratifiedOriginalPackedValues']==131072 and audits[name]['counts']['originalS8Values']==256
            else:assert audits[name]['status']=='refuted' and audits[name]['differences']
        served={row['path']:row['sha256'] for row in report['servedFiles']};coverage=load(name+'/'+report['browserCoverage']['path'])
        if name!='retained-packed-storage':assert RUNTIME<={r['source'] for r in coverage['scripts']}
        for row in coverage['scripts']:assert sha(row['sourceBody'].encode())==row['sha256']==served['/'+row['source']]
        for row in evidence['blobs']:
            z=(directory/name/row['path']).read_bytes();assert sha(z)==row['gzipSha256'];raw=gzip.decompress(z);assert len(raw)==row['bytes'] and sha(raw)==row['sha256']
        for key in ['screenshot','browserCoverage']:
            row=report[key];assert sha((directory/name/row['path']).read_bytes())==row['sha256']
    assert generated==predecessor['generated'],'unchanged actual compiler identities'
    coverage=load('coverage-audit.json');assert coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['positive'] and not coverage['zero']
    changed={n for n in git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines() if '/tests/' not in n and not n.endswith('.md')};assert changed==RUNTIME
    assert not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest')
    roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-command','tools/virgl-packed-depth-consumer','tools/virgl-unorm-depth','tools/virgl-floating-depth-consumer','tools/virgl-packed-depth','tools/virgl-floating-depth/primary','tools/virgl-packed-unsigned-consumer','tools/virgl-multiple-color','tools/virgl-integer-image-consumer','tools/virgl-integer-image-shader','tools/virgl-packed-normalized-consumer','tools/virgl-shared-exponent-consumer','tools/verify-virgl-standard-packed-depth-consumer.mjs','tools/verify-virgl-standard-packed-depth-consumer.sh','Makefile','tools/check_task_policy.py','AGENTS.md','web/package.json','web/package-lock.json','tasks/epic-6-transcendence/E6-T11d43-standard-packed-depth-consumer.md','evidence/virgl-production-readiness/standard-packed-depth-consumer-gap.mjs','evidence/virgl-production-readiness/standard-packed-depth-consumer-gap.json']
    for name in git('ls-files',*roots).splitlines():source(name)
    for row in predecessor['records']:
        for name,digest in row['digests'].items():source(row['path']+'/'+name,digest)
    for name,digest in predecessor['unchangedBoundaries'].items():source(name,digest)
    for row in predecessor['primary']['sources']:source(row['path'],row['sha256'])
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    receipt=dict(schema='original-packed-depth-consumer-receipt-v1',task='E6-T11d43',status='passed',gitHead=head,predecessor=BASE,sources=sources,generated=generated,files=files,dependency=predecessor,audits=audits,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print('Frozen original packed UN24 guest consumers and native planes authenticated.')
if __name__=='__main__':main(sys.argv[1])
