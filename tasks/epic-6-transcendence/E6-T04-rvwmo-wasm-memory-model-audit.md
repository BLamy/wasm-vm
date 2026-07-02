---
id: E6-T04
epic: 6
title: RVWMO-on-wasm memory model audit — mapping document and litmus suite
priority: 604
status: pending
depends_on: [E6-T01]
estimate: M
capstone: false
---

## Goal
A written, defended mapping from RVWMO (guest memory model) onto the wasm/JS shared-memory
model (host), with an executable litmus-test suite that runs the classic shapes on real
browsers — so E6-T05's parallel harts are built on an argued-correct foundation instead of
"atomics are probably fine".

## Context
This is where naive SMP ports die. Key mismatches to resolve on paper before writing code:
(1) RVWMO guarantees single-copy atomicity for naturally aligned loads/stores up to XLEN;
wasm *non-atomic* accesses to shared memory are "unordered" and may tear per the spec even
when aligned — so emulating plain guest stores with plain wasm stores is spec-illegal,
even if engines don't tear in practice. (2) wasm threads offer only seq_cst atomics plus
unordered accesses; RISC-V aq/rl and FENCE variants must map to something ≥ as strong
(seq_cst is stronger than anything RVWMO requires — safe, but quantify the cost).
(3) Rust soundness: hart workers share RAM; holding `&mut [u8]` over memory another thread
mutates is UB — accesses must go through raw pointers with atomic intrinsics
(`AtomicU8/U16/U32/U64::from_ptr` style) or a justified volatile strategy.

## Deliverables
- `docs/memory-model.md`: op-class mapping table (plain load/store by size, LR/SC, AMOs,
  aq/rl bits, FENCE r/w variants, FENCE.TSO, IO ordering) → wasm ops (`*.atomic.*`,
  `atomic.fence`, unordered); the tearing analysis; the Rust aliasing/soundness plan; and
  a decision with measured perf delta: atomic-everything vs unordered-with-documented-risk
  for plain accesses (benchmark both on a memory-bound guest workload).
- Litmus suite: MP, SB, LB, CoRR, CoWW, IRIW, and two mixed-size shapes as bare-metal
  multi-hart guest binaries with host-thread runner (native) and worker runner (browser),
  each run ≥10^6 iterations with outcome histograms and allowed-outcome oracles from the
  RVWMO litmus literature (herd7 riscv model output checked in as expected sets).
- CI job running the suite natively; manual runbook for Chrome + Firefox + Safari.

## Acceptance criteria
- [ ] The mapping table covers every memory-touching instruction class in RV64GC with an
      explicit wasm lowering and a one-line soundness argument each.
- [ ] Litmus runner reports zero outcomes outside the herd7-allowed set, natively (16
      threads, TSan-clean for the emulator's own code) and on two browser engines.
- [ ] The plain-access decision is recorded with numbers (≥1 benchmark, both strategies,
      same hardware) and the chosen strategy is the one E6-T05 implements.
- [ ] The doc names the residual risks explicitly (e.g. engine tearing on unordered
      accesses if that strategy is chosen; ABA on SC — cross-reference E6-T06).

## Adversarial verification
This task's claim is the document plus the suite, so attack both. Re-derive three table
rows independently against the wasm threads spec and the RVWMO chapter; any row whose
lowering is weaker than the RVWMO requirement (not merely different) is a refutation —
pay special attention to FENCE w,r (SB shape) and to whether unordered plain stores can
be observed torn by an atomic reader. Run the litmus suite with the iteration count
raised 10x on the weakest hardware available (a phone or low-core-count box changes
schedules); a single forbidden outcome refutes. Inject a deliberate bug (drop one fence
in the runner) and confirm the suite actually catches it — a suite that can't detect a
seeded violation refutes the suite's value claim. Check the Rust plan compiles under Miri
for the native path where applicable.

## Verification log
(empty)
