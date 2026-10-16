#!/usr/bin/env python3
"""Bind complete original floating depth submissions to one frozen source head."""
import gzip
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
BASE='d79868fbfbb70ef215de0eaeee34cf3bee70a008'
TASK='E6-T11d39'
RUNTIME={'renderer/virgl-command/resources.mjs','renderer/virgl-command/floating-depth-images.mjs','renderer/virgl-command/floating-depth-gpu.mjs'}
LEGACY=('retained-unsigned-storage','retained-normalized-storage','retained-integer-storage','retained-float-storage','retained-packed-float-storage','retained-shared-storage','retained-byte-storage','retained-color-formats','retained-z16-storage','retained-resource-jobs')
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def need(value,message):
    if not value:raise ValueError(message)

def main(directory):
    directory=Path(directory).resolve();head=git('rev-parse','HEAD');files={};sources={};generated={}
    need(not git('diff','--name-only','HEAD'),'freeze tracked sources before final recording')
    def source(name,digest=None):
        raw=(ROOT/name).read_bytes();actual=sha(raw);need(digest is None or actual==digest,'source digest '+name)
        if '/build/wasm/' in name:generated[name]=actual
        elif name not in sources:
            need(raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),'unfrozen source '+name);sources[name]=actual
        else:need(sources[name]==actual,'source drift '+name)
    def record(name,digest=None):
        raw=(directory/name).read_bytes();need(digest is None or sha(raw)==digest,'record digest '+name);files[name]=sha(raw);return raw
    for _ in range(500):
        if b'\nFLOATING_DEPTH_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete final recording')
    wire=json.loads(record('wire/report.json'));need(wire['gitHead']==head and wire['task']==TASK and wire['status']=='passed' and all(p['held'] for p in wire['wire']['predictions']),'exact-head original wire predictions')
    need(sum(r['kind']=='old-owner' for r in wire['wire']['records'])==144 and sum(r['kind']=='old-layout' for r in wire['wire']['records'])==132,'every preceding ownership/layout boundary stays closed')
    need(sum(r['kind']=='old-consumer' and not r['result']['ok'] for r in wire['wire']['records'])==6,'complete original consumer refusals')
    names=['hardware-matrix']+['hardware-boundaries-'+s for s in ('0xa5471e03','0x13579bdf','0x9e3779b9')]+['fault-'+f for f in ('depth-precision','stencil-selection','completed-depth')]
    for name in names:
        fault=name.startswith('fault-');envelope=json.loads(record(name+'/report.json'))
        need(envelope['gitHead']==head and envelope['task']==TASK and envelope['status']==('failed' if fault else 'passed'),'exact-head browser recording '+name)
        need(envelope['browserErrors']==dict(console=[],page=[],requests=[]) and not envelope['browser']['headless'],'headed error-free browser proof')
        need(not any(any(word in arg.lower() for word in ('swiftshader','llvmpipe','softpipe','lavapipe')) or arg.startswith('--disable-gpu') for arg in envelope['browser']['commandLine']),'no software renderer flag')
        result=envelope['partial'] if fault else envelope['browserResult']['result'];need('M4' in result['gpu'] and 'Metal' in result['gpu'],'actual Apple Metal GPU')
        need(not result['guestExecution'] and not result['productionNegotiation'] and not result['productionDrawAuthority'],'selected storage authority only')
        served={row['path']:row['sha256'] for row in envelope['servedFiles']}
        for row in envelope['sources']:
            source(row['path'],row['sha256']);record(name+'/source/'+row['path'],row['sha256'])
            if '/'+row['path'] in served:need(served['/'+row['path']]==row['sha256'],'served immutable source')
        for key in ('browserCoverage','screenshot'):record(name+'/'+envelope[key]['path'],envelope[key]['sha256'])
        coverage=json.loads(record(name+'/'+envelope['browserCoverage']['path']));need(RUNTIME<={r['source'] for r in coverage['scripts']},'full native V8 runtime ranges')
        for row in coverage['scripts']:need(row['sha256']==served['/'+row['source']] and sha(row['sourceBody'].encode())==row['sha256'],'full nested V8 source body identity')
        for row in result['blobs']:
            raw=gzip.decompress(record(name+'/'+row['path'],row['gzipSha256']));need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'complete original/native/public fields')
        for run in result['runs']:
            need(all(v==0 for v in run['final']['budgets'].values()) and all(o['deleted']==1 for o in run['nativeObjects']),'zero terminal charges and once-only native retirement')
            for fence in (e for e in run['events'] if e['name']=='fenceSync'):
                need(sum(e['name']=='deleteSync' and e['sync']==fence['sync'] for e in run['events'])==1,'every real sync retires once')
        if fault:need(result['sabotage']['fenceCompleted'] and not result['sabotage']['held'] and any(r['faultEvents'] for r in result['runs']),'physical wrong fields caught after completion')
        else:
            need(all(p['held'] for p in result['predictions']) and len(result['runs'])==(32 if name=='hardware-matrix' else 47),'all original matrix and schedule predictions')
            if name=='hardware-matrix':need(sum(r['exceptional'] for r in result['runs'])==2 and {r['metadata']['bind'] for r in result['runs']}=={1,8,9},'both exceptional input formats and all original depth/sampler roles')
    values=json.loads(record('independent-values.json'));need(values['status']=='passed' and not values['oracleImportsProductCode'] and values['stencilValues']==256 and len(values['faults'])==3 and all(f['status']=='refuted' and f['fenceCompleted'] for f in values['faults']),'independent complete field inverse catches native controls')
    coverage=json.loads(record('coverage-audit.json'));need(coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['fullRegionsRemainAuthority'] and coverage['positive']>0 and not coverage['zero'],'every changed executable governing partition')
    need(len(coverage['waived'])==5 and sum(r['classification']=='whitespace' for r in coverage['waived'])==4,'only exact whitespace and unchanged historical cleanup waivers')
    predecessor=json.loads(record('predecessor-audit.json'));need(predecessor['status']=='passed' and predecessor['predecessor']==BASE and len(predecessor['records'])==4,'all held original dependency seals')
    serving=json.loads(record('serving-audit.json'));need(serving['status']=='passed' and serving['predecessor']==BASE and serving['gitHead']==head and len(serving['records'])==25 and all(row['held'] for row in serving['records']),'only declared legacy import additions')
    for row in serving['records']:source(row['path'],row['sha256'])
    carried={}
    for row in predecessor['records']:
        for name,digest in row['digests'].items():source(row['path']+'/'+name,digest);carried[row['path']+'/'+name]=digest
    for name,digest in predecessor['unchangedBoundaries'].items():source(name,digest)
    for name,digest in predecessor['generated'].items():source(name,digest)
    changed={n for n in git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines() if '/tests/' not in n and not n.endswith('.md')}
    need(changed==RUNTIME,'one selected original floating depth storage boundary')
    need(not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest'),'actual compiler and production surfaces unchanged')
    for name in LEGACY:
        envelope=json.loads(record(name+'/report.json'));need(envelope['gitHead']==head and envelope['status']=='passed' and envelope['browserErrors']==dict(console=[],page=[],requests=[]),'affected historical native path '+name)
        for row in envelope['sources']:source(row['path'],row['sha256'])
        for key in ('browserCoverage','screenshot'):
            if key in envelope:record(name+'/'+envelope[key]['path'],envelope[key]['sha256'])
    for row in wire['sources']:source(row['path'],row['sha256'])
    for name in git('ls-files','.gitattributes','renderer/virgl-command','renderer/virgl-shader','tools/virgl-floating-depth','tools/virgl-command/standard-floating-depth*','tools/verify-virgl-standard-floating-depth-images*','Makefile','tasks/epic-6-transcendence/E6-T11d39-standard-floating-depth-images.md','evidence/virgl-production-readiness/standard-floating-depth*').splitlines():source(name)
    for path in directory.rglob('*'):
        if path.is_file() and path.name!='receipt.json':record(path.relative_to(directory).as_posix())
    receipt=dict(schema='original-floating-depth-receipt-v1',status='passed',task=TASK,gitHead=head,sources=sources,generated=generated,files=files,valueAudit=values,carriedVerifiedEvidence=carried,carriedUnchangedBoundaries=predecessor['unchangedBoundaries'],guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print('Frozen original floating depth fields, native planes and retained ranges authenticated.')

if __name__=='__main__':
    main(sys.argv[1])
