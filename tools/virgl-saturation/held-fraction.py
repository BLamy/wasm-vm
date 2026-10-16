#!/usr/bin/env python3
"""Carry authenticated unchanged FRC GPU evidence through its promoted source oracle."""
import hashlib,json,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def sha(b):return hashlib.sha256(b).hexdigest()
def member(base,name):
 p=ROOT/base;m=json.loads((p/'manifest.json').read_bytes());index=(p/'records.json').read_bytes();a=p/m['archive']['path']
 assert sha(index)==m['recordIndex']['sha256'] and sha(a.read_bytes())==m['archive']['sha256']
 r=next(r for r in json.loads(index)['records'] if r['path']==name)
 with tarfile.open(a) as t:b=t.extractfile(name).read()
 assert len(b)==r['bytes'] and sha(b)==r['sha256']
 return b,dict(sealPath=base+'/manifest.json',indexPath=base+'/records.json',archive=str(a.relative_to(ROOT)),archiveSha256=m['archive']['sha256'],member=r)
p=Path(sys.argv[1]).resolve();p.mkdir(parents=True,exist_ok=True)
positive,binding=member('evidence/virgl-precise-fraction/verifier','gpu-610839776/report.json')
fault,fbinding=member('evidence/virgl-precise-fraction/worker','hot/fault-negative/report.json')
(p/'capture.json').write_bytes(positive);(p/'fault.json').write_bytes(fault)
command=['node','renderer/virgl-shader/tests/precise-fraction-capture-regressions.mjs','--report',str(p/'capture.json'),'--output',str(p/'guards.json')]
subprocess.run(command,cwd=ROOT,check=True)
r=subprocess.run(command[:-3]+[str(p/'fault.json'),'--output',str(p/'fault-guards.json')],cwd=ROOT,capture_output=True)
(p/'fault.log').write_bytes(r.stdout+r.stderr);assert r.returncode!=0
report=json.loads((p/'guards.json').read_bytes());broken=json.loads((p/'fault-guards.json').read_bytes())
assert report['status']=='passed' and report['physical']['words']==36096 and broken['status']=='failed'
# The numerical helper and unchanged source interpreter are the dependency
# boundary for the carried physical claim. Other current FRC paths execute in
# the 4,469-case native/Wasm promotion and whole predecessor response replay.
worker=json.loads((ROOT/'evidence/virgl-precise-fraction/worker/manifest.json').read_bytes())
source=subprocess.check_output(['git','show',worker['sourceHead']+':renderer/virgl-shader/raw_fraction.h'],cwd=ROOT)
assert source==(ROOT/'renderer/virgl-shader/raw_fraction.h').read_bytes()
summary=dict(schema='virgl-saturation-held-fraction-v1',status='passed',capture=binding,fault=fbinding,
 helperSha256=sha(source),guardSha256=sha((p/'guards.json').read_bytes()),faultGuardSha256=sha((p/'fault-guards.json').read_bytes()),
 physicalWords=36096,faultExit=r.returncode,command=command)
(p/'report.json').write_text(json.dumps(summary,indent=2)+'\n')
