---
id: E0-T11
epic: 0
title: ECALL and EBREAK execution plus the HTIF tohost exit convention
priority: 11
status: in-progress
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
(empty)
