---
id: E1-T27
epic: 1
title: 64-region PMP — pmpaddr0..63 / pmpcfg0..14 (Priv §3.7)
priority: 127
status: pending
depends_on: [E1-T15]
estimate: M
capstone: false
---

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
(empty)
