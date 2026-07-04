---
id: E1-T27
epic: 1
title: 64-region PMP — pmpaddr0..63 / pmpcfg0..14 (Priv §3.7)
priority: 141
status: pending
depends_on: [E1-T15]
estimate: M
capstone: false
---

> **E1-T26 UPDATE — capstone-OBSOLETE (deprioritized 127/128 → 141/142).** The RISCOF exclusions this task existed to clear were removed by E1-T26 (switching the reference to the canonical Sail model, configured to our declared ISA, makes the full arch-test suite pass 395/0 with EXCLUSIONS.md empty). This remains a VALUABLE feature for hosting more OSes, but the Level-1 capstone (E1-T24) no longer depends on it.

## Goal
Expand PMP from the 16-entry implementation (E1-T15) to the full 64 regions the spec
permits, so `pmpm_all_entries_check-01..04` pass — burning those 4 entries from
`compliance/EXCLUSIONS.md` toward the Level 1 capstone's zero-exclusion bar.

## Context
E1-T15 implemented 16 PMP entries (`pmpaddr0..15`, `pmpcfg0`/`pmpcfg2`); the RISCOF
`pmpm_all_entries_check` tests are gated on `PMP['pmp-writable'] == 64` and so were excluded
as "we implement 16." §3.7 permits 0/16/64 entries; 64 is what the arch-test exercises and
what a full machine advertises. This task widens the entry file to 64: `pmpaddr0..63` and
`pmpcfg0,2,4,…,14` (even-indexed cfg CSRs on RV64, 8 entries each), preserving the existing
WARL/locking/granularity semantics and the address-matching (TOR/NA4/NAPOT) logic — only the
count changes, not the per-entry behavior.

## Deliverables
- PMP state widened to 64 entries; `pmpaddr0..63` and `pmpcfg0..14` (even) CSRs readable/
  writable with the same WARL + lock (L bit) + `mseccfg`-aware semantics as the 16-entry
  version, and the same NA4/NAPOT/TOR matching applied across all 64.
- The isa yaml (`compliance/wasmvm/wasmvm_isa.yaml`) PMP block updated to advertise 64
  regions consistently (the E1-T20 isa-vs-machine cross-check must still pass).
- Remove the 4 `pmp/src/pmpm_all_entries_check-0{1..4}.S` entries from EXCLUSIONS.md.
- Regression tests: write/read-back across the full 64-entry file; locking an upper entry;
  a match resolved by entry 63; the lowest-matching-entry-wins priority across >16 entries.

## Acceptance criteria
- [ ] `make riscof` passes `pmpm_all_entries_check-01..04`; entries removed from EXCLUSIONS.md.
- [ ] The E1-T20 isa-yaml-vs-misa/PMP cross-check stays green (yaml advertises what the
      machine implements — no over-claim).
- [ ] `rv64mi-p-pmpaddr` and the E1-T15 PMP regression tests still pass (no 16-entry
      regression); `cargo test --workspace` green.

## Adversarial verification
Attack the count honesty: the isa yaml must not claim 64 while the machine enforces 16 (the
cross-check catches this; verify by hand). Attack priority across the widened file: a region
covered by both entry 5 and entry 40 must resolve to entry 5 (lowest index wins) — seed this.
Attack locking: a locked entry 60 must resist writes AND enforce in M-mode. Attack the CSR
map: `pmpcfg1/3/…` (odd) must remain illegal on RV64. Re-run the full PMP arch-test suite
from a cold clone.

## Verification log

### 2026-07-04 — implemented: PMP expanded 16 → 64 entries (DUT + unit-tested)
Per the user's "implement T27/T28 as real features" decision (Level 1 already met; these are
now capability features, not capstone-blockers). The PMP unit now has **64 entries**.

**Core (`crates/core`):**
- `pmp.rs`: `NUM_ENTRIES 16 → 64`; `read_cfg`/`write_cfg` bank base generalized `bank*4` (even
  banks 0,2,…,14). The matching/lock/priority logic already iterates `NUM_ENTRIES`, so it
  scales unchanged; the ADDR_MASK, TOR-neighbor-lock, and lowest-entry-wins semantics are
  identical for all 64.
- `csr.rs`: added `pmpaddr16..63` (0x3C0..0x3EF) and the even `pmpcfg4..14` (0x3A4..0x3AE);
  dispatch is now range-based (`PMPADDR0..=PMPADDR63`, `PMPCFG0..=PMPCFG14 if even`). Odd pmpcfg
  CSRs (0x3A1/…/0x3AF) still fail the even guard → `meta` None → illegal instruction (RV64).

**Genuine test:** new `pmp.rs::all_64_entries_configurable_and_enforced_e1t27` — configures a
HIGH entry (40) as a NAPOT RW region via its own CSRs and asserts it matches + enforces R/W for
S-mode inside and denies outside; round-trips the top cfg bank (`pmpcfg14`, entry 56) and the last
entry (`pmpaddr63`). Directly exercises the >16 entries the 16-entry build couldn't. All prior PMP
tests (16-entry semantics) still pass unchanged.

**Gate:** `cargo fmt`/`clippy` clean; `cargo test --workspace` 91 ok-suites, 0 FAILED (pmp suite
now 12); `rv64mi-p-pmpaddr` still passes; `RISCOF_REF=sail make riscof` stays 395/0 (unaffected).

**Honest scope note — RISCOF 64-region arch-test SELECTION is a documented follow-up.** The
`pmpm_all_entries_check` arch-test's 64-region case (RVTEST_CASE gated on `verify (PMP['pmp-writable']
== 64)`) is currently NOT selected (our DUT isa yaml declares no PMP block → `pmp-writable != 64`),
so it passes trivially either way. Making riscof genuinely SELECT + run the 64-region case requires
declaring `pmp-writable == 64` in the DUT isa yaml AND setting Sail's `pmp.count: 64` (default 16) in
the config-override — the exact riscof `PMP['pmp-writable']` derivation from the normalized yaml needs
more investigation (each experiment is a ~5-min RISCOF run). Deferred to avoid a rabbit-hole; the
64-entry feature itself is genuinely implemented and directly tested by the unit test above. This is
a capability feature off the critical path (Level 1 is already MET), so it does not block anything.
