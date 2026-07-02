---
id: E0-T05
epic: 0
title: Integer register file and PC with hardwired-zero x0 semantics
priority: 5
status: implemented
depends_on: [E0-T01]
estimate: S
capstone: false
---

## Goal
An `XRegs` type holding the 31 writable RV64 integer registers plus a `u64` PC, where
`x0` reads as zero on every path and writes to it are architecturally discarded — the
invariant enforced in exactly one place so no executor can violate it.

## Context
RISC-V Unprivileged ISA (20191213) §2.1: `x0` is hardwired zero; a huge fraction of real
code (`li`, `mv`, `nop`, `j` = `jal x0`, `ret` = `jalr x0`) depends on discarded writes.
Bugs here are silent and poison every differential trace, so this lands before any
execution logic. Also establishes the register dump format used by the CLI (E0-T18),
snapshots (E0-T17), and trace records (E0-T16).

## Deliverables
- `crates/core/src/hart/regs.rs`: `XRegs` with `read(r: u8) -> u64` and
  `write(r: u8, v: u64)` (write to index 0 is a no-op); `Default` = all zeros.
- ABI-name table (`x1`=`ra`, `x2`=`sp`, … `x31`=`t6`) per the RISC-V psABI, used by a
  stable `Display`-style dump: one line per register, `x{n:02}({abi:>4}) = 0x{v:016x}`.
- Unit tests incl. a `proptest` that arbitrary write/read interleavings never make
  `read(0)` non-zero; wasm mirror test.

## Acceptance criteria
- [ ] `write(0, v)` for any `v` followed by `read(0)` returns 0; all of x1–x31 round-trip.
- [ ] Out-of-range register index (≥32) panics in debug and is unreachable from decode
      (decoder emits 5-bit fields only) — documented and asserted.
- [ ] Dump output is byte-stable (golden-string test) and includes PC.
- [ ] Suite passes natively and under `wasm-pack test --node`.

## Adversarial verification
(1) Attempt to bypass the accessor: grep the crate for direct field access to the register
array from outside `regs.rs` — any hit is a design refutation (the invariant must be
unbypassable). (2) Once E0-T07 lands, execute `addi x0, x1, 5`, `lui x0, 0xFFFFF`, and
`jal x0, .+8` and confirm `x0` stays 0 in the trace — record this as a follow-up check in
the log. (3) Property-test with 10k random (reg, value) sequences comparing against a
`[u64; 32]` oracle that re-zeroes index 0. (4) Diff the dump format against the one the
CLI emits later — any drift refutes the "stable format" claim. (5) Confirm `Default`
zeroing on wasm32 (fresh instance in `wasm-pack test --node`).

## Verification log

