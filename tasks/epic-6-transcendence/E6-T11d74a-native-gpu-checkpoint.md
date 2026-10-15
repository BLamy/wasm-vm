---
id: E6-T11d74a
epic: 6
title: Capture and restore quiescent production GPU device state
priority: 525.0270381
status: implemented
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
