#!/usr/bin/env python3
"""Bind the final promoted GPU attacks to committed sources and actual bytes."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
FREEZE='f8770251a815c9c9d7dbca58e671a0ec61262c94'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
audit=json.loads((HERE/'fresh-audit.json').read_text())
assert audit['status']=='passed'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==FREEZE
pins=json.loads((ROOT/'evidence/virgl-standard-compact/verifier/manifest.json').read_text())['sources']
sources={}
commands=[]
for directory,log,fault in [
    ('final-gpu','/tmp/wasmvm-standard-scalar-critic-final.log',None),
    ('final-sabotage-native','/tmp/wasmvm-standard-scalar-critic-native-fault.log','native-signedness'),
    ('final-sabotage-constant','/tmp/wasmvm-standard-scalar-critic-constant-fault.log','constant-scaled')]:
    shutil.copyfile(log,HERE/directory/'runner.log')
    report=json.loads((HERE/directory/'report.json').read_text())
    assert report['gitHead']==FREEZE and report['status']==('failed' if fault else 'passed')
    assert report['fixedMemory']=={'bytes':16777216,'stageExport':'function','pairExport':'function'}
    assert report['browserErrors']=={'console':[],'page':[],'requests':[]}
    assert not report['browser']['headless'] and report['browser']['gpu']['featureStatus'].get('webgl2',report['browser']['gpu']['featureStatus'].get('webgl'))=='enabled'
    assert not any(any(s in arg.lower() for s in ['swiftshader','llvmpipe','softpipe','lavapipe']) or arg.startswith('--disable-gpu') for arg in report['browser']['commandLine'])
    result=report['partial'] if fault else report['browserResult']['result']
    assert 'Apple M4 Max' in result['gpu']['renderer'] and not result['guestExecution'] and not result['productionNegotiation']
    served={row['path']:row['sha256'] for row in report['servedFiles']}
    for row in report['sources']:
        name,digest=row['path'],row['sha256']
        raw=(ROOT/name).read_bytes()
        if '/build/' in name:assert sha(raw)==pins[name]
        else:assert raw==subprocess.check_output(['git','show',FREEZE+':'+name],cwd=ROOT)
        assert sha(raw)==digest
        assert name not in sources or sources[name]==digest
        sources[name]=digest
        if '/'+name in served:
            expected=report['mutation']['servedSha256'] if fault and name==report['mutation']['path'] else digest
            assert served['/'+name]==expected
    for key in ['browserCoverage','screenshot']:
        row=report[key];assert sha((HERE/directory/row['path']).read_bytes())==row['sha256']
    for script in json.loads((HERE/directory/report['browserCoverage']['path']).read_text())['scripts']:
        assert script['sha256']==served['/'+script['source']]
    if fault:
        m=report['mutation'];assert m['mode']==fault and m['path']=='renderer/virgl-command/state.mjs'
        raw=(ROOT/m['path']).read_bytes();needle=m['needle'].encode();replacement=m['replacement'].encode()
        assert raw.count(needle)==1 and sha(raw)==m['originalSha256']
        mutated=(HERE/directory/'mutation-source.mjs').read_bytes()
        assert mutated==raw.replace(needle,replacement) and sha(mutated)==m['servedSha256']
        assert report['browserResult']['error']['message'].startswith('critic-sabotage-'+fault+' critic original TGSI pixels')
    assert '--adversarial' in report['command']
    commands.append({'command':report['command'],'exitCode':1 if fault else 0,'report':directory+'/report.json','status':report['status']})
files={}
for directory in ['final-gpu','final-sabotage-native','final-sabotage-constant','node-scalar-wire','node-compact-wire','node-scalar-coverage','node-compact-coverage']:
    for p in sorted((HERE/directory).rglob('*')):
        if p.is_file():files[p.relative_to(HERE).as_posix()]=sha(p.read_bytes())
audit.update(sourceHead=FREEZE,sources=sources,files=files,commands=commands,workerRuntimeHead='1b8e94b79de6ee79f72116246ce4042aa7bda815',guestExecution=False,productionDrawAuthority=False)
(HERE/'fresh-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
print(json.dumps({'status':'passed','sources':len(sources),'files':len(files),'sourceHead':FREEZE,'commands':commands}))
