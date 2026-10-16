#!/usr/bin/env python3
"""Authenticate the frozen affected gate and its full source/native body closure."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from predecessor import BASE, GENERATED, SELECTED

ROOT=Path(__file__).resolve().parents[2]
CONFIRMATION=b'Frozen original shadow sampler packets, native bindings and complete planes authenticated.\n'
MODES=dict(matrix=148,formats=384,bindings=1,typed=4,mips=9,**{'query-only':2,'same-image':1},refusals=8,reflection=10,inherited=6,historical=2)
SEEDS=['0x493a170d','0x8ed16c35','0xc92b704f']
sha=lambda raw:hashlib.sha256(raw).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()


def main(directory):
    directory=Path(directory).resolve()
    head=git('rev-parse','HEAD')
    assert not git('diff','--name-only','HEAD'),'freeze tracked source before recording'
    for _ in range(500):
        if b'\nSHADOW_SAMPLER_RECORDING_COMPLETE\n' in (directory/'acceptance.log').read_bytes():break
        time.sleep(.01)
    else:raise ValueError('incomplete final recording')
    load=lambda name:json.loads((directory/name).read_text())
    dependency=load('predecessor/authentication.json')
    assert dependency['status']=='passed' and dependency['predecessor']==BASE and dependency['reopenedMembers']==53210
    assert dependency['generated']==GENERATED and dependency['unchangedCompilerAndStorage']
    metadata=load('metadata/metadata.json');assert metadata['status']=='passed' and len(metadata['rows'])==252 and metadata['getters']==0
    historical=load('predecessor/historical-audit.json');assert historical['status']=='passed' and len(historical['rows'])==1194 and historical['predecessor']==BASE
    coverage=load('coverage-audit.json');assert coverage['gitHead']==head and coverage['predecessor']==BASE and coverage['positive'] and not coverage['zero']
    names=['hardware-'+m for m in MODES]+['hardware-boundaries-'+s for s in SEEDS]+['fault-'+f for f in ['compare','mask']]
    sources,generated,reports={},{},{}
    counts=dict(runs=0,frames=0,pixels=0,words=0,refusals=0,nativePasses=0,consumedSyncs=0,disposalOnlySyncs=0)
    for name in names:
        report=load(name+'/report.json');fault=name.startswith('fault-')
        assert report['task']=='E6-T11d49' and report['gitHead']==head and report['status']==('failed' if fault else 'passed')
        assert report['browserErrors']==dict(console=[],page=[],requests=[])
        browser=report['browser'];assert not browser['headless'] and sha(Path(browser['executable']).read_bytes())==browser['sha256']
        assert not any(any(v in arg.lower() for v in ['swiftshader','llvmpipe','softpipe','lavapipe']) or arg.startswith('--disable-gpu') for arg in browser['commandLine'])
        evidence=report.get('partial') or report['browserResult']['result'];assert 'Metal' in evidence['gpu'] and 'M4' in evidence['gpu']
        assert not evidence['guestExecution'] and not evidence['productionNegotiation']
        expected=1 if fault else MODES.get(name[len('hardware-'):],7)
        assert len(evidence['runs'])==expected,(name,expected,len(evidence['runs']))
        for ref in evidence['runs']:
            if 'path' in ref:
                raw=(directory/name/ref['path']).read_bytes();assert len(raw)==ref['bytes'] and sha(raw)==ref['sha256'];run=json.loads(raw)
            else:run=ref
            assert all(len(h['hex'])%8==0 for h in run['history'])
            if not fault:assert all(p['held'] for p in run.get('predictions',[]))
        for ref in evidence['blobs']:
            zipped=(directory/name/ref['path']).read_bytes();raw=gzip.decompress(zipped)
            assert sha(zipped)==ref['gzipSha256'] and len(raw)==ref['bytes'] and sha(raw)==ref['sha256']
        for source in report['sources']:
            raw=(ROOT/source['path']).read_bytes();assert len(raw)==source['bytes'] and sha(raw)==source['sha256']
            assert raw==(directory/name/'source'/source['path']).read_bytes()
            if '/build/wasm/' in source['path']:generated[source['path']]=source['sha256']
            else:
                assert raw==subprocess.check_output(['git','show',head+':'+source['path']],cwd=ROOT)
                sources[source['path']]=source['sha256']
        audit_name='control-audit.json' if fault else 'values-audit.json' if name=='hardware-historical' else 'pixels-audit.json'
        audit=load(name+'/'+audit_name)
        assert audit['status']==('refuted' if fault else 'passed') and audit['reportSha256']==sha((directory/name/'report.json').read_bytes())
        if fault:
            assert audit['differences'] and audit['counts']['frames']==2
            assert audit['frames'][0]['mismatches']==0 and audit['frames'][1]['mismatches']>0
            assert audit['frames'][0]['sync']!=audit['frames'][1]['sync']
        else:
            for key,value in audit['counts'].items():
                if key in counts:counts[key]+=value
            if name in ['hardware-historical','hardware-inherited']:
                physical=load(name+'/physical-audit.json');assert physical['status']=='passed' and physical['reportSha256']==audit['reportSha256'] and physical['allCompleteBodiesReopened']
        served={r['path']:r['sha256'] for r in report['servedFiles']}
        for script in load(name+'/browser-coverage.json')['scripts']:
            assert sha(script['sourceBody'].encode())==script['sha256']==served['/'+script['source']]
        for key in ['browserCoverage','screenshot']:assert sha((directory/name/report[key]['path']).read_bytes())==report[key]['sha256']
        reports[name]=dict(reportSha256=audit['reportSha256'],status=audit['status'],runs=expected,counts=audit['counts'])
    assert generated==GENERATED
    changed={name for name in git('diff','--name-only',BASE,head,'--','renderer/virgl-command').splitlines() if '/tests/' not in name and not name.endswith('.md')}
    assert changed==SELECTED
    assert not git('diff','--name-only',BASE,head,'--','renderer/virgl-shader','crates','web','tools/guest')
    roots=['renderer/virgl-command','renderer/virgl-shader','tools/virgl-shadow-samplers','tools/verify-virgl-shadow-samplers.mjs','tools/verify-virgl-shadow-samplers.sh','Makefile','AGENTS.md','tools/check_task_policy.py','web/package.json','web/package-lock.json','tasks/epic-6-transcendence/E6-T11d49-shadow-samplers.md']
    for name in git('ls-files',*roots).splitlines():
        raw=(ROOT/name).read_bytes();assert raw==subprocess.check_output(['git','show',head+':'+name],cwd=ROOT);sources[name]=sha(raw)
    for row in dependency['primary']['sources']:
        raw=(ROOT/row['path']).read_bytes();assert sha(raw)==row['sha256'];sources[row['path']]=sha(raw)
    files={p.relative_to(directory).as_posix():sha(p.read_bytes()) for p in sorted(directory.rglob('*')) if p.is_file() and p.name!='receipt.json'}
    result=dict(schema='original-shadow-sampler-receipt-v1',task='E6-T11d49',status='passed',gitHead=head,predecessor=BASE,sources=sources,generated=generated,files=files,carried=dependency,reports=reports,counts=counts,guestExecution=False,productionNegotiation=False,productionDrawAuthority=False)
    (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(CONFIRMATION.decode(),end='')


if __name__=='__main__':main(sys.argv[1])
