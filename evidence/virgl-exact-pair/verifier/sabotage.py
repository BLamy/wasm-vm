#!/usr/bin/env python3
"""Flip one physical frame byte in an evidence-only copy and demand checker failure."""
from pathlib import Path
from hashlib import sha256
import json,subprocess
root=Path(__file__).resolve().parents[3]
out=root/'evidence/virgl-exact-pair/verifier'
source=out/'unpacked/hot/gpu-1779033703/report.json'
report=json.loads(source.read_bytes())
frame=report['acceptance']['rigs'][0]['draws'][0]
original=frame['rgbaBytes'][0]
frame['rgbaBytes'][0]=original^1
sabotaged=out/'sabotage-report.json'
sabotaged.write_text(json.dumps(report,separators=(',',':'))+'\n')
command=['python3','tools/virgl-exact-pair/capture-check.py',str(sabotaged.relative_to(root)),str((out/'unpacked/hot/node.json').relative_to(root)),str((out/'sabotage-output.json').relative_to(root))]
result=subprocess.run(command,cwd=root,capture_output=True,text=True)
assert result.returncode!=0 and 'independent whole-frame equations' in result.stderr
facts={'task':'E6-T12g6m3c','status':'caught','change':'one byte of first complete physical frame flipped in verifier-only copy','point':'gpu-1779033703/report.json acceptance.rigs[0].draws[0].rgbaBytes[0]','original':original,'sabotaged':original^1,'sourceSha256':sha256(source.read_bytes()).hexdigest(),'sabotagedSha256':sha256(sabotaged.read_bytes()).hexdigest(),'exitCode':result.returncode,'stderrTail':result.stderr.splitlines()[-1],'command':command}
(out/'sabotage.json').write_text(json.dumps(facts,indent=2)+'\n')
print(json.dumps(facts,indent=2))
