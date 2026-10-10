#!/usr/bin/env python3
"""Authenticate the independent offset-repair verdict; optionally restore its scratch probes."""
from pathlib import Path,PurePosixPath
import argparse,hashlib,json,tarfile
BASE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--extract',action='store_true')
parser.add_argument('--output',type=Path,default=BASE.parents[2]/'target/evidence/virgl-standard-uniform-offset-critic')
args=parser.parse_args();sha=lambda raw:hashlib.sha256(raw).hexdigest()
manifest=json.loads((BASE/'manifest.json').read_bytes());indexraw=(BASE/'records.json').read_bytes();archive=(BASE/'recording.tar.gz').read_bytes()
for name,digest in manifest['sealSourceSha256'].items():assert sha((BASE/name).read_bytes())==digest
assert sha(archive)==manifest['archiveSha256']and len(archive)==manifest['archiveBytes'];assert sha(indexraw)==manifest['recordIndexSha256']
index=json.loads(indexraw);expected={record['path']:record for record in index['records']};assert len(expected)==len(index['records'])==manifest['records'];seen=set()
with tarfile.open(BASE/'recording.tar.gz','r:gz')as tar:
 for member in tar:
  name=PurePosixPath(member.name);assert member.isfile()and member.name in expected and member.name not in seen and not name.is_absolute()and '..'not in name.parts
  raw=tar.extractfile(member).read();record=expected[member.name];assert len(raw)==record['bytes']and sha(raw)==record['sha256'];seen.add(member.name)
  if args.extract:
   target=args.output/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw);target.chmod(member.mode)
assert seen==expected.keys()
for name,key in [('verdict.json','verdictSha256'),('predictions.json','predictionsSha256')]:assert sha((BASE/name).read_bytes())==manifest[key]
for name in ['verdict.json','verdict.md','predictions.json','authentication.json','carry-authentication.json','recording-audit.json','native-audit.jsonl','hardware-audit.jsonl','narrow-audit.jsonl','coverage-classification.json','coverage-regions.json','novel-hardware-audit.json','novel-hardware-audit.jsonl','promotion-audit.json','promotion-hardware-audit.json']:
 assert sha((BASE/name).read_bytes())==expected[name]['sha256']
assert manifest['verdict']=='verified'and not manifest['implementationEdited']and not manifest['productionAuthority']and not manifest['guestExecution']
print(f"Authenticated {len(seen)} independent critic records: VERDICT: {manifest['verdict']}")
