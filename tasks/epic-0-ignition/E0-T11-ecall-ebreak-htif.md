---
id: E0-T11
epic: 0
title: ECALL and EBREAK execution plus the HTIF tohost exit convention
priority: 11
status: verified
depends_on: [E0-T08, E0-T10]
estimate: M
capstone: false
---

## Goal
ECALL and EBREAK surface as precise traps (cause 11 — environment-call-from-M, our only
mode at Level 0 — and cause 3, breakpoint), and a host-side `Htif` component watches the
ELF-provided `tohost` address so riscv-tests-style bare-metal binaries can terminate the
machine with an exit code — the same convention Spike honors, making pass/fail and exit
codes directly comparable.

## Context
The Berkeley HTIF convention (as implemented by Spike and riscv-test-env): `tohost` is a
64-bit doubleword in guest memory located via ELF symbol; a write of `(code << 1) | 1`
requests exit with status `code` (so `1` means exit 0 / test pass; riscv-tests failures
write `(test_num << 1) | 1`). Writes with LSB = 0 are device commands we do not support at
Level 0 — they are logged and ignored, never treated as exit. This is host policy, not CPU
architecture, so it lives outside the hart, driven by the runner after each retired store.

## Deliverables
- Hart: ECALL ⇒ `Trap { cause: 11, tval: 0 }`; EBREAK ⇒ `Trap { cause: 3, tval: pc }`.
- `crates/core/src/htif.rs`: `Htif::new(tohost_addr)`, `check(&self, bus) -> Option<Exit>`
  where `Exit { code: u64 }` decodes `(v >> 1)` when `v & 1 == 1`; a `Machine`-level run
  loop (`Machine::run(max_instrs)`) that steps, consults HTIF, and returns
  `RunOutcome::{Exited(code), Trapped(Trap), MaxInstrs}`.
- Tests using in-memory assembled blobs: exit-0, exit-42, EBREAK halt, ECALL trap;
  missing `tohost` symbol ⇒ run until `MaxInstrs`, not a crash.

## Acceptance criteria
- [ ] A blob doing `li t0, 1; sd t0, tohost` yields `Exited(0)`; `(42 << 1) | 1` yields
      `Exited(42)` — in native and `wasm-pack test --node` builds.
- [ ] A 32-bit `sw` of an odd value to `tohost` also triggers exit (the check reads the
      full 64-bit word after any store into it — documented rule), while an `sd` of an
      *even* value does not exit and is logged once.
- [ ] ECALL and EBREAK leave PC at their own address and mutate nothing else.
- [ ] `RunOutcome` is exhaustively matched in the CLI/wasm layers (no `_ =>` swallowing).

## Adversarial verification
(1) Differential exit codes: run the same exit-42 blob under Spike (`spike --isa=rv64i`)
and compare process exit status with our runner — mismatch refutes. (2) Attack the watch
mechanism: store to `tohost + 4` only, store an odd byte via `sb` into the low byte —
document and test exactly which of these exit; ambiguity between implementation and task
file refutes. (3) Torture the run loop: a blob that writes an even value then never exits
must hit `MaxInstrs` at exactly the requested count (off-by-one check on retired-count
accounting). (4) EBREAK purity: registers/RAM digest identical before and after the
trapping step. (5) Strip the symbol table from a test ELF (`riscv64-unknown-elf-strip`)
and confirm graceful `MaxInstrs` behavior with a clear diagnostic, not a panic.

## Verification log

