#!/usr/bin/env python3
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent
old=json.loads((OUT/'coverage-audit.json').read_bytes());p=ROOT/'evidence/virgl-structured-conditionals/cold-clone/acceptance/native/coverage.json';cold=json.loads(p.read_bytes());rows=[]
for file in old['files']:
 entry=next(f for f in cold['data'][0]['files'] if f['filename'].endswith('/'+file['path']));added={x['line'] for x in file['addedLines']};branches=[b for b in entry['branches'] if b[0] in added]
 assert branches==file['changedBranchCounters'];assert hashlib.sha256((ROOT/file['path']).read_bytes()).hexdigest()==file['sha256']
 if file['path'].endswith('raw_bits.c'):
  for line in [201,202,203]:
   hits=[s[2] for s in entry['segments'] if s[0]==line and s[3] and s[4]];assert hits and all(x==0 for x in hits)
 rows.append({'path':file['path'],'branches':len(branches),'allRecordedCountsEqualWarm':True,'unreachableWaivers':file['waivers']})
result={'status':'passed','sourceHead':'e0bdfe31f959547a1794de5027187ef29abe3d42','coldCoverageSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'heldWarmCoverageSha256':old['coverageSha256'],'changedBranchCount':sum(x['branches'] for x in rows),'files':rows}
(OUT/'final-coverage-continuity.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
