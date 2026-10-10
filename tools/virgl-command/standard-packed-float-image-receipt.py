#!/usr/bin/env python3
"""Authenticate original unsigned packed fields, full native planes and closures."""
import gzip,hashlib,json,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE='a5085b5491f24b3c700fb7cef7b1629c2efef914'
TASK='E6-T11d27'
CONFIRMATION='Frozen original packed words, native planes and retained ranges authenticated.\n'
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
        if b'\nPACKED_FLOAT_IMAGE_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('recording log incomplete')
    wire=json.loads(record('wire/report.json'))
    need(wire['gitHead']==head and wire['task']==TASK and wire['status']=='passed','original wire exact-head identity')
    need(len(wire['wire']['records'])==39 and len(wire['wire']['predictions'])==107 and all(p['held'] for p in wire['wire']['predictions']),'original wire/ownership/budget predictions')
    for row in wire['sources']:source(row['path'],row['sha256'])
    vectors=json.loads(record('scalar-vectors.json'));scalar=json.loads(record('scalar-audit.json'))
    need(len(vectors['records'])==11950 and scalar['gitHead']==head and scalar['status']=='passed','independent scalar vectors')
    need(scalar['inputSha256']==files['scalar-vectors.json'] and all(row['held'] for row in scalar['records']),'original scalar custody')
    for row in scalar['sources']:source(row['path'],row['sha256'])
    names=['hardware-matrix']+['hardware-boundaries-'+seed for seed in ('0xa5471e03','0x13579bdf','0x9e3779b9')]
    faults=['fault-upload-lane','fault-copy-level']
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
        need({'renderer/virgl-command/resources.mjs','renderer/virgl-command/packed-float-images.mjs'}<={row['source'] for row in coverage['scripts']},'complete native runtime coverage')
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
            need(len(report['runs'])==(12 if name=='hardware-matrix' else 14),'complete original packed storage matrix')
            if name!='hardware-matrix':
                need(report['seed']==int(name.rsplit('-',1)[1],16),'varied native schedule')
                need(report['hostRefusal']['nativeAllocations']==0 and report['hostRefusal']['result']['error']['code']=='unsupported-host','extension refusal before native allocation')
    values=json.loads(record('independent-values.json'))
    need(values['status']=='passed' and values['runs']==54 and len(values['faults'])==2,'complete independent native/public inverse')
    need(values['nativeComponents']>10000 and values['publicInverseBytes']>10000 and values['footprintChecks']>300,'complete original packed data and physical byte budgets')
    need(all(row['status']=='refuted' and row['fenceCompleted'] for row in values['faults']),'all physical controls independently refuted')
    coverage=json.loads(record('coverage-audit.json'))
    need(coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['fullRegionsRemainAuthority'],'full changed-runtime recording')
    inverse=json.loads((ROOT/'tools/virgl-command/standard-packed-float-image-boundary.json').read_text());boundaries={}
    need(inverse['predecessor']==BASE and set(inverse['changes'])=={'renderer/virgl-command/resources.mjs','renderer/virgl-command/packed-float-images.mjs'},'isolated product boundary')
    for name,rows in inverse['changes'].items():
        current=(ROOT/name).read_text()
        for row in reversed(rows):
            need(current.count(row['after'])==1,'unambiguous original inverse '+name);current=current.replace(row['after'],row['before'],1)
        original=subprocess.run(['git','show',BASE+':'+name],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        need(current.encode()==(original.stdout if original.returncode==0 else b''),'original resource source boundary '+name);boundaries[name]=sha(current.encode())
    for name in ['renderer/virgl-command/'+name+'.mjs' for name in ('decoder','state','cache','constant-domain','color-images','float-images')]:
        source(name);need((ROOT/name).read_bytes()==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT),'unchanged consumer/storage boundary '+name);boundaries[name]=sources[name]
    need(not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest'),'unqualified production surfaces unchanged')
    carried={}
    for prefix in ('evidence/virgl-standard-float-consumer','evidence/virgl-standard-float-images'):
        for name in git('ls-files',prefix).splitlines():
            source(name);need((ROOT/name).read_bytes()==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT),'unchanged predecessor proof '+name);carried[name]=sources[name]
        for role in ('worker','verifier'):
            folder=prefix+'/'+role+'/';manifest=json.loads((ROOT/(folder+'manifest.json')).read_text())
            need(carried[folder+'recording.tar.gz']==manifest['archiveSha256'] and carried[folder+'records.json']==manifest['recordIndexSha256'],'complete predecessor seal custody')
    descriptor=json.loads((ROOT/'tools/virgl-command/standard-packed-float-image-formats.json').read_text())
    for row in descriptor['primarySources']:source(row['path'],row['sha256'])
    need(descriptor['format']==124 and descriptor['originalPixelBytes']==4 and descriptor['nativePixelBytes']==4 and descriptor['nativeReadPixelBytes']==16,'original 32-bit packed field layout')
    for name in git('ls-files','renderer/virgl-command','renderer/virgl-shader','tools/verify-virgl-standard-packed-float-images*','tools/virgl-command/standard-packed-float-image*','tools/virgl-command/standard_packed_float_scalar.py','Makefile','tasks/epic-6-transcendence/E6-T11d27-standard-packed-float-images.md').splitlines():source(name)
    for name in ('retained-float-storage','retained-async-jobs'):
        envelope=json.loads(record(name+'/report.json'));need(envelope['gitHead']==head and envelope['status']=='passed','affected native predecessor '+name)
        for row in envelope['sources']:source(row['path'],row['sha256'])
    for file in directory.rglob('*'):
        if file.is_file() and file.name!='receipt.json':record(file.relative_to(directory).as_posix())
    receipt=dict(schema='original-packed-float-image-receipt-v1',task=TASK,status='passed',gitHead=head,nativeRuns=54,nativeSchedules=3,scalarPatterns=11950,valueAudit=values,historicalEvidenceHead=BASE,carriedVerifiedEvidence=carried,carriedUnchangedBoundaries=boundaries,sources=sources,generated=generated,files=files,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False,authority='isolated-original-r11g11b10-storage')
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(CONFIRMATION,end='')
if __name__=='__main__':main(sys.argv[1])