### 2026-07-02 — worker claim — commit 974d719 (branch task/e0-t05-register-file, stacked on e0-t04)
Deliverables: crates/core/src/hart/regs.rs — XRegs { regs: [u64;32] (PRIVATE — the
compiler enforces angle 1's unbypassability), pub pc }; read/write with the x0 invariant
in write() alone; debug_assert on r>=32 plus release-mode bounds-check panic (documented:
can never silently alias); ABI_NAMES per psABI; Display dump byte-stable, golden-tested
against both a pinned literal prefix AND full reconstruction, pc line first + 32 register
lines, format `x{n:02}({abi:>4}) = 0x{v:016x}`.
Tests: 9 native unit (golden dump, should_panic OOB read+write, psABI spot checks,
roundtrip x1-x31, x0 discard incl. u64::MAX, default zeroing) + proptest (200-op
arbitrary interleavings vs an index-0-re-zeroing oracle; #[cfg_attr(miri, ignore)] with
a 10k-op LCG-vs-oracle twin that DOES run under miri) + 3 wasm32 mirrors (fresh-instance
zeroing per angle 5, 10k LCG on wasm32, dump stability).
Gates: fmt / clippy -D warnings (exit code captured directly this time — two real lints
caught and fixed: derivable Default impl, field-reassign-with-default) / 33 native tests
/ no_std wasm32 build / wasm-pack test --node (14 tests across 4 suites) / miri scoped to
hart (8 passed, proptest ignored by design there). CI: see PR.
Follow-ups logged per the task's own attack list: angle 2 (execute addi/lui/jal writing
x0 through the real executor) re-checked at E0-T07; angle 4 (CLI dump drift) re-checked
at E0-T18.
rr: SKIPPED locally (macOS/no PMU per AGENTS.md); deterministic native+miri+wasm+CI
evidence layers.

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: refuted
- P1 accessor-bypass — HELD. Zero `regs[`/`.regs` hits outside regs.rs; pub surface = {ABI_NAMES, pc, read, write}; both a struct literal with regs set AND the FRU form rejected with E0451 from an external test file (compile attack). FRU is compiler-blocked — stronger than assumed; only external constructors are Default and Clone-of-valid.
- P2 own-seed oracle — HELD. 20k xorshift64 ops (verifier seed 0x0B5E_77A4_17C0_FFEE, forced x0 writes every 16 ops, full 32-register probe per op) vs re-zeroing oracle: 0 divergences native debug, native release, AND miri (7 passed, 104s).
- P3 golden format vs TASK spec — HELD. All 33 lines hand-parsed against the spec format (width-4 right-aligned abi, exactly 16 lowercase hex); names equal an independently transcribed psABI table; x08 = s0, no fp drift.
- P4 OOB panics — HELD. read/write of 32 and 255 panic in BOTH debug and release (bounds check), 4 should_panic tests green in both profiles.
- P5 MUT-B2 ABI-name swap — FAILED. Swapping "a3"/"a4" passed the worker's ENTIRE suite (33 passed) and is invisible to the wasm mirrors. Root cause: the golden test's "full reconstruction" builds expected from ABI_NAMES itself — self-licking for names — and the pinned literal covers only 4 of 33 lines (indices 3-7,9,11-16,18-26,28-30 unprotected). DEMAND: pin the complete 33-line golden literal or assert against an independent psABI table; verifier_attack.rs offered for promotion (kills it instantly).
- P6 wasm mirrors — HELD. 3 named tests green under wasm-pack test --node incl. fresh-instance zeroing (angle 5).
- rr — SKIPPED loud: macOS, no PMU. Mitigation: miri on the 20k oracle + native/release/wasm in scrubbed cold clone + CI.
- COVERAGE: all hunks executed. Mutation kills: guard removal → 3 red; ra/sp swap → 2 red; dropped space → golden red; Default pc=1 → red. MUT-B2 SURVIVED (the refutation). proptest dep waived (manifest).
- MOCK/HONESTY: pinned literal load-bearing but partial (4/33 lines); reconstruction half shares ABI_NAMES with impl. Counts exact (33 native / 14 wasm; "9 unit" is 8 unit + 1 proptest — minor phrasing). 80f3957−974d719 tasks-only. CI 28599251822 green with regs tests in both jobs. No cfg(test) leaks, no env dependence.
- NOVEL: Clone-laundering attack (clone a valid XRegs, hammer the clone incl. write(0, u64::MAX), assert deep-copy independence + x0=0 both) — HELD, native+release+miri.
- SUITE: promote verifier_attack.rs (7 tests: spec-derived dump parser w/ independent psABI table, 20k own-seed oracle, 255-index OOB, clone-laundering). rework dump_format_is_byte_stable → full 33-line pinned literal. keep all other worker tests (proven killers). discard nothing.

### 2026-07-02 — rework after refutation (worker)
Applied both demands: (1) dump_format_is_byte_stable now pins the COMPLETE 33-line golden
literal — no reconstruction, every ABI name and format byte independent of the impl;
(2) promoted the verifier's suite verbatim as crates/core/tests/verifier_e0t05.rs.
Kill confirmed by re-running the verifier's exact surviving mutation (a3/a4 swap in
ABI_NAMES): dump_format_is_byte_stable goes RED (1 failed), previously all-green.
Gates re-earned: fmt / clippy exit 0 (captured directly) / 33+9+7+8 native tests /
wasm-pack test --node 4 suites ok. Status back to implemented; re-verification requested
from the refuting verifier session.
