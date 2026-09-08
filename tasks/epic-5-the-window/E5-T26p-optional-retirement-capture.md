---
id: E5-T26p
epic: 5
title: Specialize optional interpreter retirement metadata without changing effects
priority: 526.5996
status: in-progress
depends_on: [E0-T16, E1-T04, E5-T26o]
estimate: S
risk: high
capstone: false
---

## Goal

Make returned retirement records optional at the shared interpreter boundary while
preserving every architectural effect. Source constructors and a trace-symbol scan
do not prove generated overhead; inspect matched actual artifacts before adoption.
This task makes no F latency or Omarchy performance claim.

## Boundary

One shared Hart instruction match and architectural commit, with private recording
and unit-returning capture modes. Track successful-store address/width independently
of optional trace records; retain the existing retirement overlap check. SC's current
reservation consumption before a potentially faulting store stays inside its arm.
Keep all translation, bus, register/FP/CSR/PC, counter, WFI/xRET and trap ordering.

Only existing `Hart::step` and `Machine::run` select the unit mode through private
ordinary/cached dispatch. Public `step_traced`/`run_traced`, arbitrary sinks (including
`wants_records=false`) and `exec_oracle` retain existing behavior. No TraceSink API or
object-safety change; its wants_records method still governs only JIT admission.
Do not duplicate instruction semantics. Cache write-log draining, FenceI handling,
physical cross-page logging and DMA invalidation remain unchanged.

No JIT policy, clocks, budgets, guest/image/helper, F harness/deadline, snapshot format,
ISA capability, independent-machine or Epic6 work. Ownership is this one capture boundary.

## Acceptance criteria

- Matched optimized baseline/candidate native and actual-WASM artifacts retain exact
  source/toolchain/flags/digests. Inspect reachable ordinary/cached callers and execute
  callees: demonstrate removed return-buffer/metadata work for unit mode, retaining
  recording as positive control; report code-size effects. Stop this candidate before
  broad submission or another F boot if elimination is not demonstrated. Microbenchmark
  numbers, if collected, are not a browser speedup claim.
- Ordinary/cached × recording/untraced cases with JIT disabled agree with independently
  retained baseline outcomes for integer/FP registers, PC, CSR/counters, reservations,
  traps/raw compressed tval, RAM and ordered MMIO effects. Keep no trace records on traps
  and preserve custom-sink callbacks even when wants_records returns false.
- Cover overlapping/nonoverlapping scalar/FSW/FSD successful stores, faulting stores,
  LR/SC success/failure/alignment/access faults, AMO old/new values, misaligned/cross-page
  effects, code-page SMC/DMA invalidation, and ordinary/cached control-flow/counter seams.
  Guest traces and state digests are evidence; comparing only two new paths is insufficient.
- The bounded native and actual-WASM suites named by the critic pass, with focused parity
  fixtures and one isolated reservation-effect sabotage. Relevant format/clippy/build and
  the existing zero-cost selftest pass; the symbol scan is not the artifact proof.
- One built-demo126/0 capture has zero non-favicon browser/HTTP errors. Final frozen source
  passes one pristine local clone and fresh adversarial verification. Expose verified task
  metadata only after that verdict, preserving unrelated manifest edits. Defer production
  deployment to the user-authorized Epic5/merge/Omarchy boundary.

## Verification command

make verify-E5-T26p

Keep this command scoped to the affected interpreter/capture fixtures and existing
hart_memory, trace_mem_exec, trace_retire, rv64a/f/d, predecode_diff, predecode_smc_diff,
zicntr native targets plus actual-WASM hart_mem, jit_browser_parity, rv64a/f/d and mmio.
Main owns artifact admission, the single built-demo and final clone. Unchanged prior
PLIC/JIT/image/observer evidence carries forward.

## Adversarial verification

Predict concrete state before inspecting retained baseline/candidate results. In particular,
distinguish SC's existing early reservation consumption on a fault from successful-store
overlap invalidation. Attack a custom non-record-requesting sink with observable callbacks;
it must not be silently disabled. Check recording metadata widths/values, x0 suppression,
compressed trap tval, counter suppression and both pages of a crossing write. In an isolated
scratch copy, sabotage one successful-store reservation effect and demand test failure;
restore/hash it afterward. Audit generated untraced code and its reachable callee, not only
source-level constructors or the presence/absence of trace symbols. No old-seal reuse,
weakened guard, timing inference, rr, WebKit, second clone or unrelated replay.

## Verification log

### 2026-09-08 — coordinator — bounded activation

Fresh Daybreak preflight first refused the vague candidate, then approved the concrete
design; both findings are retained in `evidence/e5-t26f/null-trace-candidate/`.
Design digest `8f493e2b1196abcdfa94164819d17d5500de793276dcd3f225b03ecf1ad70891`;
critic report `de0d2d43ee454e604384b13601dd56c3af6fcfcd848bdadeea43d7f17047d897`.
Existing runtime before any implementation is web WASM
`20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238`.
No generated overhead, semantic equivalence or latency benefit is claimed at activation.
