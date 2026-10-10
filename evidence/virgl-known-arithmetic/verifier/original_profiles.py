#!/usr/bin/env python3
"""Re-export original LLVM profiles only from their own recorded executables."""
from pathlib import Path
import json,hashlib,subprocess
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'target/evidence/virgl-known-arithmetic-critic';E=Path(__file__).parent
U=OUT/'unpacked'
def sha(b):return hashlib.sha256(b).hexdigest()
reports=[]
for kind,prefix,generated in [('hot','hot','generated'),('cold','cold/acceptance','cold-generated')]:
 binary=U/generated/'known-arithmetic-sanitize/known-test';profile=U/prefix/'native/native.profdata'
 merged=OUT/(kind+'-original-merged.profdata')
 subprocess.run(['xcrun','llvm-profdata','merge','-sparse',str(U/prefix/'native/native.profraw'),'-o',str(merged)],check=True)
 assert merged.read_bytes()==profile.read_bytes(),'original profile merge bytes'
 raw=subprocess.check_output(['xcrun','llvm-cov','export',str(binary),'-instr-profile='+str(profile)],stderr=subprocess.STDOUT)
 export=json.loads(raw);(OUT/(kind+'-original-coverage.json')).write_bytes(raw)
 filtered=json.loads(raw)
 suffixes=['bridge.c','raw_bits.c','raw_known_arithmetic.h','native_tests/known_arithmetic.c']
 for d in filtered['data']:
  d['files']=[f for f in d['files'] if any(f['filename'].endswith('/'+n) for n in suffixes)]
  d['functions']=[f for f in d['functions'] if any(any(n.endswith('/'+s) for s in suffixes)for n in f['filenames'])]
 recorded=json.loads((U/prefix/'native/coverage.json').read_bytes())
 assert filtered==recorded,'original export equals actual recorded coverage'
 reports.append({'kind':kind,'binary':{'path':str(binary.relative_to(ROOT)),'sha256':sha(binary.read_bytes())},'rawProfileSha256':sha((U/prefix/'native/native.profraw').read_bytes()),'mergedProfileSha256':sha(profile.read_bytes()),'fullExport':{'path':str((OUT/(kind+'-original-coverage.json')).relative_to(ROOT)),'sha256':sha(raw)},'recordedFilteredCoverageSha256':sha((U/prefix/'native/coverage.json').read_bytes()),'filteredExportEqualsOriginalRecording':True,'functions':[{'name':f['name'],'count':f['count'],'files':f['filenames']} for d in filtered['data'] for f in d['functions'] if 'known_' in f['name']]})
(E/'original-profile-audit.json').write_text(json.dumps({'schema':'virgl-known-arithmetic-critic-original-profile-v1','status':'passed','recordings':reports},indent=2)+'\n')
print(json.dumps({'status':'passed','reports':[{k:r[k] for k in ['kind','mergedProfileSha256','filteredExportEqualsOriginalRecording']}for r in reports]}))
