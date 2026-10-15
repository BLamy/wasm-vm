---
id: E6-T11d74d1
epic: 6
title: Preserve the displayed GPU front buffer until the next valid frame
priority: 525.02703831
status: verified
depends_on: [E6-T11d74c]
estimate: S
risk: high
capstone: false
---

## Boundary

Separate cancellation of obsolete scanout ownership/recovery state from erasing
the visible front buffer. Valid renderer/2D page flips retain the displayed pixels
until a fresh binding frame is drawn; explicit display disable/reset/teardown
still clears them. Old queued frames cannot draw or satisfy new receipts.

## Deterministic acceptance

`make verify-E6-T11d74d1` records original worker/native-MMIO GPU buffer switches,
physical browser pixels across the between-bind-and-present interval, exact old
receipt cancellation and fresh receipt acceptance. Cover explicit disable/reset,
context loss before replacement, rapid rebind, partial next frame and both
ordinary scheduled and retained production presentation. Build the ordinary
Wasm/dist, run relevant native/protocol/physical regressions and default127/0,
then one final complete pristine clone without alternates. Actual Omarchy final
factory/input/publication remains74d after74d2; no old factory is relabelled
compatible with new runtime bytes.

## Adversarial verification

Fresh verifier predicts actual canvas bytes before each transition, then attacks
queued old receipt delivery, disable, reset and recovery replay. A screenshot
after the replacement frame does not prove continuity between frames. Sabotage
the new no-blank assertion with the original unconditional clear once. Carry
unchanged native/DMA/security proofs by their recorded dependency identities.

## Verification log

### 2026-10-15 — worker — reproduce before changing runtime

Original worker build5dd286c9 / ordinary Wasm9b7fd924 reproduces40 completely
transparent samples out of379 during six trusted pointer moves and a bar click;
`target/evidence/production-gpu-ready-warm-self04/pointer-flicker.json` retains
the executed read-only sampler, original wire messages, GPU counters, pointer
frames and raw transparent PNGs. Separate allocation refusals remain74d2.

### 2026-10-15 — worker — recorded submission

Runtime and final harness head `afd26047a3751a55d4bee376ecf668769d06bca5`;
ordinary worker identity `f76a37284d175ecba88ade0de496d3f232fd7dbeefef166a79c537e6ffc7f6bc`.
Claim: valid production renderer/2D buffer switches preserve the displayed front
while revoking queued/recovery ownership. Actual original-MMIO worker frames
retain4096 literal green pixels before replacement, reject a cancelled old
callback after a new frame queues, draw fresh blue, explicitly disable/re-enable,
and clear without replay after actual worker WebGL context loss. The original
unconditional-clear single-hunk negative fails at the no-blank assertion.
Independent promoted drivers additionally cover partial full-backing repaint,
nonfixed/scheduled presenters, invalid flags, stale receipts, reset/teardown,
wirev1 rejection and staged checkpoint presentation suppression.

Final authoritative command is recorded by
`target/evidence/production-gpu-warm-restore-plan01/continue-scanout-cold.py`:
advance the complete `git clone --no-local` pristine02 clone to the exact head,
assert no alternates/shallow state or copied release/build cache, run clean
`make web-dist`, then
`python3 tools/virgl-production/verify-scanout-continuity.py --output .../scanout-continuity-repaired01`.
All15 acceptance commands and the preceding clean build pass, with the intentional negative exit1. This includes
fmt, native/wasm clippy and GPU original-wire/checkpoint tests, no-std wasm,
presentation/protocol/clock tests, reproducible original-MMIO guest, ordinary
Wasm/dist equality, actual Metal worker and independent state/pixel attacks,
all4software images/10boot-persistence phases and default127passed/0failed.
All recorded browser paths have zero unexpected errors. No Linux/Mesa publication
claim is made by the supervisor fixture.

Evidence: `evidence/virgl-production-scanout-continuity/worker/submission.tar.gz`,
4269219bytes, SHA256
`07c10a5a5ea3c4edeb56ffcac862c1199460e34a81e5699cc1de525131f3b3bd`;
418members, every identity reopened and rehashed. It includes final pristine
receipts, original native GPU events/digest, phase pixels, exact executed source
and driver, tests/stdout/stderr, screenshots and the recorded continuation.
Unchanged native/DMA/profile security holds carry from independently verified74c
at `baf3d1035eec4e184eb2704bc52c2ce17066b1ed` by unchanged dependency bytes.

