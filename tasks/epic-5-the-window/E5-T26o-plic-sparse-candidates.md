---
id: E5-T26o
epic: 5
title: Visit only eligible PLIC candidate bits during source selection
priority: 526.5995
status: verified
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

### 2026-09-08 — fresh verifier — VERDICT: verified

P0–P8 HELD for O's selector-only claim. Final report:
`evidence/e5-t26o/verifier/final.md`; implemented submission
`b0b37de34c7355faeb3279f147ca58fa0c174236` preserves runtime/test/gate code
from final proof head `aaa8d40625eaf3a2bf9ba6a5dbe4ef0909495ca0`.
Read all627 lines of `evidence/e5-t26o/main-gates/07-final-clone.log` and
independently confirmed SHA256
`0aa00c3c134abf74209dae64b4f45691eb61c08a6c98fe1ccc36a826f0390597`.
The sole clean clone passes `make verify-E5-T26o`:31 native +4 actual-WASM
tests, scoped format/clippy and affected builds, fresh target/scrubbed overrides.

Independent word-derived trap/return state and the complete21-record trace hold;
the digest is RAM-only, with architecture and counters asserted separately.
The reserved seed and reversed both-claimed/source0 variant holds natively and
on WASM, now promoted in the shared `plic_sparse_verifier` fixture and wrappers.
One executed scratch mask-removal mutant fails the expected semantic assertion;
restored scratch/main source hashes match. The126/0 built-demo record and viewed
PNG hold. Every changed selector operation is exercised; no source-safety or
coverage refutation remains. The stale worker narrative hash is corrected.

No runtime/test changes or repeated gate, clone, demo or sabotage were needed for
this final review. Carry unchanged M/N/image/observer/harness evidence. F is not
verified; no speedup, deadline, merge or deployment is claimed. Metadata commands:
`python3 tools/check_task_policy.py` → `python3 tools/build_queue.py` →
`make tasks-json`; verdict/task/queue/web-task metadata committed separately with
`SKIP_WEB_BUILD=1`. Main retains ownership of dist metadata, stack submission and F.

### 2026-09-08 — worker submission — exact-head PLIC evidence

Runtime freeze `02c79f5672c3f1a08a3429f7b32dce4e051a41ec`; final promoted
test/gate/bundle head `aaa8d40625eaf3a2bf9ba6a5dbe4ef0909495ca0`.
Only best_source changes: ascending set-bit iteration excludes source0 and
retains unsigned thresholds/priorities, EIP delegation and all stored state.
Production SHA256 `9f5def69ccf6e98fb72185a9a2714c00caa5de16fe97c218d5555f93f4dc55f1`.

`make verify-E5-T26o` passes scoped fmt/clippy,31 native and4 actual-WASM
tests plus affected builds. This includes152 worker context cases,128 fresh
critic-seed context claims, reversed both-bank completion, full behavioral
bytes/counts/MMIO accounting, and the actual MEI guest fixture. Its21-record
canonical trace matches the independent hand oracle; RAM-only SHA256 is
`c055e21cdc4ae3b9a55ddee3919d9bbc6fe2d7340a5830370a4aa3d79f6bc891`.
PC/MEPC/cause/mode/MSTATUS/registers/counts and retirement state are asserted
separately; the digest is not represented as full CPU state.

One final pristine clone runs
`bash evidence/e5-t26o/run-final-clone.sh aaa8d40625eaf3a2bf9ba6a5dbe4ef0909495ca0`.
It exits0, starts/ends clean, has no object alternates, uses a fresh local
target and scrubbed compiler/test overrides. Retained clone:
`/private/tmp/e5-t26o-final.9J3lj8Wm/repo`; raw log
`evidence/e5-t26o/main-gates/07-final-clone.log`, SHA256
`0aa00c3c134abf74209dae64b4f45691eb61c08a6c98fe1ccc36a826f0390597`.

`make web-dist` preserves the two unrelated dirty artifact manifests. One
`E5_DEMO_TASK=E5-T26o E5_DEMO_OUT=evidence/e5-t26o/demo-02c79f56 node tools/verify/e5-t18e-demo-smoke.mjs`
records126/0, zero non-favicon console/HTTP errors and the visible task.
Both coordinator and critic view the retained PNG. WASM SHA256 is
`20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238`.

One executed scratch-only bit0-mask sabotage fails the independent EIP
assertion for hostile source0 hiding eligible31; the source is automatically
restored and hash-checked. An earlier incomplete-workspace setup failure did
not execute tests. The initial lib-test build failure is also retained; adding
the existing gpu-trace test feature fixes that gate only. Detailed commands,
failures, raw logs and hashes are in `evidence/e5-t26o/README.md` and
`verifier/provisional-findings.md`. Worker narrative's old fixture hash is
explicitly corrected without changing code. Fresh final verdict remains due.
No F timing acceptance, speedup, Epic5 completion, merge or deploy is claimed.

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
