---
id: E6-T11d74a
epic: 6
title: Capture and restore quiescent production GPU device state
priority: 525.0270381
status: verified
depends_on: [E5-T26h, E6-T11d71, E6-T11d72, E6-T11d73]
estimate: S
risk: high
capstone: false
---

## Boundary

Add an explicit bounded, versioned native production GPU checkpoint path. Preserve
qualified device/capset identity, original transport/ring positions, control
contexts/resources/backing identities, counters and retained scanout/cursor
metadata. A pending GPU job, mailbox result, lost/poisoned host or invalid profile
must refuse before mutation. Ordinary unsupported 3D snapshot APIs retain their
explicit rejection until the paired host path is ready. No WebGL handle is data.

## Deterministic acceptance

`make verify-E6-T11d74a` records original MMIO/DMA create/attach/submit/scanout
round-trips through native whole-machine save/restore with a quiescent qualified
GPU. Compare exact guest traces/digests, every logical device/ring field and
subsequent original requests in cached/uncached modes. Reject truncation,
corruption, stale keys, foreign profiles and in-flight work failure-atomically.
Run affected fmt/clippy/native/Wasm/no-std and one final pristine clone.

## Adversarial verification

Independently vary resource/backing IDs, epochs, two queues and deadlines. Attack
old completion keys before/after restoration and a result not yet consumed by
Machine.run. Remove one generation/digest/quiescence guard in an isolated copy;
the deterministic original-wire test must fail. Carry unchanged render proofs;
this native boundary does not claim a complete GPU warm boot.

## Verification log

### 2026-10-15 — worker — explicit accelerated warm-boot scope

The user's clarified goal is warm boot with GPU rendering. This is an ordered
implementation boundary of that request, not the cancelled software-default
workaround. Existing independent rendering/timekeeping proofs carry only across
unchanged code and dependency identities; new checkpoint behavior needs its own
recorded acceptance and fresh verifier.

### 2026-10-15 — worker — native checkpoint submission

Runtime frozen at `3505a7c480ec855bd1d64d7c0188dea8fc3ab4e8`; final exact
acceptance head `268019aed7c5f61b0bcab660c6f82b32da828e59` adds only the
new task's current roadmap-copy oracle to the browser recorder. The new explicit
native APIs authenticate the complete CPU/RAM/device container and renderer
witness, stage all GPU/device validation before commit, preserve the two
transport queues, contexts/resources/backing and retained scanout/cursor, and
reserve an epoch above both source and destination. Ordinary accelerated
save/load still refuse. No new Wasm checkpoint export is exposed in this layer.

Commands: `make web-dist` (recorded before freeze),
`VIRGL_GPU_CHECKPOINT_EVIDENCE_DIR=target/evidence/production-gpu-checkpoint-frozen01 make verify-E6-T11d74a`,
`node tools/verify-virgl-default-demo.mjs --output target/evidence/production-gpu-checkpoint-browser02 --task E6-T11d74a`,
and one full-history `git clone --no-local` of final head with no alternates,
scrubbed Rust/Cargo environment, followed by `make verify-E6-T11d74a`.
The initial outer recording remains **failed**: its ten native/build components
passed, and browser127/0/errors[] preceded an obsolete roadmap-copy expectation.
Only that harness line changed; the narrow corrected browser run passed. The
final pristine run passed the entire unmodified acceptance command.

Evidence of record:
`evidence/virgl-production-gpu-checkpoint/worker/native-gpu-checkpoint-submission.tar.gz`
(5,445,692 bytes; SHA256
`44bae635eecccc9c202df4e51777031d2ed1c53bb0817180c18336512210871a`;
84 reopened members,83 verified file identities). Contains exact diff/sources,
all commands/stdout/stderr, initial failed recorder, corrected browser capture,
and pristine report. Local unpacked records are in
`target/evidence/production-gpu-checkpoint-{frozen01,browser02,cold01}`.

391 core tests,23 original-wire tests and30 legacy resume/coherence tests passed.
Worker original-wire cases compare exact guest snapshots, cached/uncached
instruction hashes and final digests, serialized MMIO/both ring positions,
armed CLINT deadlines, noninitial backing generations, cursor and scanout.
Independent promoted cases exercise outer CPU corruption,26 correctly rehashed
semantic mutations, missing/duplicate CPU sections, pending versus unconsumed
completion, retained renderer scanout after original CREATE_2D/CREATE_3D unref,
and repeated restores with colliding old sequence keys. Isolated fresh-critic
removal of epoch increment fails as predicted; its own recording/verdict follows.

This is the native half only. Actual physical GPU contents/reconstruction,
paired production worker publication and default Omarchy GPU warm boot are the
ordered74b–d dependencies. Existing rendering proofs are carried across unchanged
renderer code; new accelerated browser behavior will be surfaced and deployed
with that complete paired path. Built `web/dist` is committed in3505a7c4.

### 2026-10-15 — worker — bounded guard coverage supplement

