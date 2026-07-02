---
id: E4-T25
epic: 4
title: Lockstep interpreter-vs-JIT differential verification and randomized fuzzing
priority: 425
status: pending
depends_on: [E4-T13, E4-T14, E4-T15, E4-T18]
estimate: L
capstone: false
---

## Goal
A lockstep mode where the JIT engine and a shadow interpreter execute the same guest in
parallel and compare architectural state at every translated-block boundary — plus a
randomized RV64GC program fuzzer feeding both engines — turning "the JIT is correct"
from a hope into a machine that hunts divergences continuously, with automatic trace
capture and test-case minimization when it finds one.

## Context
This is the epic's stated verification doctrine (ROADMAP Level 4: the JIT is verified by
differential execution against the trusted interpreter). Lockstep runs in ICount mode
(E4-T24) so timer interrupts land at identical instruction boundaries in both engines —
otherwise comparisons drown in benign interrupt-timing skew. Master = JIT engine; after
each translated block (or recorded interpreter-fallback span), the shadow interpreter
executes the same range from the same prior state; compare pc, x1–x31, f-regs + fcsr
(per E4-T15 policy), privilege, and the trap-relevant CSR set (mstatus/mepc/mcause/mtval/
sepc/scause/stval/satp), plus a write-log digest of the span's stores (full-RAM hash
every N blocks as backstop). The fuzzer generates seeded, weighted random RV64GC blocks
(heavy on E4-T13/T14/T15 corner classes, misaligned addresses, page-straddles, x0 uses)
run from randomized states in a sandbox address space; on divergence: save seed, minimize
by instruction bisection. Prior art: riscv-dv, v86's differential expect-test rigs.

## Deliverables
- Lockstep engine mode (`--lockstep`) usable natively (fast) and in-browser (slow, but
  must work — engine-behavior differences are precisely what it exists to catch).
- Block-boundary comparator with the state set above + write-log digest + periodic full
  memory hash; on divergence: dump both states, last N block traces, and the block's
  wasm bytes disassembled (via the E4-T07 crate's test-only disassembler or wasmprinter).
- Fuzzer: seeded generator, corner-value pools, ~1k-instruction programs, trap-safe
  sandbox harness; minimizer producing a reduced repro committed as a regression test.
- CI jobs: (a) lockstep over the first 500M instructions of Alpine boot, native, every
  merge; (b) 30-minute fuzz soak nightly; (c) regression corpus replayed every merge.
- Found-bug workflow documented; corpus directory with all minimized repros.

## Acceptance criteria
- [ ] Lockstep over 500M boot instructions: zero divergences, runtime ≤ 30 min native CI.
- [ ] Fuzzer demonstrably *can* find bugs: seeded mutation-injection test (deliberately
      mis-translate SRAW in a branch, e.g. wrong shift mask) is caught within 5 minutes
      of fuzzing and auto-minimized to ≤ 20 instructions.
- [ ] Comparator covers the full stated state set — audit test enumerates compared fields
      against the architectural-state struct and fails on unlisted additions (state added
      later can't silently escape comparison).
- [ ] Full corpus + 1M fuzz programs replay clean at task completion.
- [ ] A divergence report contains everything needed to reproduce offline (seed, states,
      wasm bytes) — verified by reproducing one injected bug from its report alone.

## Adversarial verification
Refute the rig's power, then the JIT. Attack angles: (1) mutation-adequacy sweep: inject
10 distinct subtle translator bugs (off-by-one shift mask, missing LWU sign-extension
confusion, wrong writeback on taken-branch exit, dropped fflags, stale-local reuse across
a call-out) — each must be caught by fuzz or lockstep within a bounded budget; any
survivor refutes the adequacy claim; (2) coverage honesty: instrument which translator
paths (opcode × exit-kind) the fuzzer exercised; a headline path at 0 executions refutes
"randomized coverage"; (3) comparator blind spots: introduce a memory-only divergence
crafted to collide with the write-log digest — collision tolerance must be stated and the
full-hash backstop must catch it within N blocks; (4) run lockstep in-browser for 50M
instructions — wasmtime-vs-browser engine divergence (NaN payloads etc.) surfacing here
refutes E4-T15/T09 claims; (5) burn real hours: a 4-hour fresh-seed fuzz session — any
new divergence is, definitionally, a refutation of the epic's correctness story to date.

## Verification log
(empty)
