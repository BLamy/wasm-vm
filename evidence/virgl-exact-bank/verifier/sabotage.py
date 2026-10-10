#!/usr/bin/env python3
"""Attack the implementation in a scratch copy and falsify the capture oracle once."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
directory=OUT/'sabotage'
directory.mkdir(parents=True,exist_ok=True)
original=(ROOT/'renderer/virgl-command/constant-domain.mjs').read_text()
needle='checked.words[entry.register * 4 + entry.component] !== entry.word'
assert original.count(needle)==1
altered=original.replace(needle,needle+' && false')
(directory/'constant-domain.mjs').write_text(altered)
prediction={'task':'E6-T12g6m3a','predictedBeforeExecution':True,
            'guard':'the promoted adjacent-word assertion fails if only exact equality is disabled',
            'oracle':'changing one observed physical pixel while retaining the claimed pass is rejected',
            'originalSha256':hashlib.sha256(original.encode()).hexdigest(),
            'alteredSha256':hashlib.sha256(altered.encode()).hexdigest()}
(directory/'predictions.json').write_text(json.dumps(prediction,indent=2)+'\n')
run=subprocess.run(['node','tools/virgl-exact-bank/critic.mjs',str(directory/'guard'),str(directory/'constant-domain.mjs')],cwd=ROOT,capture_output=True)
(directory/'guard.stdout').write_bytes(run.stdout)
(directory/'guard.stderr').write_bytes(run.stderr)
assert run.returncode==1
failure=json.loads((directory/'guard/report.json').read_bytes())
assert failure['status']=='failed' and 'adjacent exact word must reject' in failure['failure']['message']
path=OUT/'gpu-3512640993/report.json'
value=json.loads(path.read_bytes())
value['acceptance']['rigs'][0]['draws'][0]['rgbaBytes'][0]^=1
forged=directory/'forged-capture.json'
forged.write_text(json.dumps(value,indent=2)+'\n')
probe=subprocess.run([sys.executable,str(OUT/'capture_audit.py'),'--browser',str(forged),'--output',str(directory/'forged-capture-audit.json')],cwd=ROOT,capture_output=True)
(directory/'capture.stdout').write_bytes(probe.stdout)
(directory/'capture.stderr').write_bytes(probe.stderr)
assert probe.returncode!=0 and 'AssertionError' in probe.stderr.decode()
report={'task':'E6-T12g6m3a','prediction':'P9','status':'HELD','guardExitCode':run.returncode,
        'guardFailure':failure['failure']['message'],'guardOriginalSha256':prediction['originalSha256'],
        'guardFaultSha256':prediction['alteredSha256'],'forgedCaptureExitCode':probe.returncode,
        'forgedCapturePoint':'acceptance.rigs[0].draws[0].rgbaBytes[0]',
        'forgedCaptureSha256':hashlib.sha256(forged.read_bytes()).hexdigest(),
        'productionSourcesEdited':False}
(OUT/'sabotage.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