Fresh review requested direct evidence for live poison, reset-pending and
unsupported owners. Added only the original-wire fixture at `1c76deec48ed104798c1ee0a8f4816512ad5346a`;
native/browser sources and compiled dist are unchanged from the frozen proof.
Recorded fmt, target-specific clippy and
`cargo test -p wasm-vm-core --features virgl-renderer,trace --test production_virgl_critic gpu_checkpoint_poison_reset -- --nocapture`.
Both cache modes refuse save/load atomically after an original BridgePoisoned
control error while positive VIRGL negotiation remains present, and after MMIO
reset before normal service. Normal reset service permits capture and restore
at fresh epoch3. Absent GPU, NullSink/unqualified and private-proof owners refuse.
The first private fixture setup omitted enable_plic and failed before that row;
it is preserved in plan01/poison-reset01, corrected without runtime changes.
Final supplement passes, with archive `evidence/virgl-production-gpu-checkpoint/worker/poison-reset-guard-supplement.tar.gz`
(5808 bytes; SHA256 `f89e1ad5e15ec31a90021bc896da06e458b629aa80d8cbb2d95fd9adc1d2afb1`;
11 reopened members/10 identities).
The prior pristine proof and all unchanged results carry incrementally.


### 2026-10-15 — independent verifier — native checkpoint

VERDICT: verified

- P1/P7 state and execution — HELD. At runtime3505a7c4 and final acceptance
  268019ae, eight original MMIO/DMA cache/ID/fresh rows preserve exact guest
  snapshots, both queue/MMIO prefixes, cursor/retained scanout, armed deadlines
  1000003/1000079 and backing generation2/next3. Subsequent original fenced
  requests complete once; cached/uncached instruction hash9133162342038612928
  and final state digests match. Citation: worker main archive,
  `cold01/acceptance/original-wire.stdout:53` through its eight printed rows.
- P2/P3/P5 ownership — HELD. Pending and ready-but-unconsumed requests refuse
  capture/restore without retirement, used-ring or owner changes. Same-sequence
  old-epoch completions refuse after repeated restores; next original requests
  preserve sequence/creation/backing high waters. The separate guard supplement
  records live poison with positive capabilities, reset-before-service refusal,
  normal reset recovery at epoch3 and absent/NullSink/private-owner refusals
  (`guards.stdout:3`). No physical renderer is substituted by these native
  recording sinks.
- P4 corruption — HELD after concrete repairs. Preserved independent
  `outer-corruption01.stdout:3` accepted changed CPU x5=0x1235/epoch2; full native
  framing now refuses that byte before mutation. Preserved
  `native-self03.stdout:3` and :4 show unloadable successful captures after
  original CREATE_2D/CREATE_3D then UNREF; both repaired captures restore retained
  Renderer metadata. These command variants do not prove a native TwoD target.
  Final tests reject26 correctly rehashed semantic mutations, missing/duplicate
  CPU sections, all4216 proper prefixes, two trailing-data variants and rehashed
  epochMAX with complete native target bytes unchanged.
- Negative control — HELD. An archived exact3505 native source copy passes the
  promoted original-MMIO test. Removing only the fresh-epoch increment produces
  epoch1 instead of2 and exit101 (`epoch-negative01/epoch-increment-removed.stderr:5`).
  Product sources were not changed. Earlier recording-script preparation errors
  are retained and are not product failures.
- Custody and coverage — HELD. Independently reopened all84/83 main and11/10
  guard-package members/identities. The ordinary full-history --no-local clone
  has no alternates, clean tracked state and all11 acceptance commands passed:
  391core,23original-wire and30legacy resume/coherence tests, affected native/
  no-std/Wasm builds and default127/0/errors[], no proof exports. The ten initial
  hot prefixes carry; its outer report remains failed at the obsolete roadmap
  oracle. Corrected browser02 and the complete pristine run are distinct passes.
  Later changes are tests/harness/evidence only. Runtime hunk mapping and passive
  declaration/shared-compatibility metadata waivers are in `final-ledger.json`.
- SUITE: the committed independent critic fixture now has seven tests; the final
  50-line prefix/epoch addition passed focused fmt, target clippy and all seven
  native tests. No repeated cold or unrelated gauntlet was required for this
  test-only supplement. Reviewed implementations/dependencies remain frozen;
  host time-policy selection/rebase composition belongs to74c.

Independent evidence:
`evidence/virgl-production-gpu-checkpoint/verifier/independent-native-gpu-checkpoint-review.tar.gz`
(2,432,746 bytes, SHA256
`5d3f86807f0ff66909243981dbae7ba4c99ec93ffdff20fe9aefdb2354ffc3fb`,
75 reopened members/74 identities), paired JSON receipt in the same directory.
It includes pre-data predictions, both original negatives and exact sources,
repaired/provisional runs, archive/cold authentication, the isolated negative
control, final test supplement, hunk/scope ledger and promoted source.

Commands: independent original-MMIO critic cargo target; isolated frozen-source
healthy/epoch-increment-removed target; archive SHA/member/source validation;
focused rustfmt/clippy and seven-test native supplement. Scope is the native
checkpoint half only. Physical contents/reconstruction, paired worker restore,
actual default GPU warm boot, publication, recovery and300MIPS remain pending
outside this verdict. This review changes tests/status/evidence only; it does
not change or rebuild the frozen production implementation.
