---
id: E1-T14
epic: 1
title: Zicntr counters — cycle/instret/time and mcounteren/scounteren delegation
priority: 114
status: implemented
depends_on: [E1-T09, E1-T12]
estimate: S
capstone: false
---

## Goal
The unprivileged Zicntr counters — cycle (0xC00), time (0xC01), instret (0xC02) — exposed
read-only with the M-mode backing registers mcycle/minstret (0xB00/0xB02) writable, and
access from S/U gated by mcounteren/scounteren exactly per spec, so `rdtime`-based delays
in OpenSBI/Linux and vDSO clock reads behave.

## Context
Unprivileged spec "Zicntr" chapter; privileged spec §3.1.10 (mcounteren), §4.1.5
(scounteren). RV64: no *h high-half CSRs. Gating rule: an S-mode read of cycle/time/
instret traps illegal-instruction unless the corresponding mcounteren bit (CY=0, TM=1,
IR=2) is set; a U-mode read requires the bit set in *both* mcounteren and scounteren.
time is a read-only window onto CLINT mtime (T12) — there is no mtime CSR; M-mode reads
of time also work (mcounteren does not gate M). cycle/instret tick from the retire loop;
since the interpreter is one-instruction-per-step, cycle may equal instret — document
this (legal; no IPC claims). Writes to 0xC00–0xC02 are always illegal (read-only user
counters, T02 already enforces the address-encoding rule).

## Deliverables
- mcycle/minstret as writable 64-bit M-CSRs incremented per retire (increment order
  documented: CSR reads observe the count *before* the reading instruction retires,
  matching Spike).
- cycle/instret as read-only shadows; time reading CLINT mtime through the bus.
- mcounteren/scounteren with WARL masks exposing only CY/TM/IR bits (upper HPM bits
  read-only zero until hardware performance monitors exist).
- Trap tests for all {mode ∈ S,U} × {counter} × {mcounteren, scounteren} combinations
  (12 gate states asserted).

## Acceptance criteria
- [x] `rdinstret` back-to-back differs by 1; K retired instructions increment minstret by exactly
      K (`rdinstret_back_to_back_differs_by_one`, `minstret_increments_exactly_once_per_retired_instruction`).
- [x] Writing minstret from M takes effect and instret shadows it; mcycle→cycle likewise
      (`writing_minstret_takes_effect_and_instret_shadows_it`).
- [x] S-mode `rdtime` with mcounteren.TM=0 → illegal (mcause 2, mtval = rdtime encoding); with TM=1
      returns CLINT mtime (`rdtime_from_s_traps_when_tm_clear_and_returns_mtime_when_set`).
- [x] U-mode gate needs BOTH mcounteren and scounteren; full 12-state matrix asserted
      (`counter_gating_matrix_matches_spec`); hpmcounter always traps from S/U
      (`hpmcounter_always_traps_from_below_m`).
- [x] mcounteren/scounteren all-ones → reads back bits [2:0] (`counteren_warl_exposes_only_cy_tm_ir`).
- [x] time is a live window onto CLINT mtime (`time_tracks_clint_mtime_as_a_live_window`); minstret
      wraps unsigned (`minstret_wraps_around_unsigned`).
