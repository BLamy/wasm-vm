---
id: E6-T12g6m1
epic: 6
title: Materialize exact known ADD and MUL producer words for bounded consumers
priority: 525.027010585
status: implemented
depends_on: [E6-T12g6l]
estimate: S
risk: high
capstone: false
---

## Boundary

The unchanged larger compositor bodies still reject after opcode closure: full
92cb866a first fails at computed SIN (PC38), and c5806d5f at computed POW (PC31).
Neither a numeric origin nor a host floating calculation proves their source
encodings. One prerequisite is exact known ADD/MUL producer facts. On a final
whole-text retry only, fold fully known, already authorized normal-or-zero
post-modifier operands with integer binary32 round-to-nearest/ties-to-even.
Materialize the exact normal-or-zero result word and its matching numeric shadow
before granting that producer version a fact. Preserve masked/aliased reads,
joins, source versions, grammar and bounded IR storage. Dynamic operands,
exceptional results and unproven computed consumers retain existing rejection.

This does not admit the full originals or grant typed uniform/interpolated input
ranges. Full-source acceptance remains E6-T12g6m. Production negotiation and
public imports remain disabled; no FPS or MIPS claim follows.

## Deterministic acceptance

`make verify-E6-T12g6m1`: strict affected C/JS checks, ASan/UBSan recorded native
fixtures with original LLVM binary/profiles, exact native/Wasm single/pair
parity, independent integer binary32 predictions, actual physical hardware
carrier words and RGBA bytes over three seeds, consumer metadata/owned-bank
attacks and zero-error/disposal. Exercise ADD/MUL masks, swizzles, aliasing,
signed zeros, rounding ties, cancellation, overflow/subnormal nonfold cases,
known versus dynamic/overwritten/joined sources, and computed SIN/POW/F2I and
address consumers. Old admitted fixtures must remain byte-identical; explicitly
inventory formerly rejected known-producer extensions without changing old
evidence. Bind both larger full literal source hashes and their continued gate.

Record source-fault sensitivity, complete changed-runtime coverage and one
scrubbed pristine clone at the frozen source. Submit original binaries,
source/index digests and raw captures to a fresh adversarial critic.

## Adversarial verification

Predict rounding, post-modifier source version, masked writes and domain facts
before inspecting reports. Attack integer-manufactured unknown words, unsafe
results, missing source lanes, branch joins, indirect addresses, metadata
forgeries/accessors and source-size/depth/instruction bounds. The exact literal
emission must execute before a fact is used; a host-only result is insufficient.
Run all scoped acceptance angles, one bounded novel attack and sabotage the new
tests. Hold changed hunks against original native/V8 profiles; uncovered behavior
needs evidence or deletion. Preserve predecessor HELD evidence when unchanged.

## Verification log

### 2026-10-04 — worker — activation

Discard predecessor verified at bfd5c97f. Read-only full-body native prechecks
and diagnostic scratch compiler under /tmp locate PC38 SIN and PC31 POW as
the first final-retry failures. The bounded reproducer `ADD TEMP[0], IMM[0],
IMM[1]; SIN OUT[0], TEMP[0]` with normal known operands also rejects. This leaf
adds exact emitted known-producer authority; unknown uniform/geometry facts
remain separate prerequisites. Planning diagnostics are not acceptance evidence.

### 2026-10-04 — worker — exact-source submission

Frozen source: `cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee`, against verified
discard base `bfd5c97f7d71f510fccd2bd120f43b3d8b54159f`. Final commands:

```sh
VIRGL_KNOWN_ARITHMETIC_EVIDENCE_DIR=target/evidence/virgl-known-arithmetic-final make verify-E6-T12g6m1
python3 tools/virgl-known-arithmetic/cold.py --output target/evidence/virgl-known-arithmetic-cold
python3 tools/virgl-known-arithmetic/seal.py --hot target/evidence/virgl-known-arithmetic-final --cold target/evidence/virgl-known-arithmetic-cold --output evidence/virgl-known-arithmetic/worker
```

Both final commands passed at the frozen source; the detached scrubbed clone
was pristine before and after its acceptance. The seal preserves 100 original
members, including each actual sanitizer executable, raw/merged LLVM profiles,
source coverage, generated native/Wasm builds, full browser reports, V8 coverage
and screenshots. Evidence index: `evidence/virgl-known-arithmetic/worker/records.json`;
manifest: `evidence/virgl-known-arithmetic/worker/manifest.json`; recording:
`evidence/virgl-known-arithmetic/worker/recording.tar.gz`.

- Manifest SHA256: `e211633f326cd8e43e37a1585d9c892f84fa8d1eea5f13ac00bcf98d4104d15f`.
- Archive SHA256: `cde41a7216f85761baf09b9b8646777e8703f1f449b0af270b31daf87a3813aa`
  (9,910,405 bytes); index SHA256:
  `67a4726f63fe00ab9fd9f9c708c26ea89d47dff988aeb53fd6dd169d3fe017b0`.
- Hot receipt SHA256: `dab67a7162be905ae0a0ff19b8f155eeee7f517a9ed4f73724a137b32b709b4f`;
  cold report: `0270e3b238204a6889edb5c6bd8cffac86309a47d19a444a339b7f373eefbab2`;
  cold receipt: `18f778bee0326a068755886fb57fbf8c3fa86e002c69547aa8b049ae765c4a53`.
- Original hot executable SHA256:
  `28bbf65f360d93c674ec2b035d871136e958d42be6f00261820d5f922df606da`;
  original cold executable:
  `c4eeae93534814d9ccc1f2beded36781275946da8fb97dba0499a662150d74f2`.
  Both merged profiles: `abf869666cf3e495ad5e89059cf61f6e235df038d67ed592effdd5709f1cb863`.

The recording checks 11,608 independent rational ADD/MUL predictions in four
host rounding modes, 419 native/Wasm single/pair fixtures, 127 inert metadata
attacks and the inherited owned F2I bank guard. The 10,041 authenticated
predecessor cases retain 10,036 complete byte-identical results; the five
formerly rejected, fully known producer extensions are closed in
`tools/virgl-known-arithmetic/extensions.json`. Three physical Chrome/Metal
seeds each execute all 15 masks, both destination aliases, both operations,
an ADD-to-MUL chain, raw and converted byte outputs, dynamic numeric shadow
consumers and eight computed SIN/POW/EX2/LG2 equations: 7,512 carrier/math words
and 23,424 RGBA pixels per acceptance. Sync/async actual state consumers prove
owned bank replacement/restoration, withholding invalid finite bank uploads,
atomic nonfinite wire rejection and zero remaining objects/budgets. Actual
word and shadow shader-source corruptions each produce the expected independent
hardware contradiction while retaining zero GL/browser errors and disposal.
Numeric highp shadow zero sign is qualified; raw zero sign words remain exact.
IR/instruction storage remains 111,744/112 bytes. The complete original c5806d5f
and 92cb866a bodies still reject; dynamic uniform/geometry and indirect range
obligations, production integration and performance remain unproven. The claim
is submitted for a fresh critic's source, coverage and adversarial review.
