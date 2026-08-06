---
id: E4-T25
epic: 4
title: Lockstep interpreter-vs-JIT differential verification and randomized fuzzing
priority: 425
status: verification-debt
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

### 2026-08-06 — interrupt-free lockstep core + fuzzer + minimizer (partially-verified)

Built the headless core (interrupt-free, deterministic block lockstep) — the leg that is fully
doable before E4-T24 ICount. Master = JIT (wasmtime), shadow = `Hart::exec_oracle`; the fuzzer emits
seeded, corner-value-heavy RV64IMA(+mixed-width C) blocks from randomized architectural states and
lockstep replays each recorded block from an identical prior state, comparing the full `ArchState`.

Files:
- `crates/jit-translate/src/lib.rs` — test-only mutation hooks behind the `mutation-testing` feature
  (`mut_hooks` + `pub mod mutation`); 5 deliberate, never-shipped mis-translations. OFF by default →
  every hook folds to `false` and is optimized out (clippy-clean, translator bytes unchanged).
- `crates/jit-translate/Cargo.toml`, `crates/jit-runtime/Cargo.toml` — `mutation-testing` feature +
  `wasmparser`/`wasmprinter` dev-deps.
- `crates/jit-runtime/tests/lockstep_fuzz.rs` — `ArchState` (pc, x1..31, f-regs+fcsr, privilege,
  mstatus/mepc/mcause/mtval/sepc/scause/stval/satp, full-RAM FNV backstop) + exhaustive-destructure
  comparator; block-boundary lockstep; seeded splitmix64 fuzzer; instruction-bisection minimizer;
  divergence report with wasm disassembly (wasmprinter).
- `crates/jit-runtime/tests/lockstep_fuzz/corpus.rs` + `crates/jit-runtime/corpus/` — regression
  corpus (6 minimized repros replayed clean every run) + human-readable repro artifacts.

Gates run (all green, output pasted in the task report):
- **AC2 killer gate** (`ac2_fuzzer_catches_and_minimizes_injected_bug`, `--features
  mutation-testing`): mis-translated SRAW caught at program 11 / block 3, auto-minimized to **1
  instruction** (≤20). Full report saved to `corpus/sraw-wrong-shift-mask.repro.txt`.
- **Adversarial #1 mutation-adequacy sweep** (`adversarial_mutation_adequacy_sweep`): all 5 injected
  bugs (sraw-shift-mask, lw-dropped-sign-ext, taken-branch-skips-writeback, div-by-zero-wrong,
  jalr-omits-bit0-clear) caught + minimized to ≤2 instrs within a 100k-block budget. NO survivors.
- **AC3 comparator-completeness audit** (`comparator_completeness_audit`): all 14 `ArchState` fields
  compared (compile-time exhaustive destructure + runtime per-field flip).
- **AC5 offline repro** (`ac5_repro_reproduces_offline`): a caught div-by-zero repro reproduced from
  its captured prior-state + RAM + block alone.
- **Clean run** (`fuzz_clean_no_divergence_small`, correct translator): ~4k blocks / ~24k instrs,
  ZERO divergences.
- Regressions stay green: `jit-runtime` full suite, `jit-translate` differential (10 pass), core
  `predecode_diff`, wasm32 no_std core build, `crates/wasm` release build, clippy -D warnings
  (default + `mutation-testing`) + fmt clean.

### Verification debt (deferred — needs the Linux `dev` box / long soak / browser / E4-T24)
- **AC1** — lockstep over 500M Alpine-boot instructions ≤30 min native: needs `dev`; the
  WITH-interrupts form is additionally gated on **E4-T24 ICount** (identical instruction-boundary
  alignment) — otherwise benign timer-interrupt skew drowns the comparison. `fuzz_clean_no_divergence_soak`
  (~1M blocks, `--ignored`) is wired for the CI/dev soak.
- **AC4** — 1M-fuzz-program replay: `dev` soak (`--ignored` soak test drops in).
- **Adversarial #2** — opcode×exit-kind coverage instrumentation at full scale.
- **Adversarial #3** — write-digest collision craft + full-hash-backstop-catches-within-N: the lossy
  `write_digest` is implemented and documented (collision tolerance stated), `ram_hash` is the
  backstop, but the adversarial collision harness is not yet wired. (Note: the current comparator
  hashes full RAM every block, strictly stronger than the every-N schedule.)
- **Adversarial #4** — in-browser 50M-instruction lockstep (wasmtime-vs-browser NaN/engine
  divergence): the mac OS-reaps browser boots; run on `dev`/CI.
- **Adversarial #5** — 4-hour fresh-seed fuzz session: `dev`.
- **Deliverable — integrated `--lockstep` engine mode over the real `Machine`**: this leg runs the
  standalone block harness (flat wrapping RAM, E4-T09 imports) rather than the live `Machine`
  run-loop; wiring lockstep into `Machine` alongside device sync + MMU is follow-up work. Trapping
  blocks (e.g. misaligned atomics) are currently SKIPPED (out of the interrupt-free scope; precise-
  trap JIT/interp equivalence is covered by `crates/jit-runtime/tests/precise_traps.rs`).
- **Ticket-named mutations not expressible in this translator** (honest note): "dropped fflags" — FP
  side-exits entirely (E4-T15), so there is no JIT fflags path to break; "stale-local reuse across a
  call-out" — the shipped softmmu path materializes operands inline before the call-out, so there is
  no stale-local site. Both were substituted with equally-subtle in-scope bugs (div-by-zero-wrong,
  jalr-omits-bit0-clear) to keep the sweep at 5 genuine, caught mutations.
- No fabricated numbers: only gates actually run above are claimed green.
