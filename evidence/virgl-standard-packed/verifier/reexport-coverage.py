#!/usr/bin/env python3
"""Re-export sealed counters against sealed actual instrumented Mach-O files."""
from pathlib import Path
import hashlib,json,subprocess
HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
rows=[]
for family in ['hot','cold']:
 base=HERE/'unpacked'/family
 for name,binary in [('coverage/matrix','standard-packed-sanitize/standard-packed-test'),
                     ('coverage/allocations','standard-packed-allocation-sanitize/standard-packed-allocation-test'),
                     ('compiler-retained/coverage/matrix','standard-sanitize/standard-test'),
                     ('compiler-retained/coverage/allocations','standard-allocation-sanitize/standard-allocation-test')]:
  image=HERE/'unpacked'/(family+'-generated')/'renderer/virgl-shader/build'/binary
  raw=base/(name+'.profraw')
  profile=HERE/(family+'-'+name.replace('/','-')+'.profdata')
  subprocess.run(['xcrun','llvm-profdata','merge','-sparse',str(raw),'-o',str(profile)],check=True)
  exported=subprocess.check_output(['xcrun','llvm-cov','export',str(image),'-instr-profile='+str(profile)])
  expected=(base/(name+'.json')).read_bytes()
  assert json.loads(exported)==json.loads(expected),(family,name)
  rows.append(dict(family=family,record=name,binarySha256=sha(image.read_bytes()),rawSha256=sha(raw.read_bytes()),
                   mergedSha256=sha(profile.read_bytes()),exportedSha256=sha(exported),sealedExportSha256=sha(expected),exactJsonEquality=True))
(HERE/'reexport-coverage.json').write_text(json.dumps(dict(status='passed',records=rows),indent=2)+'\n')
print(json.dumps(dict(status='passed',sealedRawCounterExports=len(rows))))
