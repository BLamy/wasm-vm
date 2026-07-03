---
id: E0-T11
epic: 0
title: ECALL and EBREAK execution plus the HTIF tohost exit convention
priority: 11
status: implemented
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
