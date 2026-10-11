#!/usr/bin/env python3
"""Authenticate the frozen original packed-depth storage submission and custody."""
import gzip,hashlib,json,subprocess,sys,time
from pathlib import Path
from predecessor import BASE
ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
RUNTIME={'renderer/virgl-command/resources.mjs','renderer/virgl-command/unorm-depth-images.mjs','renderer/virgl-command/floating-depth-gpu.mjs'}
def need(value,message):
    if not value:raise ValueError(message)
def main(directory):
    directory=Path(directory).resolve();head=git('rev-parse','HEAD');need(not git('diff','--name-only','HEAD'),'freeze tracked source')
    for _ in range(500):
        if b'\nPACKED_DEPTH_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete frozen submission')
    load=lambda n:json.loads((directory/n).read_text());sources={};generated={}
    def source(name,digest=None):
        raw=(ROOT/name).read_bytes();actual=sha(raw);need(digest is None or actual==digest,'source digest '+name)
        if '/build/wasm/' in name:generated[name]=actual
        else:
            need(raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT),'unfrozen source '+name);sources[name]=actual
    dependency=load('predecessor-audit.json');need(dependency['status']=='passed' and dependency['predecessor']==BASE and dependency['reopenedMembers']==41650,'full held UN16 worker/critic seals')
    values=load('independent-values.json');need(values['status']=='passed' and values['scope']=='full-domain' and values['domainWordsPerFormat']=={'20':16777216,'21':16777216} and not values['oracleImportsProductCode'] and values['stencilValues']==256,'independent whole-domain field inverse')
    faults=['depth-precision','stencil-selection','completed-depth','completed-stencil'];need({r['name'] for r in values['faults']}=={'fault-'+f for f in faults} and all(r['status']=='refuted' for r in values['faults']),'all actual native controls independently refuted')
    names=['wire','hardware-matrix','hardware-domain']+['hardware-boundaries-'+s for s in ['0xa5471e03','0x13579bdf','0x9e3779b9']]+['fault-'+f for f in faults]
    legacy=['retained-un16-samples','retained-un16-surfaces','retained-un16-transfers','retained-floating-storage','retained-floating-samples','retained-floating-surfaces','retained-z16-consumer']
    for name in names+legacy:
        report=load(name+'/report.json');fault=name.startswith('fault-');need(report['gitHead']==head and report['status']==('failed' if fault else 'passed'),'exact-head recording '+name);need(report['browserErrors']==dict(console=[],page=[],requests=[]),'browser errors '+name)
        for row in report['sources']:
            source(row['path'],row['sha256'])
            recorded=directory/name/'source'/row['path']
            if name!='retained-z16-consumer':need(sha(recorded.read_bytes())==row['sha256'],'whole recorded source '+name+'/'+row['path'])
            # The held Z16 recorder pins source digests and served bodies; the
            # seal supplies each whole exact-head source from this same digest.
        if name=='wire':
            need(report['task']=='E6-T11d42' and all(p['held'] for p in report['wire']['predictions']),'all original wire predictions');rows=report['wire']['records'];need(sum(r['kind']=='old-owner' for r in rows)==168 and sum(r['kind']=='old-layout' for r in rows)==156 and sum(r['kind']=='old-consumer' and not r['result']['ok'] for r in rows)==6,'all fourteen old owners/thirteen layouts and original consumer refusals');continue
        need(not report['browser']['headless'] and not any(any(x in arg.lower() for x in ['swiftshader','llvmpipe','softpipe','lavapipe']) or arg.startswith('--disable-gpu') for arg in report['browser']['commandLine']),'headed real GPU '+name)
        evidence=report.get('partial') or report['browserResult']['result'];need('Metal' in str(evidence.get('gpu',evidence.get('renderer'))) and 'M4' in str(evidence.get('gpu',evidence.get('renderer'))),'actual Metal '+name)
        served={r['path']:r['sha256'] for r in report['servedFiles']}
        if name in names:
            need(not evidence['guestExecution'] and not evidence['productionNegotiation'] and not evidence['productionDrawAuthority'],'storage authority only')
            coverage=load(name+'/'+report['browserCoverage']['path']);need(RUNTIME<={r['source'] for r in coverage['scripts']},'all runtime V8 sources')
            for row in coverage['scripts']:need(sha(row['sourceBody'].encode())==row['sha256']==served['/'+row['source']],'full served V8 source body')
            if not fault:need(all(p['held'] for p in evidence['predictions']),'positive native predictions')
            for row in evidence['blobs']:
                z=(directory/name/row['path']).read_bytes();need(sha(z)==row['gzipSha256'],'compressed custody');raw=gzip.decompress(z);need(len(raw)==row['bytes'] and sha(raw)==row['sha256'],'full native/input/public custody')
            for run in evidence['runs']:
                need(all(v==0 for v in run['final']['budgets'].values()) and all(o['deleted']==1 for o in run['nativeObjects']),'once-only objects and terminal budgets')
            if name=='hardware-domain':need(len(evidence['runs'])==128,'all original domain chunks')
            if name=='hardware-matrix':need(len(evidence['runs'])==32,'all original role/mip/S8 cases')
        for key in ('screenshot','browserCoverage'):
            row=report[key];need(sha((directory/name/row['path']).read_bytes())==row['sha256'],'full browser capture '+name)
    need(generated==dependency['generated'],'unchanged actual generated compiler')
    coverage=load('coverage-audit.json');need(coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['positive'] and not coverage['zero'],'full changed governing V8 partitions')
    events=load('event-audit.json');need(events['status']=='passed','actual fence/collection ownership audit')
    changed={n for n in git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines() if '/tests/' not in n and not n.endswith('.md')};need(changed==RUNTIME,'one selected storage boundary');need(not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest'),'compiler and production unchanged')
    roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-command','tools/virgl-packed-depth','tools/virgl-unorm-depth','tools/virgl-floating-depth','tools/virgl-floating-depth-consumer','tools/verify-virgl-standard-packed-depth-images.mjs','tools/verify-virgl-standard-packed-depth-images.sh','tools/verify-virgl-standard-unorm-depth.mjs','tools/verify-virgl-standard-floating-depth-images.mjs','Makefile','tools/check_task_policy.py','AGENTS.md','web/package.json','web/package-lock.json','tasks/epic-6-transcendence/E6-T11d42-standard-packed-depth-images.md','evidence/virgl-production-readiness/standard-packed-depth-image-gap.mjs','evidence/virgl-production-readiness/standard-packed-depth-image-gap.json']
    for name in git('ls-files',*roots).splitlines():source(name)
    for row in dependency['records']:
        for name,digest in row['digests'].items():source(row['path']+'/'+name,digest)
    for name,digest in dependency['unchangedBoundaries'].items():source(name,digest)
    for row in dependency['primary']['sources']:source(row['path'],row['sha256'])
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    receipt=dict(schema='original-packed-depth-receipt-v1',task='E6-T11d42',status='passed',gitHead=head,predecessor=BASE,sources=sources,generated=generated,files=files,dependency=dependency,values=values,events=events,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print('Frozen original packed UN24 depth storage and native planes authenticated.')
if __name__=='__main__':main(sys.argv[1])
