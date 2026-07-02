---
id: E1-T15
epic: 1
title: PMP — pmpcfg/pmpaddr with TOR/NA4/NAPOT, locking, enough for OpenSBI
priority: 115
status: pending
depends_on: [E1-T10]
estimate: M
capstone: false
---

## Goal
16 physical memory protection entries — pmpcfg0/pmpcfg2 (RV64 packs 8 entries per even
csr) and pmpaddr0–15 — implementing OFF/TOR/NA4/NAPOT matching, R/W/X permission checks
for S/U (and for M when locked), and the L lock bit, sufficient for OpenSBI's firmware
self-protection and rv64mi PMP behavior.

## Context
Privileged spec §3.7. Matching: lowest-numbered matching entry wins, regardless of
priority of others; an access must be *entirely* within the matched region or it fails
(no partial-match fallthrough). TOR: pmpaddr[i-1] ≤ addr < pmpaddr[i] (entry 0 uses 0 as
base); NAPOT size from trailing-ones in pmpaddr; addresses are physical-address[55:2].
Default: if no entry matches, M-mode access succeeds; S/U access *fails* when at least
one PMP entry is implemented (we implement 16 ⇒ S/U need explicit grants — OpenSBI sets
this up, our bare-metal harness must too; provide a harness helper that opens an all-RAM
NAPOT entry for tests). L=1: rules apply to M too, and pmpcfg[i]/pmpaddr[i] writes are
ignored until reset; TOR quirk — locking entry i also locks writes to pmpaddr[i-1].
Violations raise access faults (causes 1/5/7), not page faults. PMP checks also apply to
the T16 page-table walker's own accesses (plumb the hook now).

## Deliverables
- `pmp.rs`: entry array, cfg/addr CSR handlers registered in the T02 table (odd pmpcfg
  CSRs nonexistent in RV64 → illegal instruction), match/permission function called by
  every physical access (fetch/load/store/AMO/PTW), with a fast path when zero entries
  are armed.
- Lock semantics incl. the TOR-neighbor rule; WARL legalization of the A field.
- Reset: A=OFF, L=0 for all entries (per spec recommendation, matches T01).
- Tests: each mode × each A-type × each permission bit; boundary addresses (first/last
  byte of region); an 8-byte access straddling a region end.

## Acceptance criteria
- [ ] With one NAPOT entry granting RWX over RAM to S/U, all rv64ui tests still pass in
      U-mode; removing the entry makes the first U-mode fetch raise cause 1 with mepc =
      the fetch pc.
- [ ] TOR entry [0x8000_0000, 0x8000_1000) R-only for S: S-mode load at 0x8000_0FF8
      succeeds; 8-byte load at 0x8000_0FFC raises cause 5 (straddle); store anywhere in
      range raises cause 7; M-mode store succeeds (unlocked).
- [ ] Setting L on that entry makes the same M-mode store fault, and subsequent writes to
      its pmpcfg field and pmpaddr read back unchanged.
- [ ] Locked TOR entry i blocks writes to pmpaddr[i-1] (readback unchanged).
- [ ] NA4 entry protects exactly 4 bytes: access at +4 is governed by other entries/default.
- [ ] pmpcfg1/pmpcfg3 access raises illegal instruction; pmpaddr write bits [63:54]
      read back zero (WARL).
- [ ] All of the above identical native and wasm32.

## Adversarial verification
Run OpenSBI's own PMP setup sequence (extracted as a bare-metal snippet) and diff
resulting pmpcfg/pmpaddr readbacks against Spike. Attack entry priority: overlapping
entries where entry 0 denies and entry 1 permits (must deny), then swapped (must permit).
Attack the straddle rule with every access width (1/2/4/8) crossing every region edge
alignment. Attack lock ordering: lock entry 1 (TOR), then try to widen the region by
moving pmpaddr0 — a successful move refutes. Attack the "no match ⇒ S/U fail" default by
disarming all entries and attempting an S-mode load — success refutes. Verify MPRV=1 with
MPP=S in M-mode applies PMP as S (fault) while fetches remain M (no fault). Fuzz 10k
random {entry configs, access(addr,width,type,mode)} tuples against Spike's PMP verdicts;
any verdict or cause-code divergence refutes.

## Verification log
(empty)