Preserved failures: pristine01/02 initially stopped before runtime acceptance
because generated roadmap activity depended on unrelated local refs. The
canonical HEAD-only generator repair makes the clean build identical; the
independent verifier's extra-ref/legacy-negative challenge exercises this fix.
The exploratory hot run at38d51d39 is not final exact-head evidence. Its Node
command timeout preserved60 successful original1MiB disk fetches over145s;
the harness now records chunk latency and retains the same original result
predicate with a finite300s command budget. Actual snapshot restore timing is
separate (Node2053ms; Omarchy139398msnetwork and6031msrepeat in the pristine run).
No acceptance output is fabricated, no old factory is relabelled and no artifact
has yet been published. Independent verifier verdict is still required.

### 2026-10-15 — verifier — VERDICT: verified

Fresh independent review did not implement GPU/runtime code. Worker commit
`4784111bb4e12c8e948ff6254dd91edbcd34311e` submits exact runtime/harness
`afd26047a3751a55d4bee376ecf668769d06bca5`. Full verdict and point citations:
`evidence/virgl-production-scanout-continuity/verifier/VERDICT.md`.

- P1/P2/P6 — HELD. Original native/MMIO rebind retains all 4,096 green pixels;
  old sequence 6 / binding 1 retires once as cancelled, fresh sequence 8 /
  binding 3 draws blue. A revoked callback after blue queues leaves it pending.
  Literal phase pixels, exact retirement keys and source identities were checked.
- P3/P4/P5/P7/P8/P9 — HELD. Independent recorded real Canvas2D checks cover
  fixed/nonfixed first-partial repaint, ordinary scheduling, stale receipt and
  protocol-1 rejection, invalid preservation flags, explicit disable/reset/
  teardown, staged checkpoint suppression and activation clear. Actual Metal
  worker context loss clears without recovery replay. The initial nonfixed
  partial-frame refutation and checkpoint-wrapper omission remain preserved.
- P10 — HELD. Independently reopened/rehashed the 4,269,219-byte worker capsule:
  all 418 members / 417 manifest identities match. All 132 frozen worker sources
  match candidate blobs; the clean complete clone is exact, nonshallow, without
  alternates/promisor packs and passes independent object-connectivity checks.
  All 15 expected command exits hold: 26 native GPU/checkpoint tests, 66 protocol/
  presentation/clock tests, 8 independent state groups, 47 physical pixel
  assertions, all four software guests / 10 original boot-persistence phases,
  and ordinary 127 passed / 0 failed, no proof exports or unexpected browser errors.
- NEGATIVE — HELD. Healthy/negative frozen inputs differ only in the production
  presenter's original unconditional-clear hunk. The exact between-bind
  no-blank assertion fails. Generator extra-ref invariance holds; a scratch
  legacy `--all` negative fails at its intended assertion. Earlier missing-ref
  clone failures and external Node chunk timeout remain preserved.
- COVERAGE/SUITE — Runtime hunks are executed by the recorded native worker and
  independent state/pixel checks; comments, generated mirror copies and the
  direct Make alias are waived with reasons in the full verdict. Unchanged
  native/DMA/security proofs carry from the recorded 74c dependency. Promoted
  `tools/test_gen_tasks_json_head.py` passes and guards published activity against
  unrelated branch/remote/stash refs while retaining real HEAD changes.

Independent review capsule:
`evidence/virgl-production-scanout-continuity/verifier/review.tar.gz`,
538,549 bytes, 80 members, SHA256
`b0df7f502f64c4999bc27443272c3776ac8618c755fe274617e498a74917b013`.
Every member was reopened and rehashed. It preserves pre-outcome predictions,
original refutations, executed drivers, CDP coverage, generator positive/negative,
portability/network failure provenance and the sealed-submission audit.

Verifier commands: `python3 tools/test_gen_tasks_json_head.py`;
`python3 target/evidence/critic-production-scanout-continuity74d1/audit-sealed-submission.py`;
recorded bounded independent headless Chrome drivers and scratch-ref challenge.
No runtime edits, protected-guest interaction, factory relabelling or publication
occurred in this review. This supervisor boundary verdict does not verify final
Omarchy warm publication (74d) or allocation diagnostics (74d2).
