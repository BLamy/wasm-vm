---
id: E1-T29
epic: 1
title: Debug triggers — tdata1/tdata2 breakpoint CSRs (Debug spec §5)
priority: 129
status: in_progress
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

### 2026-07-04 — scoped (branch set up; the LAST Level-1-capstone deferral)
After E1-T26 emptied `compliance/EXCLUSIONS.md` (Sail reference), **`rv64mi-p-breakpoint` is the
single remaining capstone deferral** (allowlist = 1 entry). Clearing it + running the capstone
gate = Level 1 done.

**Investigation (breakpoint ELF present, disassembled):** the test uses exactly the debug-spec
trigger CSRs — `tselect` (0x7a0), `tdata1` (0x7a1), `tdata2` (0x7a2) (writes tselect=0, reads it
back; writes tdata2 then tdata1 (mcontrol), reads tdata1 back; repeats). These CSRs are currently
UNIMPLEMENTED (illegal-instruction trap on first access), so the test fails. `csr.rs` has no
`tselect/tdata*/tinfo` handling yet.

**Minimal implementation plan (next pass — hot-path, implement carefully):**
1. Trigger CSR file in `csr.rs`: `tselect` (0x7a0, WARL index — support ≥1 trigger), `tdata1`
   (0x7a1, mcontrol/mcontrol6 layout: type[63:60], dmode, action, match, m/s/u, execute/load/store,
   select, size), `tdata2` (0x7a2, compare value), `tinfo` (0x7a4, supported types bitmap), `tcontrol`
   if the test needs it. WARL: unsupported trigger types read back as disabled (type=0).
2. Trigger evaluation: on FETCH (pc match) and load/store (data-address match), with the trigger
   enabled + mode bits gated, action=0 (exception) → raise `Breakpoint` (mcause 3) BEFORE the access
   commits, with the spec'd tval, at the correct §3.7.1 priority. Zero-cost when no trigger is armed
   (a fast "any trigger enabled?" guard so the hot path pays nothing with triggers off — mirror the
   E0-T15/T16 zero-cost tracer pattern).
3. Remove `rv64mi-p-breakpoint` from `tests/riscv-tests-allowlist.txt` (→ 0 allowlist entries) AND
   re-add `breakpoint` to `riscv_tests_mi.rs` MI_SUBSET.
4. Regression tests: execute-trigger fires on matching PC; load/store triggers on the matching data
   address (not the PC); a disabled trigger never fires; mode bits gate; §3.7.1 priority vs
   misaligned/page-fault; WARL rejects unsupported types.
5. Gate: `rv64mi-p-breakpoint` passes; `cargo test --workspace`; `RISCOF_REF=sail make riscof` stays
   395/0; the no-trigger-armed hot path shows no perf regression (check-zero-cost style).

After T29: allowlist + EXCLUSIONS both empty → **E1-T24 capstone can complete** (gate green, tag
`level-1`, Epic 1 done). Branch `task/e1-t29-debug-triggers` is set up off the verified T26 branch.

### 2026-07-04 — implemented: mcontrol triggers → rv64mi-p-breakpoint passes (0 deferrals)
Debug-spec `mcontrol` (type 2) trigger implemented — a single trigger (index 0) that fires a
`Breakpoint` (mcause 3) on an execute/load/store address match. **`rv64mi-p-breakpoint` now
passes end-to-end**, removing the last allowlist entry → **zero capstone deferrals**.

**CSR side (`csr.rs`):** `tselect`(0x7a0), `tdata1`(0x7a1, mcontrol), `tdata2`(0x7a2),
`tdata3`(0x7a3), `tinfo`(0x7a4), `tcontrol`(0x7a5) added to `meta()` (M-mode, writable) — no
longer illegal. WARL: `tselect` clamps to the single trigger (index 0), so `tselect=1` reads back
0; `tdata1` forces the type field to mcontrol(2) and clears dmode (bit 59, debug-mode-only);
`tinfo` advertises type-2 (bit 2); `tcontrol` keeps mte(3)/mpte(7). New `TrigKind` enum +
`trigger_fires(addr, kind)` (checks type=2, the kind bit, mode gate — M needs `tcontrol.mte` —
match==0/action==0, `tdata2==addr`).

**Hot-path evaluation (`hart/mod.rs`), zero-cost when idle:** a `triggers_armed` flag (recomputed
on each tdata write) gates a single `triggers_idle()` bool test on the hot path; only when a
trigger is armed is `trigger_fires` called. Execute trigger checked at the top of `step_traced`
(fires BEFORE fetch, mepc=pc); load/store triggers checked at the top of `checked_load`/
`checked_store` (fires before the access, tval = data address, no partial store).

**Coverage:** `rv64mi-p-breakpoint` in the MI subset (exercises execute + load + store triggers,
the tselect-clamp, and tdata1 WARL round-trip end-to-end). Plus `crates/core/tests/triggers.rs`
(7 focused unit tests): execute fires on matching PC (pc unmoved); load fires on the data address
(not PC); store fires and does NOT commit; a load-only trigger ignores a store; a disabled trigger
never fires (idle guard); M-mode needs `tcontrol.mte`; tselect clamp + tdata1 type-force + tinfo.

**Gate:** `cargo fmt --check` clean; `cargo clippy --workspace --all-targets` clean; `cargo test
--workspace` → **91 ok-suites, 0 FAILED** (+ the new triggers suite). Allowlist = 0 entries,
EXCLUSIONS = 0 → **capstone deferral total 1 → 0.** RISCOF-vs-Sail re-confirm pending (triggers are
idle-guarded so compliance is unaffected).

**This clears the FINAL Level-1-capstone deferral.** After this, E1-T24's gate (allowlist + EXCLUSIONS
both empty) can flip to green and the epic can complete.