### 2026-07-02 — worker claim — commits 344f652+fix (branch task/e0-t11-ecall-htif, stacked on e0-t10)
Deliverables: hart — ECALL → Trap{cause 11 EcallFromM (our only mode), tval 0}; EBREAK →
Trap{cause 3 Breakpoint, tval pc}. The RV64I execution set is now COMPLETE — no placeholder
arms remain (dead `raw` param removed from execute()). crates/core/src/htif.rs — Htif watches
tohost; HtifStatus::decode(v): v==0→Idle, v&1==1→Exit(v>>1), else Command(v); check() is
panic-free on unmapped tohost (Err→Idle). Machine GROWN from the E0-T01 placeholder into
hart+SystemBus+Option<Htif> — the verified new()/ram_len() surface preserved exactly (E0-T01
tests + wasm wrapper unbroken; documented). load_elf sets pc=entry, arms HTIF from the symbol
(None → never exits via HTIF). run(max_instrs) → RunOutcome::{Exited(code),Trapped(Trap),
MaxInstrs}, exhaustive enum (no _ => swallow). WATCH RULE documented + tested: check reads the
FULL 64-bit tohost word after each step, change-detected so command writes log ONCE.
Tests (tests/htif_run.rs, 9): exit-0 (sd 1), exit-42 (sd 85), sw-of-odd exits / sd-of-even
logs-once (htif_command_count==1), tohost+4-only no-exit, ecall/ebreak causes+tval+PC-unmoved,
EBREAK full-dump+RAM-digest purity, MaxInstrs off-by-one incl. budget 0 (exact count), no-HTIF
graceful MaxInstrs, ELF-fixture load arms HTIF. 3 wasm32 mirrors. miri 9/9 (117s).
Documented RV64 gotcha (in-test): building the tohost pointer with `lui 0x80001` sign-extends
to 0xFFFFFFFF_80001000, so the blob helper seeds x6 directly.
PROCESS NOTE (honest): first push RED-CI'd — two stale placeholder tests (hart_semantics +
critic-authored verifier_e0t07_angles) still asserted ecall/ebreak trap IllegalInstruction;
local gate had used `grep -c "test result: ok"` which masks FAILED lines. Fixed forward (real
causes, purity intact; angles edit documented in-file), gate discipline corrected.
Gates: fmt / clippy exit 0 / 23 native suites (0 FAILED, verified) + 10 wasm / no_std wasm32 /
CI green run 28629640389.
rr: SKIPPED locally (macOS/no PMU); Spike exit-code differential is angle 1 for the verifier,
lands at E0-T13.

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: refuted
- P1 exit-code decode — HELD. Exited(code) for tohost=(code<<1)|1 across {0,42,255,1000,0x7FFF_FFFF,0xDEAD_BEEF,1<<62}, incl. direct 64-bit writes; green in miri + wasm.
- P2 watch mechanism — HELD. sb odd→low-byte exits; sb→+7 high-byte = command no-exit; even-then-same-even counts once; even-then-different-even counts 2; command-then-exit still exits; zero-reset-then-same-even re-counts. Zero ambiguity vs htif.rs doc.
- P3 run-loop off-by-one — HELD. 4000×addi x1,x1,1: after run(N) x1==N exactly for N∈{0,1,2,1000}.
- P4 ECALL/EBREAK purity — HELD. 31-reg + RAM sentinels identical across trapping step; ECALL cause 11/tval 0, EBREAK cause 3/tval=pc, PC unmoved; miri-clean.
- P5 stripped-symtab + tohost-outside-RAM — HELD. llvm-strip fixture loads, HTIF unarmed, run→MaxInstrs cmd_count 0 no panic; bogus tohost → BusFault decodes Idle, never exits.
- rr — SKIPPED loud (macOS/no PMU); Spike exit-code differential at E0-T13.
- COVERAGE — REFUTED. Mutation (d) run-loop checks HTIF BEFORE step SURVIVED the worker's 9-test suite. Not equivalent: a 2-instr exit blob under run(2) returns Exited(0) on step-then-check but MaxInstrs on the mutant — an exit written on the exactly-last budgeted instruction is silently dropped. exit_on_final_budgeted_instruction_is_observed passes on HEAD, FAILS on the mutant. Worker tested MaxInstrs off-by-one AND exit-under-generous-budget but never the exit×budget boundary. Mutations (a)EcallFromU (b)EBREAK tval 0 (c)even-as-exit (e)change-detect-removed (f)0..=max (g)code=v all KILLED. DEMAND: promote the boundary test.
- MOCK/HONESTY: claim commit tasks-only; fix commit touches exactly the two disclosed stale files — RED-first disclosure truthful. Machine-growth audit: new()/ram_len() preserved (33 lib tests green), WasmMachine compiles+works, Machine::new .expect()s Ram::new = equivalent to old vec![0;n] OOM-abort (not a regression); no `_ =>` in wasm/cli. Suite-edit audit: verifier_e0t07_angles purity loop byte-identical, only the two case cause/tval tuples changed — property not weakened.
- NOVEL: "exit on exactly the last budgeted instruction" boundary attack (run(2) on addi;sd) — the concrete input exposing mutation (d); "even→reset-to-0→same-even re-counts" change-detection edge. Both pass on HEAD.
- SUITE: promote verifier_e0t11_attacks.rs (11 tests incl. boundary + watch-mechanism matrix); discard nothing.

### 2026-07-02 — rework after refutation (worker)
Applied the demand: promoted verifier_e0t11_attacks.rs (12 tests incl.
exit_on_final_budgeted_instruction_is_observed and the full watch-mechanism matrix) +
the stripped.elf fixture (provenance appended to fixtures/build.sh) verbatim (one
#[allow(dead_code)] on an unused helper + a parenthesization for clippy, assertions
untouched). Re-ran the critic's exact mutation (d) FAITHFULLY (HTIF check moved BEFORE
the step): now KILLED by exit_on_final_budgeted_instruction_is_observed (11 passed/1
failed), reverted, lib.rs clean. Gates: clippy exit 0, full crate 0 FAILED. Status
implemented; re-verification requested.

### 2026-07-02 — adversarial verifier (re-verification) — VERDICT: verified
- (a) Mutation (d) re-applied faithfully (HTIF check moved BEFORE step, after-check removed): RED — exit_on_final_budgeted_instruction_is_observed FAILED (11/1). The promoted boundary test kills the exact named mutant. Reverts clean.
- (b) Promoted suite semantically verbatim — diff vs original shows only rustfmt reflow + the announced #[allow(dead_code)] + one parenthesization; every assertion byte-identical; 12/12 green.
- (c) stripped.elf genuinely stripped: readelf -sW → 0 tohost symbols, -SW → 0 symtab sections (minimal.elf still has 1). The stripped_elf test genuinely drives the tohost=None path (load ok, MaxInstrs, cmd_count 0, no panic).
- (d) Two invented mutants: N1 command-count saturate-to-1 → KILLED (even_then_different_even_counts_twice + reset_recounts, 10/2). N2 skip HTIF check on FIRST iteration → SURVIVED (contrived: exit-at-index-0 under run(1)); residual noted non-blocking, hardening line suggested.
- (e) Full workspace green (grep FAILED == 0), clippy --workspace --all-targets -D warnings clean.

### 2026-07-02 — residual-gap closure (worker, beyond the demand)
Closed the non-blocking N2 residual proactively: added htif_run::exit_at_index_0_under_run_1_is_observed
(a single sd that exits as instruction 0 under run(1)). Re-ran the critic's exact N2 mutant
(skip HTIF check on the first loop iteration): now KILLED. Both budget-boundary interactions
(exit-at-last-instruction and exit-at-index-0) are now regression-pinned. Gates: clippy exit 0,
full crate 0 FAILED (10 htif_run tests).
