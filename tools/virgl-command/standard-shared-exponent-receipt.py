#!/usr/bin/env python3
"""Authenticate original unsigned packed fields, full native planes and closures."""
import gzip,hashlib,json,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='cd59854e79cedf31abe35585bbe1fe616a8fc7ae'
TASK='E6-T11d29'
CONFIRMATION='Frozen original RGB9E5 words, native planes and retained ranges authenticated.\n'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def need(value,message):
    if not value:raise ValueError(message)
def main(directory):
    directory=Path(directory).resolve();head=git('rev-parse','HEAD');files={};sources={};generated={}
    need(not git('diff','--name-only','HEAD'),'freeze tracked source before recording')
    def record(name,digest=None):
        raw=(directory/name).read_bytes();need(digest is None or sha(raw)==digest,'record drift '+name);files[name]=sha(raw);return raw
    def source(name,digest=None):
        raw=(ROOT/name).read_bytes();need(digest is None or sha(raw)==digest,'source drift '+name)
        if '/build/' in name:generated[name]=sha(raw)
        else:
            need(raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),'unfrozen source '+name);sources[name]=sha(raw)
    for _ in range(500):
        if b'\nSHARED_EXPONENT_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('recording log incomplete')
    wire=json.loads(record('wire/report.json'))
    need(wire['gitHead']==head and wire['task']==TASK and wire['status']=='passed','original wire exact-head identity')
    need(len(wire['wire']['records'])==43 and len(wire['wire']['predictions'])==119 and all(p['held'] for p in wire['wire']['predictions']),'original wire/ownership/budget predictions')
    for row in wire['sources']:source(row['path'],row['sha256'])
    serving=json.loads(record('serving-audit.json'));need(serving['gitHead']==head and serving['predecessor']==BASE and serving['status']=='passed' and len(serving['records'])==27 and all(row['held'] for row in serving['records']),'historical imported-source closure')
    for row in serving['sources']+serving['records']:source(row['path'],row['sha256'])
    scalar=json.loads(record('scalars/report.json'));original=record('scalars/original.bin');canonical=record('scalars/canonical.bin')
    need(scalar['status']=='passed' and scalar['vectors']==59264 and scalar['allExponents']==32 and scalar['allLaneMantissas']==512 and scalar['lanes']==3 and scalar['refinementCases']==0,'independent original rational packing proof')
    need(scalar['originalSha256']==sha(original) and scalar['canonicalSha256']==sha(canonical) and len(original)==len(canonical)==59264*4,'complete scalar input/output custody')
    names=['hardware-matrix']+['hardware-boundaries-'+seed for seed in ('0xa5471e03','0x13579bdf','0x9e3779b9')]
    faults=['fault-packing-field','fault-copy-level']
    for name in names+faults:
        fault=name.startswith('fault-');envelope=json.loads(record(name+'/report.json'))
        need(envelope['gitHead']==head and envelope['task']==TASK and envelope['status']==('failed' if fault else 'passed'),'physical exact-head identity '+name)
        need(envelope['browserErrors']==dict(console=[],page=[],requests=[]),'native browser errors '+name)
        need(not envelope['browser']['headless'],'headed native proof')
        need(not any(any(word in arg.lower() for word in ('swiftshader','llvmpipe','softpipe','lavapipe')) or arg.startswith('--disable-gpu') for arg in envelope['browser']['commandLine']),'software rendering flags')
        report=envelope['partial'] if fault else envelope['browserResult']['result']
        need('M4' in report['gpu'] and 'Metal' in report['gpu'],'actual M4 Metal')
        need(not report['guestExecution'] and not report['productionNegotiation'] and not report['productionDrawAuthority'],'isolated resource authority')
        served={row['path']:row['sha256'] for row in envelope['servedFiles']}
        for row in envelope['sources']:
            source(row['path'],row['sha256'])
            if '/'+row['path'] in served:need(served['/'+row['path']]==row['sha256'],'actual served source identity')
        for key in ('browserCoverage','screenshot'):record(name+'/'+envelope[key]['path'],envelope[key]['sha256'])
        coverage=json.loads(record(name+'/'+envelope['browserCoverage']['path']))
        need({'renderer/virgl-command/resources.mjs','renderer/virgl-command/shared-exponent-images.mjs','renderer/virgl-command/shared-exponent-gpu.mjs'}<={row['source'] for row in coverage['scripts']},'complete native runtime coverage')
        for row in coverage['scripts']:need(row['sha256']==served['/'+row['source']],'full-region source custody')
        need(len({row['key'] for row in report['blobs']})==len(report['blobs']),'unique full blob keys')
        for row in report['blobs']:
            raw=gzip.decompress(record(name+'/'+row['path'],row['gzipSha256']));need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'native original blob custody')
        for run in report['runs']:
            need(all(value==0 for value in run['final']['budgets'].values()),'terminal owner budgets')
            need(all(row['deleted']==1 for row in run['nativeObjects']),'once-only native cleanup')
        if fault:
            need(report['sabotage']['fenceCompleted'] and not report['sabotage']['held'],'unchanged original inverse fails after native fence')
            need(any(run['faultEvents'] for run in report['runs']),'actual native control executed')
        else:
            need(all(row['held'] for row in report['predictions']),'original native predictions held')
            need(len(report['runs'])==(11 if name=='hardware-matrix' else 34),'complete original packed storage matrix')
            if name!='hardware-matrix':
                need(report['seed']==int(name.rsplit('-',1)[1],16),'varied native schedule')
                need(report['hostRefusal']['nativeAllocations']==0 and report['hostRefusal']['result']['error']['code']=='unsupported-host','extension refusal before native allocation')
    values=json.loads(record('independent-values.json'))
    need(values['status']=='passed' and values['runs']==113 and len(values['faults'])==2,'complete independent native/public inverse')
    need(values['nativeComponents']>10000 and values['publicBytes']>10000 and values['footprintChecks']>300,'complete original packed data and physical byte budgets')
    need(all(row['status']=='refuted' and row['fenceCompleted'] for row in values['faults']),'all physical controls independently refuted')
    coverage=json.loads(record('coverage-audit.json'))
    need(coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['fullRegionsRemainAuthority'],'full changed-runtime recording')
    inverse=json.loads((ROOT/'tools/virgl-command/standard-shared-exponent-boundary.json').read_text());boundaries={}
    need(inverse['predecessor']==BASE and set(inverse['changes'])=={'renderer/virgl-command/resources.mjs','renderer/virgl-command/shared-exponent-images.mjs','renderer/virgl-command/shared-exponent-gpu.mjs'},'isolated product boundary')
    for name,rows in inverse['changes'].items():
        current=(ROOT/name).read_text()
        for row in reversed(rows):
            need(current.count(row['after'])==1,'unambiguous original inverse '+name);current=current.replace(row['after'],row['before'],1)
        original=subprocess.run(['git','show',BASE+':'+name],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        need(current.encode()==(original.stdout if original.returncode==0 else b''),'original resource source boundary '+name);boundaries[name]=sha(current.encode())
    for name in ['renderer/virgl-command/'+name+'.mjs' for name in ('decoder','state','cache','constant-domain','color-images','float-images','packed-float-images')]:
        source(name);need((ROOT/name).read_bytes()==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT),'unchanged consumer/storage boundary '+name);boundaries[name]=sources[name]
    need(not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest'),'unqualified production surfaces unchanged')
    carried={}
    for prefix in ('evidence/virgl-standard-float-consumer','evidence/virgl-standard-packed-float-images','evidence/virgl-standard-packed-float-consumer'):
        for name in git('ls-files',prefix).splitlines():
            source(name);need((ROOT/name).read_bytes()==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT),'unchanged predecessor proof '+name);carried[name]=sources[name]
        for role in ('worker','verifier'):
            folder=prefix+'/'+role+'/';manifest=json.loads((ROOT/(folder+'manifest.json')).read_text())
            need(carried[folder+'recording.tar.gz']==manifest['archiveSha256'] and carried[folder+'records.json']==manifest['recordIndexSha256'],'complete predecessor seal custody')
    descriptor=json.loads((ROOT/'tools/virgl-command/standard-shared-exponent-formats.json').read_text())
    for row in descriptor['primarySources']:source(row['path'],row['sha256'])
    need(descriptor['format']==125 and descriptor['originalPixelBytes']==4 and descriptor['nativePixelBytes']==4 and descriptor['nativeReadPixelBytes']==4 and descriptor['conversionPixelBytes']==4 and descriptor['privateCopyAuxiliaryPixelBytes']==8,'original 32-bit packed field layout')
    for name in git('ls-files','renderer/virgl-command','renderer/virgl-shader','tools/verify-virgl-standard-shared-exponent-images*','tools/virgl-command/standard-shared-exponent*','Makefile','tasks/epic-6-transcendence/E6-T11d29-standard-shared-exponent-images.md').splitlines():source(name)
    for name in ('retained-packed-storage','retained-packed-consumer','retained-float-consumer','retained-async-jobs'):
        envelope=json.loads(record(name+'/report.json'));need(envelope['gitHead']==head and envelope['status']=='passed','affected native predecessor '+name)
        for row in envelope['sources']:source(row['path'],row['sha256'])
    for file in directory.rglob('*'):
        if file.is_file() and file.name!='receipt.json':record(file.relative_to(directory).as_posix())
    receipt=dict(schema='original-shared-exponent-image-receipt-v1',task=TASK,status='passed',gitHead=head,nativeRuns=113,nativeSchedules=3,scalarPatterns=59264,valueAudit=values,historicalEvidenceHead=BASE,carriedVerifiedEvidence=carried,carriedUnchangedBoundaries=boundaries,sources=sources,generated=generated,files=files,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False,authority='isolated-original-rgb9e5-storage')
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(CONFIRMATION,end='')
if __name__=='__main__':main(sys.argv[1])
