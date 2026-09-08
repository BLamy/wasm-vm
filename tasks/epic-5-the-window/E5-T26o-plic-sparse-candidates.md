---
id: E5-T26o
epic: 5
title: Visit only eligible PLIC candidate bits during source selection
priority: 526.5995
status: in-progress
depends_on: [E1-T13, E5-T26n]
estimate: S
risk: high
capstone: false
---

## Goal

Remove the unconditional 31-source scan from PLIC selection while preserving every
observable result. The authenticated current CPU profile attributes 208905 of
3260775 sampled microseconds (6.407%) to Machine::sync_plic. That motivates this
bounded change, not a claim that it causes F's latency or will meet F's deadline.

## Boundary

Change only PlicState::best_source to visit set bits of the local u32 bitmap
`pending() & enable[context] & !1u32` in ascending order with a guarded
`trailing_zeros` / clear-lowest-bit loop. Retain strict unsigned priority and
threshold comparisons. Keep eip delegated to that selector. No separate EIP
algorithm, new fields/cache/allocations/APIs, snapshot changes, pending/gateway/
claim/complete/counter changes, or changes to polling, interrupts, clocks,
budgets, image, F harness or its two-second acceptance criterion.

## Acceptance criteria

- An independent test-only old range-scan oracle agrees with EIP and claims for
  both contexts over explicit empty/disabled/singleton31/sparse/dense/tied1+31
  cases, masked-low then eligible-high candidates, zero/equal/full-u32 priorities
  and thresholds including 0x80000000 and MAX, plus a bounded recorded fixed-seed
  stream. Queries preserve complete behavioral bytes and all claim counters.
- Feed actual 156-byte snapshots through ComponentSnapshot::restore. Preserve
  arbitrary accepted bit0/priority0/enable/level/claimed bytes and raw readback.
  Bit0-only at priority MAX asserts no EIP/claim; bit0 at MAX cannot hide an
  eligible source31. Selection excludes bit0 without normalizing stored state.
- One real-bus sequence checks both contexts, shared claimed gateways, independent
  thresholds, exact nonempty/empty claim IDs and per-source claim counts, owner
  versus wrong/stale/zero/out-of-range completion, held-high re-pend and deasserted
  completion. Ordinary MMIO reads/writes each add the existing one bus hit;
  direct EIP adds none. Invalid MMIO context remains zero/no-op, whereas direct
  invalid-context EIP still panics even with no pending source (native check).
- Execute the shared selector/snapshot cases on native and actual wasm32, plus
  a short encoded-guest PLIC routing/claim sequence with asserted architectural
  state and retained canonical guest trace/digest. Preserve existing PLIC,
  snapshot-unit and interrupt regressions and the existing native
  device_completion_fires_inside_chained_loop regression; no timing redesign.
- Scoped format/clippy/build/tests pass on the frozen head. Record one local
  built-demo126/0 check with zero non-favicon console/HTTP errors and screenshot.
  Expose this task in generated roadmap metadata; preserve unrelated manifest
  edits. One final pristine clone and fresh independent verifier complete this
  task. No outage-only release or new F boot is part of this source proof.

## Verification command

make verify-E5-T26o

Keep this one task-specific command bounded to affected PLIC/native/actual-WASM
fixtures, the existing chained-delivery regression, scoped format/clippy and
affected builds. Main owns the built-demo and final exact-head clone records.
The unchanged prior M/N/image/observer/harness evidence carries forward.

## Adversarial verification

Predict selector and EIP results before inspecting evidence. Use the independent
old range oracle, not new EIP versus new claim alone. Vary one recorded seed and
restore a held-high source31 claimed in both contexts with hostile source0 bytes;
completing one bank must not reopen the other's claim. One isolated sabotage
removes the selection-time bit0 mask; explicit hostile-restore rows must fail.
Restore and hash-check the scratch source before final proof. Do not weaken
snapshot input acceptance or invalidate the whole runtime just to reject bit0.
Audit every changed runtime hunk and keep query purity and invalid-index behavior.
No rr, retired ssh dev, WebKit, independent machine, old-task replay, second
clone, or speculative speedup claim.

## Verification log

### 2026-09-08 — coordinator — activate source-reviewed PLIC prerequisite

F's exact-runtime unprofiled screen at96ecb801 fails at4104.175ms; its separate
CPU replay fails at4023.200ms. Raw records and independent reviews are retained
under evidence/e5-t26f/single-process-observer-96ecb801/,
spp-runtime-verifier/ and spp-cpu-symbols/. All11 noncustom WASM sections match
before symbol attribution. Daybreak's bounded source preflight in
evidence/e5-t26f/plic-sparse-candidate/critic-preflight.md permits this pure
selector change. Main selects best_source only, retaining delegated EIP.
F is parked on this named prerequisite; only O enters the active lane.
Neither the sample nor preflight verifies implementation or a latency benefit.
