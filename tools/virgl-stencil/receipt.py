#!/usr/bin/env python3
"""Authenticate every complete source, wire, compiler, native and public body."""
import base64,gzip,hashlib,json,subprocess,sys,time
from pathlib import Path
from predecessor import BASE
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
RUNTIME={'renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs'}
MODES={'operations':96,'compares':32,'masks':16,'inactive':4,'clears':20,'absent':4,'failures':18}
SEEDS=['0xd9443211','0x13579bdf','0x9e3779b9'];FAULTS=['operation','value-mask','completed-output','completed-stencil']
def main(directory):
    directory=Path(directory);head=git('rev-parse','HEAD');assert not git('diff','--name-only','HEAD')
    for _ in range(500):
        if b'\nSTENCIL_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete frozen recording')
    load=lambda name:json.loads((directory/name).read_text());sources={};generated={};audits={}
    predecessor=load('predecessor-audit.json');assert predecessor['status']=='passed' and predecessor['predecessor']==BASE and predecessor['reopenedMembers']==74113
    def source(name,digest=None):
        raw=(ROOT/name).read_bytes();actual=sha(raw);assert digest is None or actual==digest,name
        if '/build/wasm/' in name:generated[name]=actual
        else:assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),name;sources[name]=actual
    names=['wire']+['hardware-'+m for m in MODES]+['hardware-boundaries-'+s for s in SEEDS]+['fault-'+f for f in FAULTS]+['retained-packed-surfaces','retained-floating-samples','retained-floating-surfaces']
    for name in names:
        report=load(name+'/report.json');assert report['gitHead']==head and report['status']==('failed' if name.startswith('fault-') else 'passed')
        assert report['browserErrors']==dict(console=[],page=[],requests=[])
        for row in report['sources']:
            source(row['path'],row['sha256']);assert sha((directory/name/'source'/row['path']).read_bytes())==row['sha256']
        if name=='wire':
            assert report['wire']['status']=='passed' and len(report['wire']['rows'])==20
            assert all(r['result']['ok']==(r['kind']!='refusal') for r in report['wire']['rows']);continue
        assert report['browser']['headless'] is False and not any(any(s in arg.lower() for s in ['swiftshader','llvmpipe','softpipe','lavapipe']) or arg.startswith('--disable-gpu') for arg in report['browser']['commandLine'])
        assert sha(Path(report['browser']['executable']).read_bytes())==report['browser']['sha256']
        e=report.get('partial') or report['browserResult']['result'];assert 'Metal' in str(e.get('gpu',e.get('renderer'))) and 'M4' in str(e.get('gpu',e.get('renderer')))
        assert not e['guestExecution'] and not e['productionNegotiation']
        for ref in e['runs']:
            if 'path' in ref:
                raw=(directory/name/ref['path']).read_bytes();assert len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];run=json.loads(raw)
            else:run=ref
            if not name.startswith('fault-'):assert all(r['held'] for r in run.get('predictions',[]))
            for history in run['history']:assert isinstance(history['hex'],str) and len(history['hex'])%8==0
        if name.startswith('hardware-') or name.startswith('fault-'):
            audit=load(name+'/independent-values.json');assert audit['oracleImportsProductCode'] is False and audit['sourceFieldsOnly'];audits[name]=audit
            assert audit['status']==('refuted' if name.startswith('fault-') else 'passed')
            if name.startswith('fault-'):assert audit['differences'] and len(e['runs'])==1
            else:
                expected=MODES.get(name[len('hardware-'):],8);assert len(e['runs'])==expected
                if name not in ['hardware-absent']:assert audit['counts']['originalS8Values']==256
                if name=='hardware-operations':assert audit['matrix']['operations']==list(range(8)) and audit['matrix']['faces']==['back','front'] and audit['matrix']['paths']==['depth-fail','depth-pass','fail']
                if name=='hardware-compares':assert audit['matrix']['functions']==list(range(8))
                if name=='hardware-masks':assert audit['matrix']['masks']==[0,1,15,85,127,128,170,255]
                if name=='hardware-clears':assert audit['counts']['wideClears']==17
                if name.startswith('hardware-boundaries-'):assert audit['matrix']['terminalModes']==['cancel','complete','owner-first','renderer-first'] and audit['counts']['disposalOnlySyncs']==4 and audit['counts']['blitWriters']>0
        else:
            audit=load(name+'/value-audit.json');assert audit['status']=='passed' and not audit['oracleImportsProductCode'];audits[name]=audit
        served={r['path']:r['sha256'] for r in report['servedFiles']};coverage=load(name+'/'+report['browserCoverage']['path']);assert RUNTIME<={r['source'] for r in coverage['scripts']}
        for row in coverage['scripts']:assert sha(row['sourceBody'].encode())==row['sha256']==served['/'+row['source']]
        for row in e['blobs']:
            z=(directory/name/row['path']).read_bytes();assert sha(z)==row['gzipSha256'];raw=gzip.decompress(z);assert len(raw)==row['bytes'] and sha(raw)==row['sha256']
        for key in ['screenshot','browserCoverage']:
            row=report[key];assert sha((directory/name/row['path']).read_bytes())==row['sha256']
    assert generated==predecessor['generated'],'unchanged actual compiler identities'
    wide=load('wide-clear-original-refusals.json');assert wide['sourceHead']==BASE and wide['executionHead']==head and len(wide['rows'])==4 and wide['nativeExecuted'] is False
    for row in wide['sources']:
        raw=base64.b64decode(row['base64']);assert len(raw)==row['bytes'] and sha(raw)==row['sha256'] and raw==subprocess.check_output(['git','show',BASE+':'+row['path']],cwd=ROOT)
    coverage=load('coverage-audit.json');assert coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['positive'] and not coverage['zero']
    changed={n for n in git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines() if '/tests/' not in n and not n.endswith('.md')};assert changed==RUNTIME
    assert not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest')
    roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-command','tools/virgl-stencil','tools/virgl-packed-depth-consumer','tools/virgl-floating-depth-consumer','tools/virgl-unorm-depth','tools/virgl-packed-depth','tools/virgl-floating-depth/primary','tools/virgl-packed-unsigned-consumer','tools/virgl-multiple-color','tools/virgl-integer-image-consumer','tools/virgl-integer-image-shader','tools/virgl-packed-normalized-consumer','tools/virgl-shared-exponent-consumer','tools/verify-virgl-standard-stencil.mjs','tools/verify-virgl-standard-stencil.sh','Makefile','tools/check_task_policy.py','AGENTS.md','web/package.json','web/package-lock.json','tasks/epic-6-transcendence/E6-T11d44-standard-stencil-consumer.md','evidence/virgl-production-readiness/standard-stencil-consumer-gap.mjs','evidence/virgl-production-readiness/standard-stencil-consumer-gap.json','evidence/virgl-production-readiness/standard-stencil-wide-clear-gap.mjs','evidence/virgl-production-readiness/standard-stencil-wide-clear-gap.json']
    for name in git('ls-files',*roots).splitlines():source(name)
    for row in predecessor['records']:
        for name,digest in row['digests'].items():source(row['path']+'/'+name,digest)
    for name,digest in predecessor['unchangedBoundaries'].items():source(name,digest)
    for row in predecessor['primary']['sources']:source(row['path'],row['sha256'])
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    receipt=dict(schema='original-stencil-receipt-v1',task='E6-T11d44',status='passed',gitHead=head,predecessor=BASE,sources=sources,generated=generated,files=files,dependency=predecessor,audits=audits,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print('Frozen original S8 stencil fields and native planes authenticated.')
if __name__=='__main__':main(sys.argv[1])
