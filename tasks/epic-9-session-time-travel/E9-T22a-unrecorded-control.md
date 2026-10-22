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

`make verify-E9-T22a`. The orchestrator requires a clean frozen head; a second
run with `--cold-clone NEW_DIRECTORY` rebuilds from that exact revision and
reconstructs the full immutable Alpine image from authenticated public chunks.
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

### 2026-10-22 — worker — development findings and implementation (not final acceptance)

The explicit mode now assembles the same owned-provider software/GPU profiles
with raw live RTC/entropy and no SessionClock, source/input/result tape,
recorder dirty bitmap, checkpoint history or durable namespace. Payload-free
native work counters charge actual interpreter/JIT/tail retires, traps/SBI,
interrupts and separately fenced WFI timer advancement. UART offer/FIFO counters
report actual positions and bytes; ordinary optimizations remain enabled.

Fresh actual Daybreak design sessions used `gpt-daybreak-blue-latest`,
`cyberAccessProgram=daybreakBlue`, with provider fallback disabled. Candidate 1
found clock, GPU profile/lease, WFI wake and history ingress defects; they were
fixed with direct regressions. Candidate 2 carried P1/P2/P3/P5/P6 and the narrow
P8 construction predictions, and identified the remaining legacy snapshot
namespace chain. Its report is `target/evidence/e9-t22a-daybreak-runtime-design-2/final-message.md`,
SHA256 3dda06ae15427d93948d154f2c76691e06ff611cafaa0a4ac14fb813f3c2c959. Neither design audit sets task status or substitutes for
final exact-head verification.

The preserved pre-fix browser counterexample is
`target/evidence/e9-t22a-legacy-history-development-failure-1/report.json`,
SHA256 `52d68feafa3e1a9ea389bc534dca6be2069141f2932751be154a43fbd2c10d36`:
`stampBootSnapshotIdentity` plus `importStoredSnapshot` created an IndexedDB
namespace while OFF, and generation advanced from 0 to 1. Explicit OFF guards
now precede all nine legacy identity/generation/snapshot operations; diagnostics
also expose the legacy resume and persistent namespace flags. The new isolated
history attack is a required acceptance gate.

Development evidence before this last correction includes full pinned Alpine
file/setup and all three UART frames delivered, the 127/0 visible demo with real
JIT execution, physical M4 Max GPU query/readback and 24 original-owner/numeric/
profile/history refusal attacks, plus the existing interpreter/JIT software and
physical GPU record/replay regressions. These dirty-tree receipts are preserved
under `target/evidence/e9-t22a-*-development-*`; they are self-validation, not a
final claim. The native OFF/record comparison now retains both complete 4096-line
guest traces and a standalone literal-instruction/value oracle. Trace SHA256
`ff4c8f7046da309f79f8af510369a74bc1fd590f3deb1b0ff88c95c816f2046a`;
architectural digest `2f46d4f0185cd2e94327082dc107b2c75c94b0637dfa678113789184de6d779f`.

`make verify-E9-T22a` now selects affected strict native/Wasm checks, recorded
native/guest boundaries, built demo, full Alpine OFF and physical GPU OFF proof,
legacy-history attacks, both complete record/replay regressions and an artifact
reader, followed by the prescribed full local wall. The final cold-clone mode
rebuilds from the exact clean revision with scrubbed Rust/Cargo configuration,
no inherited target/node_modules/rootfs, and independently reconstructs the full
pinned Alpine base from authenticated public content-addressed chunks. The
full risk-tier run, final cold proof, fresh Daybreak full charter, publication
and terminal verification remain outstanding. No HTTP, desktop workload or
performance result is claimed by this task.

The corrected legacy attack passed at development Wasm
`b103aa2068b06bfbafdd85b0ddbb0f8e12db8cb2c3c3ef9cf694eabc5e0d31a1`:
`target/evidence/e9-t22a-legacy-history-development-fixed-1/report.json`, SHA256
`f8f58524d8fe4e15fca7c61a9b0acc2bd827c4c53e954ef29968bb55e18b2fa8`.
All nine operations refused, both legacy namespace flags stayed false, generation
remained zero, and no IndexedDB database was created. This remains development
evidence; final frozen submission is required below. Candidate 2's report has a
one-entry inventory typo (34 source files, not 35); its cited manifest and patch
hashes match exactly, and the original report is preserved with a companion note.
