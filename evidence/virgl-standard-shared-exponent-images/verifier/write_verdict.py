#!/usr/bin/env python3
"""Record outcomes separately from the immutable pre-observation predictions."""
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()

observed = {
    'P1': 'Reopened every one of 11096 worker members, both 587-source receipts, every recorded served/generated binding and all six D26/D27/D28 carried seals. The scrubbed exact7e88 cold clone remains pristine and its successful recording is unchanged. Final critic reports and their closures bind the frozen90dd harness.',
    'P2': '118528 scalar words and every complete recorded original/native plane agree with independent exact rational and integer binary32 arithmetic. Original zero, minimum2^-24, maximum65408, noncanonical zero, all32 exponents and all512 mantissas have the predicted unsigned RGB and implicit alpha1.',
    'P3': 'Authenticated RGB9_E5 storage, RGB/UNSIGNED_INT_5_9_9_9_REV original uploads, 322 worker plus66 fresh PBO uploads and complete private mip planes. Product copies do not download pixels; the fixed RGBA8/PBO path preserves exact original RGB, including noncanonical words.',
    'P4': '4386888 worker public bytes and1869352 padding bytes, plus2640 public and9978 padding bytes in fresh boundary schedules, match independent original-bit predictions. Full NPOT, nonzero box, tail mip, patched native-only and untouched backing observations agree.',
    'P5': '13x7 source452 plus private texture88 plus helper144 equals684 GPU bytes;683 refuses before allocation. Sync5x3 charges60 CPU plus60 conversion bytes; staged charges60 CPU plus120 GPU bytes. Fixed private helper storage is reused across refreshes without orphan bufferData, and retained charges last through physical completion/cleanup.',
    'P6': 'Reused public ID6 retains old generation3 while replacement generation4 is separate. Old6x3 local mips and captured source reads retain original values; old-generation charges remain through holds/fences. Foreign same-ID owners refuse. Cancellation consumes physical completion, disposal proves cleanup, and owned objects retire once with terminal budgets zero.',
    'P7': 'Strict own-data, getter/prototype/proxy/marker, role/range/layer/level and foreign-capability refusals hold without successful native allocation. The throwing proxy is visited once. Original125 accepts sampler bind8 only; historical packed decoder/store and command consumer admission remain closed.',
    'P8': 'All21 named failure boundaries hold in each worker schedule (126 hot/cold cases) and each independent seed (63 fresh cases). The new actual draw failure/retry and late post-helper native error restore full caller state, retire ownership once and preserve budgets; direct helper disposal/refusal and legacy native branches execute.',
    'P9': 'Three fresh schedules complete all scoped boundaries. Worker packing-field and wrong-level controls consume physical fences and fail the independent inverse. The critic B<-R shader control fails after actual sync19/turn6/result37146: component2 predicted0x3b400000, observed0x3a800000; unchanged input oracle detects it.',
    'P10': 'Full nested governing V8 intervals in62 authenticated script records cover498 partitions:493 execute and5 contain syntax/whitespace only. No behavioral region remains unexecuted. All27 static serving edits inverse exactly to predecessor. Six predecessor seals and the successful cold recording carry by unchanged source/dependency/evidence digest.',
    'P11': 'Before native observation, three independent LCG plans fixed23x9,19x3 and1x31 original words, nonzero range2..3 rational planes and GPU totals1184,344,324. Eleven frozen critic rows verify20 full native planes, foreign owners, nondefault program/PBO state, actual draw failure/retry, fixed-helper reuse, legacy paths and rollback.'
}
citations = {
    'P1': ['authentication.json', 'critic-freeze.json', 'fresh-audit.json'],
    'P2': ['plane-audit.json', 'plane-citations.jsonl:1191', 'source-boundary-audit.json'],
    'P3': ['plane-citations.jsonl:1193', 'plane-audit.json', 'fresh-audit.json', 'final/novel-audit.json'],
    'P4': ['plane-citations.jsonl:1195', 'plane-audit.json', 'fresh-audit.json'],
    'P5': ['plane-citations.jsonl:1135', 'plane-audit.json', 'fresh-audit.json', 'final/novel-audit.json'],
    'P6': ['plane-citations.jsonl:1091', 'plane-audit.json', 'fresh-audit.json'],
    'P7': ['plane-audit.json', 'fresh-audit.json', 'final/novel-audit.json'],
    'P8': ['plane-citations.jsonl:988', 'plane-audit.json', 'fresh-audit.json', 'final/novel-native/report.json#/browserResult/result/runs/0/states'],
    'P9': ['plane-citations.jsonl:1780', 'final/novel-audit.json#/actualBlueFieldControl', 'fresh-audit.json'],
    'P10': ['coverage-audit.json', 'source-boundary-audit.json', 'authentication.json', 'critic-freeze.json'],
    'P11': ['novel-plan.json', 'final/novel-plan-audit.json', 'final/novel-audit.json', 'final/novel-native/report.json']
}
audits = ['authentication.json', 'plane-audit.json', 'plane-citations.jsonl',
          'fresh-audit.json', 'fresh-plane-citations.jsonl', 'coverage-audit.json',
          'source-boundary-audit.json', 'critic-freeze.json',
          'final/novel-plan-audit.json', 'final/novel-audit.json']
original = (OUT/'predictions.json').read_bytes()
predictions = json.loads(original)
assert predictions['beforeEvidenceInspection']
assert sha(original) == 'f910a215766a0e3503cdae66dd0b7639d0dc0cf81ca083a66f21c77a8fb428bc'
for name in audits:
    if name.endswith('.json'):
        assert json.loads((OUT/name).read_bytes())['status'] == 'HELD', name
result = dict(schema='fresh-rgb9e5-adversarial-verdict-v1', verdict='verified',
              task='E6-T11d29', workerRuntimeHead=predictions['sourceHead'],
              workerSubmission=predictions['submission'],
              criticFreeze='90dd309b800762309df6fa2431ba25e76d44a3f5',
              predictionDigest=sha(original),
              predictions=[{**p, 'status': 'HELD', 'observed': observed[p['id']],
                            'citations': citations[p['id']]} for p in predictions['predictions']],
              findings=[], scope='isolated-original-format125-image-owner-and-transfers',
              guestExecution=False, productionNegotiation=False, productionDrawAuthority=False,
              suite=dict(target='make verify-E6-T11d29-adversarial',
                         promotedCommit='90dd309b800762309df6fa2431ba25e76d44a3f5',
                         actualPostFenceControlRequired=True),
              coldCarryReason=json.loads((OUT/'critic-freeze.json').read_bytes())['coldCarryReason'],
              audits={name: sha((OUT/name).read_bytes()) for name in audits})
(OUT/'verdict.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(dict(verdict=result['verdict'], predictions=len(result['predictions']),
                     sha256=sha((OUT/'verdict.json').read_bytes()), audits=result['audits'])))
