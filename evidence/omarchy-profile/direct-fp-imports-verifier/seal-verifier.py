#!/usr/bin/env python3
"""Seal this critic's completed read-only audits and promoted test, without git writes."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
WORKER = REPO / 'evidence/omarchy-profile/direct-fp-imports-r1'
sha = lambda b: hashlib.sha256(b).hexdigest()
read = lambda name: json.loads((OUT / name).read_text())
assert read('submission-inspection.json')['passed']
test_path = REPO / 'crates/wasm/tests/jit_fp_direct_imports_verifier.rs'
test_sha = sha(test_path.read_bytes())
assert test_sha == '0ac8b08bf56d981e6a0f80cccf54e2032abbfeacfaba1ddb4535f22564a0fa18'
assert sha((OUT / 'predictions.md').read_bytes()) == '904a3ecf19e907b3090fb92cb5d627113481f2507df90361787ca591cf8b21dd'
assert sha((OUT / 'benchmark-predictions.md').read_bytes()) == '4140a7aca9d80a52369757997206a929def94d01116dbef5d2e0f65339e373c6'
assert (OUT / 'final-verdict.md').read_text().startswith('VERDICT: verified\n')
worker_index = sha((WORKER / 'sha256.txt').read_bytes())
assert worker_index == 'e9160dbff703ac19aa5d4fb591fa1cc4651738916f04c0535905b189e53c2bbf'
for line in (WORKER / 'sha256.txt').read_text().splitlines():
    digest, name = line.split('  ', 1)
    assert sha((WORKER / name).read_bytes()) == digest, name
receipts = [p for p in sorted(OUT.glob('*.json')) if p.name != 'final-audit.json']
final = dict(
    sealedAt=datetime.now(timezone.utc).isoformat(), verdict='verified', task='E5.5-T03ao',
    workerSubmissionHead='7d648143e92b7fe861fa4ae7b1f34c0a84451f39',
    frozenRuntimeHarnessHead='8c302e1d6cd084ba1034cfd58c7efb9677dc3e46',
    artifactColdPhysicalHead='a3beb0e8dc5da21374a6d59e25658f5db5ce79da',
    baselineVerifiedHead='04ea9fe4', workerFilesSealed=89, workerIndexSha256=worker_index,
    wasmSha256='36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916',
    predictions={f'P{i}':'HELD' for i in range(1,10)},
    physicalPredictionMeaning='Negative outcome preserved, not desktop acceptance',
    promotedTest=dict(path=str(test_path.relative_to(REPO)),sha256=test_sha),
    rawPhysicalSha256=read('physical-inspection.json')['reportSha256'],
    rawProfileSha256=read('profile-inspection.json')['profileSha256'],
    benchmark=dict(frozenRatio=read('benchmark-frozen-inspection.json')['candidateRatio'],
                   coldRatio=read('benchmark-cold-inspection.json')['candidateRatio'],
                   claim='Same finite mixed-FP workload only'),
    numericalSuites=dict(frozenPassed=32,coldPassed=32,failed=0,ignored=0),
    sourceArtifactsMatched=58,nonCustomProfileSectionsMatched=11,
    publicFilesIndependentlyFetched=12,pristineClones=1,physicalTrials=1,
    broadCiPassed=False,desktopResponsive=False,qMustRemainGated=True,
    originalWrapperFailurePreserved=True,offlineGeometryCorrectionAccepted=True,
    independentBadGeometryControlsRejected=15,
    profileDiagnosticOnly=True,remainingScopedEvidenceGaps=[],
    receiptFiles=[dict(path=str(p.relative_to(REPO)),sha256=sha(p.read_bytes())) for p in receipts],
    limits=[
      'The physical nonce and personally inspected terminal criteria failed.',
      'Broad CI has five inherited failing categories; no green workspace claim.',
      'The critic audited recorded range recovery against the pinned local snapshot, without downloading 205 MB again.',
      'Root applies task status/queue and commits administratively; critic made no implementation or status edits.'
    ])
(OUT / 'final-audit.json').write_text(json.dumps(final,indent=2)+'\n')
paths=[p for p in sorted(OUT.rglob('*')) if p.is_file() and p.name != 'sha256.txt' and '__pycache__' not in p.parts]
paths.append(test_path)
paths.sort(key=lambda p:str(p.relative_to(REPO)))
entries=[(sha(p.read_bytes()),str(p.relative_to(REPO))) for p in paths]
assert len({name for _,name in entries}) == len(entries)
index=OUT/'sha256.txt'
index.write_text(''.join(digest+'  '+name+'\n' for digest,name in entries))
for digest,name in entries:
    assert sha((REPO/name).read_bytes()) == digest
print(json.dumps(dict(verdict='verified',task='E5.5-T03ao',files=len(entries),
    indexSha256=sha(index.read_bytes()),desktopResponsive=False,broadCiPassed=False),indent=2))
