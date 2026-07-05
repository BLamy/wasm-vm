---
id: E1-T29
epic: 1
title: Debug triggers — tdata1/tdata2 breakpoint CSRs (Debug spec §5)
priority: 129
status: pending
depends_on: [E1-T10]
estimate: M
capstone: false
---

## Goal
Implement the minimal debug-spec trigger module (tselect/tdata1/tdata2, mcontrol type-2
breakpoints) so `rv64mi-p-breakpoint` passes — burning that entry from
`tests/riscv-tests-allowlist.txt`, the last allowlist entry blocking the Level 1 capstone.

## Context
`rv64mi-p-breakpoint` installs an mcontrol trigger via tdata1/tdata2 and expects an
execute/load/store address match to raise a `Breakpoint` exception with the right cause/tval.
E1-T10 delivered precise exceptions but not the trigger CSRs; the allowlist entry documents
this as "deferred to a debug-trigger task" — this task. Scope is the Level-1 minimum: enough
of the trigger module for the arch/riscv-test to pass — `tselect`, `tdata1` (mcontrol, type
field, action=exception, match on execute/load/store, M/S/U mode bits), `tdata2` (the compare
value), and firing a `Breakpoint` on match. NOT the full external-debug DM/DMI or
single-step; those belong to a later debug epic.

## Deliverables
- Trigger CSRs `tselect`, `tdata1` (mcontrol layout), `tdata2`, and `tinfo`, with WARL
  semantics (unsupported trigger types read back as disabled).
- Trigger evaluation in the fetch/load/store path: on an address/opcode match with
  action=0 (exception), raise `Breakpoint` (mcause=3) with the spec'd tval BEFORE the access
  commits, at the correct exception priority.
- Remove `rv64mi-p-breakpoint` from `tests/riscv-tests-allowlist.txt`; re-add `breakpoint`
  to the `riscv_tests_mi.rs` MI_SUBSET.
- Regression tests: execute-trigger fires on the matching PC; load/store triggers fire on the
  matching data address; a disabled trigger never fires; mode bits gate correctly.

## Acceptance criteria
- [ ] `rv64mi-p-breakpoint` passes end-to-end; allowlist entry removed; `breakpoint` back in
      the MI subset; the E1-T19 riscv-tests wall stays green with the smaller allowlist.
- [ ] The trigger raises `Breakpoint` at the correct priority relative to other synchronous
      exceptions (§3.7.1), byte-exact cause/tval vs Spike.
- [ ] A cleared/disabled trigger has zero effect on normal execution (no perf/behavior
      change when triggers are off); `cargo test --workspace` green.

## Adversarial verification
Attack false fires: with triggers disabled, an instruction at what WOULD be the trigger
address must execute normally (no spurious breakpoint). Attack match semantics: an
execute-trigger must fire on fetch, a load-trigger on the data address (not the PC), and the
tval must be the spec'd value. Attack priority: a triggered access that is ALSO misaligned/
page-faulting must resolve per §3.7.1. Attack WARL: writing an unsupported trigger type to
tdata1 must read back as disabled, not as the written value. Re-run the rv64mi suite from a
cold clone.

## Verification log
(empty)
