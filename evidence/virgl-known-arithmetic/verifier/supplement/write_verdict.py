#!/usr/bin/env python3
"""Record the incremental decision and carry every unchanged HELD result."""
from pathlib import Path
import hashlib, json

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def main():
    prior = json.loads((OUT.parent / 'verdict.json').read_bytes())
    authentication = json.loads((OUT / 'authentication.json').read_bytes())
    checks = json.loads((OUT / 'final-checks.json').read_bytes())
    results = [dict(p) for p in prior['predictionResults']]
    for p in results:
        if p['id'] == 'P12':
            p.update(status='HELD', resolvedBy=['C1', 'C2', 'J1'])
        else:
            p['carriedUnchanged'] = True
    findings = [
        dict(id='C1', status='HELD', prediction='Both original helper instances execute both zero+nonzero identity returns.',
             observed='Each original hot/cold raw profile re-merges byte-identically and re-exports with its own original executable. raw_bits known_add return-b/return-a counts8/4; standalone known_add counts4/4. Literal two WORD results are 0x3fc00000; exact case16 has complete native/Wasm singles/pairs and independent literal caches.',
             points=['renderer/virgl-shader/raw_known_arithmetic.h:34:13-34:21',
                     'renderer/virgl-shader/raw_known_arithmetic.h:35:13-35:21',
                     'recording-audit.json:variants[*].llvm[0..3]',
                     'original-supplement/hot/native.log:1', 'original-supplement/cold/native.log:1'],
             fixtureTextSha256='b0909ad597f132fa4662444c8172098183fb694c2859aff2d6a9047e7e5d4db3'),
        dict(id='C2', status='HELD', prediction='Original stage_result selects known arithmetic over inherited coordinate v38.',
             observed='Exact original region1710:115-142 has count4 in each corresponding original executable. Exact case54 produces v40/basev38, lower-left/half-integer inherited coordinate policy; complete single/pair parity and original-source parser approval hold.',
             points=['renderer/virgl-shader/bridge.c:1710:115-1710:142',
                     'recording-audit.json:variants[*].llvm[4]',
                     'original-supplement/hot/native.log:5', 'original-supplement/cold/native.log:5'],
             fixtureTextSha256='c4b060eb6d1914bfb388991e1e3a6895398c42b9e675c525c9e08f557ab5b312'),
        dict(id='J1', status='HELD', prediction='Original-source canonical second-operation and recursive rejection ranges execute.',
             observed='Both original Node profiles have exact nested V8 counts1/2 at11519-11565 and11978-11987. Both-operation [ADD,MUL] approves. Deleting only sineContract from otherwise-valid original ADD/SIN metadata rejects; three accessors reject with zero getter invocations.',
             points=['renderer/virgl-command/constant-domain.mjs:152',
                     'renderer/virgl-command/constant-domain.mjs:156',
                     'recording-audit.json:variants[*].v8',
                     'original-supplement/hot/consumer.json:results[2],attacks[0]',
                     'original-supplement/cold/consumer.json:results[2],attacks[0]'],
             sourceSha256='0be4e058dc23250a3116ac9360613a404739d807b858b926ee4d84205126b40b')]
    result = dict(schema='virgl-known-arithmetic-incremental-critic-verdict-v1', task='E6-T12g6m1',
                  verdict='verified', runtimeHead='cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee',
                  harnessHead='5353cf8591a94dbd962f92ee69b488ff18b8ebf0',
                  submissionHead='3b55b8b6685885024cafe6d384cd45405a08547e',
                  priorCriticCommit='a8dfaf5590bcbfeb14a90138ea08073e24c232f0',
                  predictionsSha256=sha((OUT / 'predictions.json').read_bytes()),
                  incrementalPredictionResults=[dict(id=i, status='HELD') for i in ['I0', 'C1', 'C2', 'J1', 'H1', 'H2']],
                  predictionResults=results, findings=findings, productContradictions=[],
                  coverageClosure=checks['coverageClosure'], preservedSeals=authentication['seals'],
                  unchangedBoundarySources=prior['unchangedBoundarySources'],
                  harnessAudit=dict(status='HELD', points=['guard-attacks.json', 'final-checks.json'],
                                    actualFaults='Corrupt original native output literals and reversed metadata are rejected. Positive original-binary replay passes;16 negative receipt variants reject.',
                                    criticCorrections='guard-attack-correction.json retains a source-line citation correction and an injection correction for duplicate shadow literals. Earlier failed injection attempts remain archived; no faulty report was accepted.',
                                    wiringWaiver=checks['harnessWiringWaiver']),
                  suite=checks['promotedSuite'], historicalUntracked=checks['historicalUntracked'],
                  proofs={p.name: sha(p.read_bytes()) for p in sorted(OUT.glob('*.json')) if p.name not in
                          ['manifest.json', 'records.json', 'verdict.json']},
                  remainingGate='Full c5806d5f and92cb866a originals, unproven dynamic uniform/geometry/indirect ranges, production negotiation/imports and performance remain gated. No new GPU, cold clone or unrelated gauntlet was required for unchanged runtime.',
                  productionNegotiation=False, guestExecution=False)
    assert all(p['status'] == 'HELD' for p in results)
    (OUT / 'verdict.json').write_text(json.dumps(result, indent=2) + '\n')
    print('VERDICT: verified; C1/C2/J1 close P12, all prior HELD results preserved.')

if __name__ == '__main__':
    main()