- Also: `rv64mi-p-zicntr` (Spike's golden Zicntr vectors) now PASSES and is added to the
  `riscv_tests_mi` harness.

## Adversarial verification
Diff every gate combination against Spike with identical misa and counteren settings —
Spike is authoritative on which accesses trap; a single mismatched trap/no-trap cell in
the 12-state matrix refutes. Attack the shadow relationship: write mcycle to u64::MAX-2,
retire a few instructions, and check wraparound in both mcycle and cycle; write mtime via
the CLINT and confirm time follows instantly (no cached copy). Attack increment
positioning: `csrr x1, minstret; csrr x2, minstret` — x2-x1 must match Spike exactly (off-
by-one in retire-count placement is the classic divergence, and RISCOF's counter tests
will catch it later — catch it now). Attack WARL: attempt to set HPM enable bits 3..31
and verify read-back zero, then confirm the corresponding hpmcounter CSR reads still trap
from S/U regardless. Native vs wasm32: identical counter values at every checkpoint of a
10k-instruction deterministic run.

## Verification log

### 2026-07-03 — implementation
- **`csr.rs`** — `mcycle` (0xB00) / `minstret` (0xB02) as writable 64-bit M-CSR fields; `cycle`
  (0xC00) / `instret` (0xC02) as read-only shadows of them; `time` (0xC01) as a shadow of the
  CLINT mtime. `retire_tick()` (called from `hart::step` AFTER `execute` returns Ok) bumps
  mcycle+minstret once per retired instruction — so a `csrr` reading them observes the pre-retire
  count (matches Spike). One-instruction-per-step means mcycle == minstret (documented; no IPC
  claim). `mcounteren` (0x306) / `scounteren` (0x106) are WARL, mask `0b111` (CY/TM/IR only; HPM
  enable bits read-only 0).
- **Counter gating** in `access()` (after the min_priv check): an S/U read of cycle/time/instret/
  hpmcounter is illegal unless the matching mcounteren bit is set; U additionally needs the
  scounteren bit; M is never gated. Because HPM bits 3..31 of counteren are read-only 0,
  hpmcounter3..31 always trap from S/U.
- **`time` window** — `Machine::sync_clint` calls `csr.set_time(mtime)` each instruction boundary,
  so `rdtime` tracks the CLINT deterministic clock. (There is no `mtime` CSR; `time` is the window.)

Tests: `crates/core/tests/zicntr.rs` (9) — per-retire increment (exact K), rdinstret-delta-1,
minstret-writable + shadows, unsigned wrap, counteren WARL (→0b111), the full 12-state gate matrix
(S/U × CY/TM/IR × mcounteren/scounteren), hpmcounter-always-traps, rdtime-S-gate + returns-mtime,
and time-as-a-live-window. Plus `rv64mi-p-zicntr` (Spike's golden vectors) now PASSES — added to
the `riscv_tests_mi` harness (which enables the CLINT for the `time` counter; inert for the other
mi tests since mtimecmp resets to u64::MAX). `instret_overflow` stays excluded (needs the Sscofpmf
counter-overflow LCOFI, a separate extension). Local gate green: fmt clean; clippy 0 (real +
zicsr-stub, all-targets); `cargo test --workspace` 0 `test result: FAILED`; both wasm builds 0
FAILED. Awaiting adversarial verification (incl. the Spike gate-matrix + increment-position diff).

### 2026-07-03 — adversarial verifier (round 1) — VERDICT: refuted (real bug)
Spike 1.1.1-dev (`spike --isa=rv64gc_zicntr`, commit-log diff). The **increment position** — "the
classic divergence" — was wrong: a guest `csrw mcycle`/`csrw minstret` read back **written+1**
because `retire_tick()` unconditionally incremented the counter the writing instruction had just
written. Spike suppresses that instruction's own increment (the written value stands):

| sequence | Spike | ours (buggy) |
|---|---|---|
| `csrw minstret,100; csrr a0,minstret` | 100 | 101 |
| `csrw mcycle,500; csrr a0,mcycle` | 500 | 501 |
| `csrw minstret,0; nop; csrr a0,minstret` | 1 | 2 |

Everything else the critic checked was clean: the 12-state gate matrix matched Spike cell-for-cell
(both returned 0b101011010), the delta forms (`csrr;csrr`→1, `mcycle` over 5 nops→6) matched,
rv64mi-p-zicntr passed with the other mi tests unperturbed, shadow/wrap/counteren-WARL/hpm all
correct, and all 7 charter mutations were caught. The coverage gap: every committed write went
through the `set_csr` HELPER (a direct `Csrs::access`), never a guest `csrw` through `hart::step`/
`retire_tick`, so the writing-instruction's own increment was never exercised.

### 2026-07-03 — rework (round 1)
Suppress the writing instruction's own increment for the counter it wrote. Added per-step flags
`wrote_mcycle`/`wrote_minstret` (Csrs): set in `write_raw` for MCYCLE/MINSTRET, ARMED (cleared) at
each step start via `arm_counters()` (called at the top of `hart::step_traced` — so a stale flag
from a host-side/direct write can't leak into a run), and consumed in `retire_tick` (skip the
written counter). Added `guest_csrw_counter_does_not_count_its_own_retirement` (csrrw minstret,x5
then csrr → 100, not 101; csrw mcycle,500 stands at 500) — independently confirmed the revert
(unconditional retire_tick) now FAILs it. Gate re-green (10 zicntr tests; fmt/clippy clean; mi +
snapshot pass).
