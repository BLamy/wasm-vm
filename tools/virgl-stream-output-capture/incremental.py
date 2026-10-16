"""Carry the unchanged frozen gates; final clone rebuilds and proves the touched harness."""
import hashlib,json,subprocess,shutil
from pathlib import Path

def authenticate(repo,output,cold,head):
    sha=lambda b:hashlib.sha256(b).hexdigest()
    report=json.loads((cold/'report.json').read_bytes());base=report['head'];assert base=='75c3a664a0df8f0fb3ce4ff1c248a4167411c09d'
    assert report['cleanBefore']==report['cleanAfter']=='' and report['sourceCheckout']['borrowedGeneratedArtifacts'] is False
    commands=json.loads((cold/'recording/commands.json').read_bytes());assert commands[-1]['name']=='default-demo' and commands[-1]['exitCode']==1
    for command in commands[:-1]:assert command['exitCode']==command['expected']
    assert commands[-1]['command'][-1]=='E6-T11d66' and 'AssertionError' in (cold/'recording/default-demo.stderr').read_text() and 'includes(task)' in (cold/'recording/default-demo.stderr').read_text()
    allowed={'tools/virgl-stream-output-capture/audit.py','tools/virgl-stream-output-capture/verify.py','tools/virgl-stream-output-capture/cold.py','tools/virgl-stream-output-capture/incremental.py','tools/virgl-stream-output-capture/retirement-browser.mjs','tools/virgl-stream-output-capture/seal.py','renderer/virgl-command/tests/native-stream-output-retirement.mjs','tools/verify-virgl-default-demo.mjs','tasks/epic-6-transcendence/E6-T11d66-stream-output-capture.md'}
    changed=subprocess.check_output(['git','diff','--name-only',base,head],cwd=repo,text=True).splitlines();assert set(changed)<=allowed,changed
    assert not subprocess.check_output(['git','diff',base,head,'--','crates','renderer/virgl-command/state.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/control-bridge.mjs','renderer/virgl-shader','web','Cargo.toml','Cargo.lock'],cwd=repo)
    browser=[]
    for mode in ['layouts','primitives','scatter-fault','selected-regression']:
        r=json.loads((cold/'recording'/mode/'report.json').read_bytes());assert r['head']==base and not r['trackedChanges'];assert r['status']==('failed' if mode=='scatter-fault' else 'passed');browser.append(dict(mode=mode,reportSha256=sha((cold/'recording'/mode/'report.json').read_bytes())))
    copied=output/'held-cold';shutil.copytree(cold,copied)
    pin=dict(schema='stream-output-capture-incremental-v1',runtimeHead=base,proofHead=head,heldColdReportSha256=sha((cold/'report.json').read_bytes()),commandsSha256=sha((cold/'recording/commands.json').read_bytes()),heldCommands=commands[:-1],earlierFailure=commands[-1],browser=browser,changedProofFiles=changed,unchangedRuntime=True)
    (output/'carry.json').write_text(json.dumps(pin,indent=2)+'\n');print('Authenticated unchanged runtime and held native/wasm/hardware gates; rebuilding final-clone proof artifacts.',flush=True);return pin
