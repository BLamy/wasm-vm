#!/usr/bin/env python3
"""Authenticate exact original integer native/word evidence and unchanged predecessor seals."""
import gzip,hashlib,json,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];BASE='131f7ec39a56b747e4107f9b2e5077e8215434f0';TASK='E6-T11d31'
CONFIRMATION='Frozen original integer words, native planes and retained ranges authenticated.\n'
sha=lambda b:hashlib.sha256(b).hexdigest();git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT,text=True).strip()
def need(value,message):
    if not value:raise ValueError(message)
def main(directory):
    directory=Path(directory).resolve();head=git('rev-parse','HEAD');files={};sources={};generated={}
    need(not git('diff','--name-only','HEAD'),'freeze tracked source before recording')
    def record(name,digest=None):
        raw=(directory/name).read_bytes();need(digest is None or sha(raw)==digest,'record drift '+name);files[name]=sha(raw);return raw
    def source(name,digest=None):
        raw=(ROOT/name).read_bytes();need(digest is None or sha(raw)==digest,'source drift '+name)
        if '/build/wasm/' in name:generated[name]=sha(raw)
        else:need(raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),'unfrozen source '+name);sources[name]=sha(raw)
    for _ in range(500):
        if b'\nINTEGER_IMAGE_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete recording log')
    wire=json.loads(record('wire/report.json'));need(wire['gitHead']==head and wire['task']==TASK and wire['status']=='passed' and all(p['held'] for p in wire['wire']['predictions']),'exact original wire predictions')
    need(sum(r['kind']=='old-owner' for r in wire['wire']['records'])==1296 and sum(r['kind']=='old-layout' for r in wire['wire']['records'])==1152,'every old integer inverse remains closed')
    names=['hardware-matrix']+['hardware-boundaries-'+seed for seed in ('0xa5471e03','0x13579bdf','0x9e3779b9')]+['fault-upload-lane','fault-copy-level']
    for name in names:
        fault=name.startswith('fault-');envelope=json.loads(record(name+'/report.json'));need(envelope['gitHead']==head and envelope['task']==TASK and envelope['status']==('failed' if fault else 'passed'),'native exact-head identity '+name);need(envelope['browserErrors']==dict(console=[],page=[],requests=[]),'native browser error arrays '+name);need(not envelope['browser']['headless'],'headed native GPU proof')
        need(not any(any(w in a.lower() for w in ('swiftshader','llvmpipe','softpipe','lavapipe')) or a.startswith('--disable-gpu') for a in envelope['browser']['commandLine']),'native GPU without software flags');report=envelope['partial'] if fault else envelope['browserResult']['result'];need('M4' in report['gpu'] and 'Metal' in report['gpu'],'actual Apple native Metal GPU');need(not report['guestExecution'] and not report['productionNegotiation'] and not report['productionDrawAuthority'],'isolated integer storage only')
        served={r['path']:r['sha256'] for r in envelope['servedFiles']}
        for row in envelope['sources']:
            source(row['path'],row['sha256'])
            if '/'+row['path'] in served:need(served['/'+row['path']]==row['sha256'],'actual immutable served source')
        for key in ('browserCoverage','screenshot'):record(name+'/'+envelope[key]['path'],envelope[key]['sha256'])
        coverage=json.loads(record(name+'/'+envelope['browserCoverage']['path']));need({'renderer/virgl-command/resources.mjs','renderer/virgl-command/integer-images.mjs'}<={r['source'] for r in coverage['scripts']},'complete native runtime V8 ranges')
        for row in coverage['scripts']:need(row['sha256']==served['/'+row['source']],'full nested V8 source identity')
        for row in report['blobs']:
            raw=gzip.decompress(record(name+'/'+row['path'],row['gzipSha256']));need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'whole native/public byte custody')
        for run in report['runs']:need(all(v==0 for v in run['final']['budgets'].values()) and all(r['deleted']==1 for r in run['nativeObjects']),'once-only native cleanup and terminal budgets')
        if fault:need(report['sabotage']['fenceCompleted'] and not report['sabotage']['held'] and any(r['faultEvents'] for r in report['runs']),'real wrong pixels fail after original physical completion')
        else:
            need(all(p['held'] for p in report['predictions']),'all original native predictions');need(len(report['runs'])==(288 if name=='hardware-matrix' else 19),'complete24-format/role/chain and ownership schedules')
            if name!='hardware-matrix':need(report['seed']==int(name.rsplit('-',1)[1],16),'varied original integer schedule')
    serving=json.loads(record('serving-audit.json'));need(serving['status']=='passed' and serving['gitHead']==head and serving['predecessor']==BASE and len(serving['records'])==27 and all(r['held'] for r in serving['records']),'only declared imported-source additions in historical pages')
    for row in serving['records']+serving['sources']:source(row['path'],row['sha256'])
    values=json.loads(record('independent-values.json'));need(values['status']=='passed' and values['runs']==347 and values['nativeComponents']>340000 and values['publicBytes']>520000 and values['untouchedPaddingBytes']>100000 and len(values['faults'])==2 and all(f['status']=='refuted' and f['fenceCompleted'] for f in values['faults']),'independent original integer inverse with physical sabotage')
    coverage=json.loads(record('coverage-audit.json'));need(coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['fullRegionsRemainAuthority'] and coverage['positive']>0,'full changed runtime coverage retained')
    changed=git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines();runtime=[n for n in changed if '/tests/' not in n and not n.endswith('.md')];need(set(runtime)=={'renderer/virgl-command/resources.mjs','renderer/virgl-command/integer-images.mjs'},'one original integer storage runtime boundary')
    need(not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest'),'production/compiler/guest surfaces remain unchanged')
    boundaries={}
    for name in ['renderer/virgl-command/'+n+'.mjs' for n in ('decoder','state','cache','constant-domain','color-images','float-images','packed-float-images','shared-exponent-images','shared-exponent-gpu')]:source(name);need((ROOT/name).read_bytes()==subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT),'unchanged predecessor boundary '+name);boundaries[name]=sources[name]
    carried={}
    for prefix in ('virgl-standard-float-consumer','virgl-standard-packed-float-images','virgl-standard-packed-float-consumer','virgl-standard-shared-exponent-images','virgl-standard-shared-exponent-consumer'):
        for role in ('worker','verifier'):
            folder='evidence/'+prefix+'/'+role+'/';manifest=json.loads((ROOT/(folder+'manifest.json')).read_text())
            for name in ('manifest.json','records.json','recording.tar.gz'):
                full=folder+name;source(full);need((ROOT/full).read_bytes()==subprocess.check_output(['git','show',BASE+':'+full],cwd=ROOT),'unchanged HELD predecessor seal '+full);carried[full]=sources[full]
            need(carried[folder+'records.json']==manifest['recordIndexSha256'] and carried[folder+'recording.tar.gz']==manifest['archiveSha256'],'ten complete HELD worker/critic seals')
    descriptor=json.loads((ROOT/'tools/virgl-command/standard-integer-image-formats.json').read_text())
    for row in descriptor['normativeSource']['records'].values():source(row['path'],row['sha256'])
    for name in git('ls-files','renderer/virgl-command','renderer/virgl-shader','tools/verify-virgl-standard-integer-images*','tools/virgl-command/standard-integer-image*','tools/virgl-command/integer-image-spec','Makefile','tasks/epic-6-transcendence/E6-T11d31-standard-integer-color-images.md').splitlines():source(name)
    for row in wire['sources']:source(row['path'],row['sha256'])
    for name in ('retained-shared-storage','retained-shared-consumer','retained-float-consumer','retained-packed-storage','retained-byte-storage','retained-color-formats','retained-async-jobs'):
        envelope=json.loads(record(name+'/report.json'));need(envelope['gitHead']==head and envelope['status']=='passed','affected predecessor native gate '+name)
        for row in envelope['sources']:source(row['path'],row['sha256'])
    need(generated.get('renderer/virgl-shader/build/wasm/virgl-shader.wasm')=='41d5c79624d7799cb9339b3fb754bfb4b744ee959b70d8cc2daedfb0a1fb4ac8' and generated.get('renderer/virgl-shader/build/wasm/virgl-shader.mjs')=='509aaeb879c95b90acd26de08a310b23991779cf3564f174bbc1702c9b68a021','unchanged actual C/Wasm compiler identities')
    for file in directory.rglob('*'):
        if file.is_file() and file.name!='receipt.json':record(file.relative_to(directory).as_posix())
    receipt=dict(schema='original-integer-image-receipt-v1',task=TASK,status='passed',gitHead=head,historicalEvidenceHead=BASE,carriedVerifiedEvidence=carried,carriedUnchangedBoundaries=boundaries,valueAudit=values,sources=sources,generated=generated,files=files,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False,authority='isolated-original-integer-storage')
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(CONFIRMATION,end='')
if __name__=='__main__':main(sys.argv[1])
