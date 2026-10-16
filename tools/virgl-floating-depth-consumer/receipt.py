#!/usr/bin/env python3
"""Authenticate complete frozen original floating depth consumer/native evidence."""
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
        if b'\nFLOATING_DEPTH_CONSUMER_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete frozen recording')
    load=lambda name:json.loads((directory/name).read_text());sources={};generated={}
    predecessor=load('predecessor-audit.json');assert predecessor['status']=='passed' and predecessor['predecessor']==BASE and len(predecessor['records'])==2
    values=load('independent-values.json');assert values['status']=='passed' and not values['oracleImportsProductCode'];audits=values['records']
    names=['wire','hardware-samples','hardware-surfaces']+['hardware-boundaries-'+seed for seed in ['0xa5471e03','0x13579bdf','0x9e3779b9']]+['fault-'+fault for fault in ['sample-plane','completed-output','depth-attachment','completed-depth']]
    legacy=['historical','historical-integer','historical-float','historical-normalized','retained-unsigned-consumer','retained-unsigned-boundary','retained-z16-consumer']
    def source(name,digest=None):
        raw=(ROOT/name).read_bytes();actual=sha(raw);assert digest is None or actual==digest,name
        if '/build/wasm/' in name:generated[name]=actual
        else:assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),name;sources[name]=actual
    for name in names+legacy:
        report=load(name+'/report.json');assert report['gitHead']==head and report['status']==('failed' if name.startswith('fault-') else 'passed')
        assert report['browserErrors']==dict(console=[],page=[],requests=[])
        for row in report['sources']:
            source(row['path'],row['sha256'])
            if name in names:assert sha((directory/name/'source'/row['path']).read_bytes())==row['sha256']
        if name=='wire':assert len(report['wire']['records'])==20 and all(p['held'] for p in report['wire']['predictions']);continue
        assert report['browser']['headless'] is False and not any(any(s in arg.lower() for s in ['swiftshader','llvmpipe','softpipe','lavapipe']) or arg.startswith('--disable-gpu') for arg in report['browser']['commandLine'])
        evidence=report.get('partial') or report['browserResult']['result'];assert 'Metal' in str(evidence.get('gpu',evidence.get('renderer'))) and 'M4' in str(evidence.get('gpu',evidence.get('renderer')))
        if name in names:
            assert not evidence['guestExecution'] and not evidence['productionNegotiation']
            if name.startswith('hardware-'):
                assert all(p['held'] for p in evidence['predictions']) and audits[name]['status']=='passed'
                assert len(evidence['runs'])=={'hardware-samples':22,'hardware-surfaces':40}.get(name,4)
            else:assert audits[name]['status']=='refuted' and audits[name]['differences']
            served={row['path']:row['sha256'] for row in report['servedFiles']}
            coverage=load(name+'/'+report['browserCoverage']['path']);assert RUNTIME<={r['source'] for r in coverage['scripts']}
            for row in coverage['scripts']:assert sha(row['sourceBody'].encode())==row['sha256']==served['/'+row['source']]
            for row in evidence['blobs']:
                z=(directory/name/row['path']).read_bytes();assert sha(z)==row['gzipSha256'];raw=gzip.decompress(z);assert len(raw)==row['bytes'] and sha(raw)==row['sha256']
        for key in ['screenshot','browserCoverage']:
            row=report[key];assert sha((directory/name/row['path']).read_bytes())==row['sha256']
    assert generated==predecessor['generated'],'unchanged actual C/Wasm rebuild'
    coverage=load('coverage-audit.json');assert coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['positive'] and not coverage['zero']
    changed={n for n in git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines() if '/tests/' not in n and not n.endswith('.md')};assert changed==RUNTIME
    assert not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest')
    roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-command','tools/virgl-floating-depth-consumer','tools/virgl-floating-depth/primary','tools/virgl-packed-unsigned-consumer','tools/virgl-multiple-color','tools/virgl-integer-image-consumer','tools/virgl-integer-image-shader','tools/virgl-packed-normalized-consumer','tools/virgl-shared-exponent-consumer',
        'tools/verify-virgl-standard-floating-depth-consumer.mjs','tools/verify-virgl-standard-floating-depth-consumer.sh','Makefile','tools/check_task_policy.py','AGENTS.md','web/package.json','web/package-lock.json',
        'tasks/epic-6-transcendence/E6-T11d40-standard-floating-depth-consumer.md','evidence/virgl-production-readiness/standard-floating-depth-consumer-gap.mjs','evidence/virgl-production-readiness/standard-floating-depth-consumer-gap.json']
    for name in git('ls-files',*roots).splitlines():source(name)
    for row in predecessor['records']:
        for name,digest in row['digests'].items():source(row['path']+'/'+name,digest)
    for name,digest in predecessor['unchangedBoundaries'].items():source(name,digest)
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    receipt=dict(schema='original-floating-depth-consumer-receipt-v1',task='E6-T11d40',status='passed',gitHead=head,predecessor=BASE,sources=sources,generated=generated,files=files,dependency=predecessor,audits=audits,
        guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print('Frozen original floating depth consumer packets and native planes authenticated.')
if __name__=='__main__':main(sys.argv[1])
