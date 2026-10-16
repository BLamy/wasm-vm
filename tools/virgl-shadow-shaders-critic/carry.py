#!/usr/bin/env python3
"""Carry completed critic gates only across a recorded checker-only repair."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT)
sha=lambda raw:hashlib.sha256(raw).hexdigest()


def main(previous,destination):
    previous,destination=Path(previous).resolve(),Path(destination).resolve()
    assert previous!=destination and not destination.is_relative_to(previous)
    report=json.loads((previous/'independent/hardware/report.json').read_bytes())
    old=report['gitHead'];head=git('rev-parse','HEAD').decode().strip()
    assert not git('diff','--name-only','HEAD').strip()
    changes=git('diff','--name-only',old,head).decode().splitlines()
    assert changes and all(p.startswith('tools/virgl-shadow-shaders-critic/') or p=='tools/verify-virgl-shadow-shaders-critic.sh' for p in changes),changes
    assert report['status']=='failed' and report['acceptance']['status']=='passed'
    assert report['failure']['message']=='Expected values to be strictly equal:\n\n0 !== 2\n'
    assert report['browserErrors']==dict(console=[],page=[],requests=[])
    assert report['acceptance']['unused']==[]
    assert [f['status'] for f in report['acceptance']['frames']]==['held','refuted']
    assert len(report['acceptance']['frames'][1]['misses'])==4
    audits=['authentication.json','original-response-audit.json','coverage-fine.json','worker-original-physical-audit.json','environment-stack-audit.json','independent/audit.json']
    for name in audits:assert json.loads((previous/name).read_bytes())['status']=='passed',name
    # Retain the actual prior source and failed outer-checker record as evidence.
    for name in git('ls-tree','-r','--name-only',old,'--','Makefile','tools/virgl-shadow-shaders-critic','tools/verify-virgl-shadow-shaders-critic.sh','evidence/virgl-shadow-shaders/verifier/predictions.json').decode().splitlines():
        path=destination/'carried-checker-source'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(git('show',old+':'+name))
    copied=[]
    for path in sorted(previous.rglob('*')):
        if not path.is_file():continue
        name=path.relative_to(previous)
        if path.is_relative_to(previous/'independent/hardware'):
            target=destination/'carried-checker-failure'/name
        elif name.as_posix()=='original-token-audit.json':target=destination/'carried-checker-exploration'/name
        elif name.as_posix()=='acceptance.log':target=destination/'carried-acceptance.log'
        else:target=destination/name
        target.parent.mkdir(parents=True,exist_ok=True)
        assert not target.exists(),target
        os.link(path,target)
        if not path.is_relative_to(previous/'unpacked'):copied.append(dict(path=target.relative_to(destination).as_posix(),bytes=path.stat().st_size,sha256=sha(path.read_bytes())))
    result=dict(status='passed',previousHead=old,sourceHead=head,changedPaths=changes,previousEvidence=str(previous),audits={n:sha((previous/n).read_bytes()) for n in audits},copied=copied,reason='Only critic unused-binding assertion and independent token/carry harness changed; compiled runtime, worker harness, native/sanitized/Wasm results, allocation probes, coverage, cold proof and original-body authentication are unchanged. Repeat only the affected physical/checker proof.')
    (destination/'carry.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Carried completed compiler/environment/original evidence; repeat checker physical proof.',flush=True)


if __name__=='__main__':main(*sys.argv[1:])
