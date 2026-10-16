#!/usr/bin/env python3
"""Authenticate the fresh signed-offset critic recording; optionally restore scratch replay files."""
from pathlib import Path,PurePosixPath
import argparse,hashlib,json,tarfile
BASE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--extract',action='store_true');parser.add_argument('--output',type=Path,default=BASE.parents[2]/'target/evidence/virgl-standard-uniform-verifier-replay');args=parser.parse_args()
sha=lambda b:hashlib.sha256(b).hexdigest();manifest=json.loads((BASE/'manifest.json').read_bytes());indexraw=(BASE/'records.json').read_bytes();archive=(BASE/'recording.tar.gz').read_bytes();assert sha(archive)==manifest['archiveSha256'] and len(archive)==manifest['archiveBytes'];assert sha(indexraw)==manifest['recordIndexSha256']
index=json.loads(indexraw);expected={r['path']:r for r in index['records']};assert len(expected)==len(index['records'])==manifest['records'];seen=set()
with tarfile.open(BASE/'recording.tar.gz','r:gz') as tar:
 for m in tar:
  assert m.isfile() and m.name in expected and m.name not in seen;name=PurePosixPath(m.name);assert not name.is_absolute() and '..' not in name.parts;raw=tar.extractfile(m).read();record=expected[m.name];assert len(raw)==record['bytes'] and sha(raw)==record['sha256'];seen.add(m.name)
  if args.extract:
   target=args.output/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
   if m.name=='original-offsets':target.chmod(0o755)
assert seen==expected.keys();assert sha((BASE/'verdict.json').read_bytes())==manifest['verdictSha256'];print(f"Authenticated {len(seen)} critic records: {manifest['verdict']}")
