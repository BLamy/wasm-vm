---
id: E3-T12b
epic: 3
title: CPU architectural snapshot and instruction-exact resume
priority: 321.92
status: verified
depends_on: [E3-T12a]
estimate: S
risk: high
capstone: false
---

## Goal
Snapshot and restore the hart's complete architectural execution state so continuation produces an
instruction-identical trace, including privilege, traps, counters, timers, and pending interrupts.

## Deliverables
- A versioned CPU section covering registers, PC, privilege, CSRs, reservations, counters, and
  architecturally relevant pending state.
- An all-or-nothing restore implementation with exhaustive field inventory.
- A native determinism target: run N, snapshot, run M, restore, rerun M, and byte-diff traces.

## Acceptance criteria
- [x] `make verify-E3-T12b` passes and the post-restore M-instruction trace is byte-identical,
  including timer-interrupt placement.
- [x] Dirty-target restore proves every architectural field is overwritten exactly once while
  malformed input leaves the target unchanged.
- [x] Native and wasm32 builds accept the same versioned CPU payload.

## Adversarial verification
Delete or reorder each serialized CPU field, snapshot immediately around trap/interrupt/LR-SC
boundaries, and restore into deliberately dirty state. Any mutant surviving the trace diff, partial
mutation on error, or host-width-dependent encoding refutes.

## Verification log

### 2026-08-02 — CPU snapshot section + instruction-exact resume → verified

**Implementation.** The CPU section (`resume::section::CPU`) now has a restorer: `impl
ComponentSnapshot for Hart` (crates/core/src/hart/mod.rs) serializes the COMPLETE hart state —
`pc`, `x1..=x31` (x0 hardwired 0), `f0..=f31`, the LR/SC reservation, and every CSR field via
`Csrs::snapshot_bytes`/`Csrs::parse` (mode, mstatus/mcause, fflags/frm, the tag-sorted WARL table,
mcycle/minstret + their per-step write flags, the `time` shadow, PMP cfg/addr, Sv48/Sv57, the PROBE
+ debug-trigger CSRs). Restore is **all-or-nothing**: `Csrs::parse` builds a fresh `Csrs` and `Hart`
parses everything into locals via a bounds-checked `resume::Reader`, committing to `self` only after
the whole payload parses and `finish()` confirms no trailing bytes. `Machine::save_resume`/
`load_resume` compose CPU + RAM + CLINT sections. `is_supported_section` now includes CPU.

**Two real completeness bugs found + fixed** (the timer-placement leg refuted the first attempts,
exactly as designed): (1) `Machine::tick_accum`, the sub-`clock_div` `mtime` remainder, was not
snapshotted → the next tick landed at a different retirement on resume; (2) `SbiState::stimecmp`, the
built-in-SBI S-timer deadline, was not snapshotted → a timer-armed guest resumed with the S-timer
cancelled. Both are now carried in a new **CLOCK section** (`tick_accum` + `clock_div` + `stimecmp`),
keeping component snapshots pure and `tick_accum` off the CLINT's hot-path RefCell.

**Verification — `make verify-E3-T12b`: OK** (fmt + scoped clippy + the tests below; native + wasm32):
- **AC1 (instruction-exact resume):** `resume_trace_matches_continuation` — for rv64ud-p-fmadd
  (f-regs/fcsr), rv64ua-p-lrsc (reservation), rv64mi-p-csr (WARL CSRs), rv64mi-p-zicntr (counters),
  at N ∈ {37,111,233,400}: run N, snapshot, run M=220 into a HashSink; restore the blob into a DIRTY
  machine (advanced to N+137) and rerun M — trace hash + retire count byte-identical. An omitted CPU
  field would reset to its `at_reset` default and diverge. Plus **timer placement**:
  `resume_places_the_timer_interrupt_identically` boots an S-timer-armed guest (CLINT + STIE/SIE),
  snapshots before the fire, and proves the resumed run delivers the interrupt at the identical
  instruction (hashes equal; non-vacuity asserted — the handler actually fired).
- **AC2:** `restore_over_dirty_state_is_byte_identical` (restore over arbitrary dirty state
  re-serializes byte-identically → every field overwritten once); `malformed_cpu_payload_is_rejected_
  and_leaves_hart_unchanged` (truncated / trailing-garbage / bad-Priv-discriminant / huge-WARL-count
  → typed `BadComponentState`, hart untouched).
- **AC3:** `crates/wasm/tests/resume.rs::cpu_section_round_trips_on_wasm32` round-trips the same
  fixed-LE CPU payload through save/load on real wasm32 (host-width-independent by construction).

All acceptance criteria met with recorded evidence → status **verified**.
