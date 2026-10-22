---
id: E9-T22a
epic: 9
title: Add a genuine live unrecorded execution control
priority: 524.92201
status: in-progress
depends_on: [E9-T15, E9-T16, E9-T18c, E9-T19]
estimate: S
risk: high
capstone: false
---

## Goal

Provide the honest recording-OFF control required by the unchanged T01 campaign.

## Boundary

One runtime execution-mode boundary: explicit live-unrecorded, record and replay
assembly for the same fixed software/GPU profiles. Preserve the RAM, topology,
immutable-base/COW path, pure ICount dividers, execution/JIT settings and owned
live-provider seams. Live-unrecorded must disable SessionClock and source,
input/output and GPU-result recording, checkpoint history and JS persistence;
discarding captured receipts is not OFF. It cannot be imported or relabelled as
an exact recording. Do not add a live network service in this slice; T22b owns it.

## Acceptance criteria

- [ ] An explicit constructor/mode provides the original 256 MiB/ICount10 and 1 GiB/ICount64 live controls using the same owned device/provider seams as record mode.
- [ ] Read-only diagnostics and direct tests demonstrate no session clock/source tape, receipt queues, recorder dirty epoch, GPU-result history or durable recording in OFF; record/replay remain unchanged and refuse cross-mode misuse before mutation.
- [ ] Equal-work accounting includes actual attempted/retired/idle transitions without a per-instruction JavaScript loop, invented requested work, or artificial baseline delay. Input positions and completed work are independently inspectable.
- [ ] Exercise real full Alpine disk/input/file work and the production physical GPU path. These qualify the new mode only; full GPU desktop/HTTP and performance claims remain gated on T22b/c/d.
- [ ] Run the high-risk local gauntlet, recorded deterministic state/guest evidence, actual built-browser proof, exact-head final cold clone and fresh actual Daybreak attacks; surface the accepted control on the demo/roadmap and publish the built main Cloudflare path.

## Deterministic acceptance

`make verify-E9-T22a`. Planned target to implement for this atomic boundary.
Record all affected core/Wasm tests, native/Wasm builds and direct browser
control assertions, plus source/evidence digests and the final cold-clone proof.

## Adversarial verification

Attack invalid/replayed constructors, stale and cross-owner I/O leases,
recording/checkpoint/import APIs invoked on OFF, post-restore mode confusion,
input/console ordering, dirty RAM and GPU completion paths. Inspect that OFF
never constructs capture structures or simply drains a recorder invisibly.
Probe real work counts at interrupt, exception, SBI, WFI/idle, JIT, source-flush
and final-budget boundaries. Preserve genuine baseline optimizations; do not
slow OFF to make the later overhead ratio pass. Sabotage one meaningful mode
or accounting guard and show that the promoted direct tests detect it.

## Verification log

### 2026-10-22 — worker — begin explicit unrecorded runtime boundary

Activated only after Daybreak's completed read-only design audit identified the
missing mode. All dependencies are verified. Parent E9-T22 is cancelled solely
as a planning container, replaced by ordered T22a–d. This task alone occupies
the active lane. Risk is high: architectural scheduling, provider ownership,
recording/replay identity and GPU-result boundaries change. No runtime code or
acceptance target is implemented at activation. Implement, record the full
prescribed risk-tier proof and final cold clone, and hand the exact diff plus
evidence to a fresh actual Daybreak verifier. Only that verifier sets verified.
No merge is authorized; continue the native stack with every PR left open.
