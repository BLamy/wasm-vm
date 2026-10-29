#!/usr/bin/env python3
"""Frozen-head bounded submission; every failure produces a failed receipt."""
import hashlib, json, os, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('E5_STREAM_OUT', ROOT/'target/evidence/software-snapshot-stream-final')).resolve()
OUT.mkdir(parents=True,exist_ok=False)
report={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'started':time.time(),'passed':False,'commands':[]}
commands=[
 ['python3','tools/check_task_policy.py'], ['git','diff','--check'], ['cargo','fmt','--all','--check'],
 ['cargo','clippy','-p','wasm-vm-wasm','--all-targets','--','-D','warnings'],
 ['cargo','clippy','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--features','virgl-renderer','--','-D','warnings'],
 ['cargo','test','-p','wasm-vm-wasm','--lib'],
 ['cargo','test','-p','wasm-vm-core','--test','snapshot_coherence','--test','cpu_resume','--test','desktop_machine_resume','--test','desktop_machine_resume_verifier'],
 ['cargo','build','-p','wasm-vm-wasm-web','--target','wasm32-unknown-unknown','--profile','wasm-release'],
 ['node','--test','web/tests/snapshot-stream.test.mjs'],
 ['node','tools/verify/software-snapshot-stream.mjs',str(OUT/'staging')],
 ['node','tools/verify/software-snapshot-warm-ui.mjs',str(OUT/'warm-ui')],
 ['node','tools/verify/e5-t18e-demo-smoke.mjs']]
try:
    resume=os.environ.get('E5_STREAM_RESUME')
    if resume:
        previous=Path(resume).resolve(); prior=json.loads((previous/'gate.json').read_text())
        assert prior['passed'] is False and len(prior['commands'])==12
        assert all(row['exitCode']==0 for row in prior['commands'][:11])
        assert prior['commands'][11]['exitCode']!=0
        changed=subprocess.check_output(['git','diff','--name-only',prior['head'],report['head']],cwd=ROOT,text=True).splitlines()
        assert set(changed)<= {'tools/verify/software-snapshot-gate.py','tools/verify/e5-t18e-demo-smoke.mjs'}, changed
        for row in prior['commands'][:11]:
            assert hashlib.sha256(Path(row['log']).read_bytes()).hexdigest()==row['sha256']
        report['carried']={'head':prior['head'],'originalOutcome':'failed','source':str(previous),
            'gateSha256':hashlib.sha256((previous/'gate.json').read_bytes()).hexdigest(),
            'unchangedPassedCommands':prior['commands'][:11],'fixtureOnlyChanges':changed,
            'evidence':{str(p.relative_to(previous)):hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(previous.rglob('*')) if p.is_file()}}
        commands=commands[-1:]
    for name in ['loader.js','snapshot-stream.js','artifacts-omarchy.json']:
        assert (ROOT/'web'/name).read_bytes()==(ROOT/'web/dist'/name).read_bytes(), 'stale dist: '+name
    for i,cmd in enumerate(commands):
        log=OUT/f'{i:02d}.log'; started=time.time()
        env=dict(os.environ,E5_DEMO_TASK='E5.5-T07',E5_DEMO_OUT=str(OUT/'demo'))
        with log.open('wb') as output:
            result=subprocess.run(cmd,cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=600)
        entry={'command':cmd,'exitCode':result.returncode,'elapsed':time.time()-started,'log':str(log),
            'sha256':hashlib.sha256(log.read_bytes()).hexdigest()}
        report['commands'].append(entry)
        print(json.dumps({'index':i,'exitCode':result.returncode,'elapsed':entry['elapsed'],'command':cmd}),flush=True)
        if result.returncode: raise RuntimeError('failed command: '+str(cmd))
    report['passed']=True
except BaseException as error:
    report['failure']=repr(error)
finally:
    report['finished']=time.time(); (OUT/'gate.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':report['passed'],'out':str(OUT),'failure':report.get('failure')}))
sys.exit(0 if report['passed'] else 1)
