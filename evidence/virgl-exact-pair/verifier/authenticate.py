#!/usr/bin/env python3
"""Independent archive, source, binary, and receipt authentication for E6-T12g6m3c."""
from pathlib import Path
from hashlib import sha256
import json, tarfile, subprocess

root=Path(__file__).resolve().parents[3]
seal=root/'evidence/virgl-exact-pair/worker'
out=root/'evidence/virgl-exact-pair/verifier'
head='1bbbe70a7bb4c9a9cdc0c3113cbb6b6a1deba733'
sha=lambda b:sha256(b).hexdigest()
manifest=json.loads((seal/'manifest.json').read_bytes())
index_raw=(seal/'records.json').read_bytes(); index=json.loads(index_raw)
archive=seal/'recording.tar.gz'
assert manifest['sourceHead']==index['sourceHead']==head
assert sha(index_raw)==manifest['recordIndex']['sha256'] and len(index_raw)==manifest['recordIndex']['bytes']
assert sha(archive.read_bytes())==manifest['archive']['sha256'] and archive.stat().st_size==manifest['archive']['bytes']
records={e['path']:e for e in index['records']}
assert len(records)==len(index['records'])==manifest['records']==136
unpack=out/'unpacked'; unpack.mkdir(exist_ok=True)
seen=set(); total=0
with tarfile.open(archive,'r:gz') as tf:
 for member in tf:
  assert member.isfile() and member.name in records and member.name not in seen
  p=Path(member.name)
  assert not p.is_absolute() and '..' not in p.parts
  data=tf.extractfile(member).read(); ref=records[member.name]
  assert len(data)==ref['bytes']==member.size and sha(data)==ref['sha256'],member.name
  dest=unpack/p; dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
  seen.add(member.name);total+=len(data)
assert seen==set(records)
for binary in ('generated/exact-pair-sanitize/exact-pair-test', 'cold-generated/exact-pair-sanitize/exact-pair-test'):
 (unpack/binary).chmod(0o755)
hot=json.loads((unpack/'hot/receipt.json').read_bytes())
cold=json.loads((unpack/'cold/report.json').read_bytes())
cold_receipt=json.loads((unpack/'cold/acceptance/receipt.json').read_bytes())
assert sha((unpack/'hot/receipt.json').read_bytes())==manifest['hotReceiptSha256']
assert sha((unpack/'cold/report.json').read_bytes())==manifest['coldReportSha256']
assert sha((unpack/'cold/acceptance/receipt.json').read_bytes())==manifest['coldReceiptSha256']
assert hot['gitHead']==cold['gitHead']==cold_receipt['gitHead']==head
assert cold['cloneHead']==head and cold['statusBefore']==cold['statusAfter']==''
assert cold['receiptSha256']==manifest['coldReceiptSha256']
assert sha((unpack/'cold/cold.log').read_bytes())==cold['logSha256']
for prefix,receipt in [('hot',hot),('cold/acceptance',cold_receipt)]:
 for entry in receipt['records']:
  p=unpack/prefix/entry['path']; raw=p.read_bytes()
  assert sha(raw)==entry['sha256'] and len(raw)==entry['bytes'],str(p)

def archive_source(entry,prefix):
 name=entry['path']
 if name.startswith('renderer/virgl-shader/build/'):
  return unpack/('generated' if prefix=='hot' else 'cold-generated')/name.removeprefix('renderer/virgl-shader/build/')
 if name.startswith('target/virgl-exact-pair-fault/'):
  return unpack/('fault-source' if prefix=='hot' else 'cold-fault-source')/name.removeprefix('target/virgl-exact-pair-fault/')
 return None

source_checks=generated_checks=0
for prefix,receipt in [('hot',hot),('cold',cold_receipt)]:
 for entry in receipt['sources']:
  name=entry['path']; p=archive_source(entry,prefix)
  if p is not None:
   raw=p.read_bytes(); generated_checks+=1
  else:
   raw=subprocess.check_output(['git','show',head+':'+name],cwd=root);source_checks+=1
  assert sha(raw)==entry['sha256'] and len(raw)==entry['bytes'],name
# Bind both original native test binaries and actual Wasm to their run records.
for prefix,receipt in [('hot',hot),('cold',cold_receipt)]:
 base=unpack/('hot' if prefix=='hot' else 'cold/acceptance')
 native=json.loads((base/'native/report.json').read_bytes())
 node=json.loads((base/'node.json').read_bytes())
 binary=archive_source(native['binary'],prefix)
 assert binary is not None and sha(binary.read_bytes())==native['binary']['sha256']
 assert len(binary.read_bytes())==native['binary']['bytes']
 assert node['nativeSha256']==sha((base/'native/report.json').read_bytes())
 assert len(native['cases'])==len(node['cases'])==118
 assert len(native['failures'])==1939 and len(native['rejections'])==17
 for seed in (1779033703,3144134277,1013904242):
  report=json.loads((base/f'gpu-{seed}/report.json').read_bytes())
  check=json.loads((base/f'capture-{seed}.json').read_bytes())
  assert report['status']==check['status']=='passed'
  assert check['reportSha256']==sha((base/f'gpu-{seed}/report.json').read_bytes())
  assert check['nodeReportSha256']==sha((base/'node.json').read_bytes())
  assert check['nativeReportSha256']==sha((base/'native/report.json').read_bytes())
  assert not report['trackedChanges'] and not any(report['browserErrors'].values())
  for entry in report['sources']+report['servedFiles']:
   p=archive_source(entry,prefix)
   raw=p.read_bytes() if p is not None else subprocess.check_output(['git','show',head+':'+entry['path']],cwd=root)
   assert sha(raw)==entry['sha256'],entry['path']
  shot=base/f'gpu-{seed}'/report['screenshot']['path']
  assert sha(shot.read_bytes())==report['screenshot']['sha256']
 for fault in ('interface','metadata'):
  report=json.loads((base/f'fault-{fault}/report.json').read_bytes())
  check=json.loads((base/f'capture-fault-{fault}.json').read_bytes())
  assert report['status']=='failed' and check['status']=='passed' and len(check['contradictions'])>=3
  assert check['reportSha256']==sha((base/f'fault-{fault}/report.json').read_bytes())
  fault_wasm=unpack/('fault-source' if prefix=='hot' else 'cold-fault-source')/fault/'virgl-shader.wasm'
  assert sha(fault_wasm.read_bytes())==report['acceptance']['faultWasm']['sha256']
  shot=base/f'fault-{fault}'/report['failureScreenshot']['path']
  assert sha(shot.read_bytes())==report['failureScreenshot']['sha256']

summary={'task':'E6-T12g6m3c','verdict':'authenticated','manifestSha256':sha((seal/'manifest.json').read_bytes()),'indexSha256':sha(index_raw),'archiveSha256':sha(archive.read_bytes()),'archiveMembers':len(seen),'archiveBytes':total,'frozenHead':head,'trackedSourceChecks':source_checks,'generatedSourceChecks':generated_checks,'hotNativeBinarySha256':sha((unpack/'generated/exact-pair-sanitize/exact-pair-test').read_bytes()),'coldNativeBinarySha256':sha((unpack/'cold-generated/exact-pair-sanitize/exact-pair-test').read_bytes()),'hotWasmSha256':sha((unpack/'generated/wasm/virgl-shader.wasm').read_bytes()),'coldWasmSha256':sha((unpack/'cold-generated/wasm/virgl-shader.wasm').read_bytes())}
(out/'authentication.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
