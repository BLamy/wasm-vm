#!/usr/bin/env python3
"""Bind complete packed UINT records to frozen sources and held dependency custody."""
import gzip,hashlib,json,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];BASE='ec96d7544bb86c9defda0b7abc60e447a0a634b9';TASK='E6-T11d37'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def need(value,message):
    if not value:raise ValueError(message)
def main(directory):
    directory=Path(directory).resolve();head=git('rev-parse','HEAD');files={};sources={};generated={}
    need(not git('diff','--name-only','HEAD'),'freeze tracked sources before final recording')
    def source(name,digest=None):
        raw=(ROOT/name).read_bytes();need(digest is None or sha(raw)==digest,'source digest '+name)
        if '/build/wasm/' in name:generated[name]=sha(raw)
        else:need(raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),'unfrozen source '+name);sources[name]=sha(raw)
    def record(name,digest=None):
        raw=(directory/name).read_bytes();need(digest is None or sha(raw)==digest,'record digest '+name);files[name]=sha(raw);return raw
    for _ in range(500):
        if b'\nPACKED_UNSIGNED_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete final recording')
    wire=json.loads(record('wire/report.json'));need(wire['gitHead']==head and wire['task']==TASK and wire['status']=='passed' and all(p['held'] for p in wire['wire']['predictions']),'all exact-head original wire predictions')
    need(sum(r['kind']=='old-owner' for r in wire['wire']['records'])==132 and sum(r['kind']=='old-layout' for r in wire['wire']['records'])==120,'historical packed UINT ownership/layout boundaries stay closed')
    need(sum(r['kind']=='old-consumer' and not r['result']['ok'] for r in wire['wire']['records'])==6,'complete original sampler/surface consumer refusals')
    names=['hardware-matrix']+['hardware-boundaries-'+s for s in ('0xa5471e03','0x13579bdf','0x9e3779b9')]+['fault-'+f for f in ('upload-lane','copy-level','completed-word')]
    for name in names:
        fault=name.startswith('fault-');envelope=json.loads(record(name+'/report.json'))
        need(envelope['gitHead']==head and envelope['task']==TASK and envelope['status']==('failed' if fault else 'passed'),'exact-head browser recording '+name)
        need(envelope['browserErrors']==dict(console=[],page=[],requests=[]) and not envelope['browser']['headless'],'headed error-free browser proof')
        need(not any(any(word in arg.lower() for word in ('swiftshader','llvmpipe','softpipe','lavapipe')) or arg.startswith('--disable-gpu') for arg in envelope['browser']['commandLine']),'no software renderer flag')
        result=envelope['partial'] if fault else envelope['browserResult']['result'];need('M4' in result['gpu'] and 'Metal' in result['gpu'],'actual Apple Metal GPU')
        need(not result['guestExecution'] and not result['productionNegotiation'] and not result['productionDrawAuthority'],'selected storage authority only')
        served={row['path']:row['sha256'] for row in envelope['servedFiles']}
        for row in envelope['sources']:
            source(row['path'],row['sha256'])
            if '/'+row['path'] in served:need(served['/'+row['path']]==row['sha256'],'served immutable source')
        for key in ('browserCoverage','screenshot'):record(name+'/'+envelope[key]['path'],envelope[key]['sha256'])
        coverage=json.loads(record(name+'/'+envelope['browserCoverage']['path']));need({'renderer/virgl-command/resources.mjs','renderer/virgl-command/packed-unsigned-images.mjs'}<={r['source'] for r in coverage['scripts']},'full native V8 runtime ranges')
        for row in coverage['scripts']:need(row['sha256']==served['/'+row['source']],'nested V8 source identity')
        for row in result['blobs']:
            raw=gzip.decompress(record(name+'/'+row['path'],row['gzipSha256']));need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'complete integer native/public custody')
        for run in result['runs']:need(all(v==0 for v in run['final']['budgets'].values()) and all(o['deleted']==1 for o in run['nativeObjects']),'zero final charges and once-only native retirement')
        if fault:need(result['sabotage']['fenceCompleted'] and not result['sabotage']['held'] and any(r['faultEvents'] for r in result['runs']),'physical wrong integer pixels caught after completion')
        else:
            need(all(p['held'] for p in result['predictions']),'all original integer native predictions')
            need(len(result['runs'])==(26 if name=='hardware-matrix' else 22),'complete original matrix/schedules')
            if name=='hardware-matrix':need(sum(r['dense'] and r['metadata']['width']==65 and r['metadata']['height']==65 for r in result['runs'])==2,'both dense ten-bit/alpha layouts')
    values=json.loads(record('independent-values.json'));need(values['status']=='passed' and not values['oracleImportsProductCode'] and len(values['faults'])==3 and all(f['status']=='refuted' and f['fenceCompleted'] for f in values['faults']),'independent complete UINT inverse catches native corruptions')
    coverage=json.loads(record('coverage-audit.json'));need(coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['fullRegionsRemainAuthority'] and coverage['positive']>0 and not coverage['zero'],'all changed governing runtime partitions')
    predecessor=json.loads(record('predecessor-audit.json'));need(predecessor['status']=='passed' and predecessor['predecessor']==BASE and len(predecessor['records'])==4,'all held original dependency seals')
    serving=json.loads(record('serving-audit.json'));need(serving['status']=='passed' and serving['predecessor']==BASE and serving['gitHead']==head and len(serving['records'])==27 and all(row['held'] for row in serving['records']),'only declared historical imported-source additions')
    for row in serving['records']:source(row['path'],row['sha256'])
    carried={}
    for row in predecessor['records']:
        for name,digest in row['digests'].items():source(row['path']+'/'+name,digest);carried[row['path']+'/'+name]=digest
    for path,digest in predecessor['unchangedBoundaries'].items():source(path,digest)
    for path,digest in predecessor['generated'].items():source(path,digest)
    runtime=[n for n in git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines() if '/tests/' not in n and not n.endswith('.md')]
    need(set(runtime)=={'renderer/virgl-command/resources.mjs','renderer/virgl-command/packed-unsigned-images.mjs'},'one packed UINT storage boundary')
    need(not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest'),'compiler/production surfaces unchanged')
    for name in ('retained-normalized-storage','retained-integer-storage','retained-float-storage','retained-packed-float-storage','retained-shared-storage','retained-byte-storage','retained-color-formats','retained-resource-jobs'):
        envelope=json.loads(record(name+'/report.json'));need(envelope['gitHead']==head and envelope['status']=='passed','affected historical native path '+name)
        for row in envelope['sources']:source(row['path'],row['sha256'])
        for key in ('browserCoverage','screenshot'):
            if key in envelope:record(name+'/'+envelope[key]['path'],envelope[key]['sha256'])
    for row in wire['sources']:source(row['path'],row['sha256'])
    for name in git('ls-files','renderer/virgl-command','renderer/virgl-shader','tools/virgl-command/standard-packed-unsigned*','tools/verify-virgl-standard-packed-unsigned-images*','Makefile','tasks/epic-6-transcendence/E6-T11d37-standard-packed-unsigned-images.md','evidence/virgl-production-readiness/standard-packed-unsigned*').splitlines():source(name)
    for path in directory.rglob('*'):
        if path.is_file() and path.name!='receipt.json':record(path.relative_to(directory).as_posix())
    receipt=dict(schema='original-packed-unsigned-receipt-v1',status='passed',task=TASK,gitHead=head,sources=sources,generated=generated,files=files,valueAudit=values,carriedVerifiedEvidence=carried,carriedUnchangedBoundaries=predecessor['unchangedBoundaries'],guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print('Frozen original packed unsigned words, native planes and retained ranges authenticated.')
if __name__=='__main__':main(sys.argv[1])
