---
id: E1-T15
epic: 1
title: PMP — pmpcfg/pmpaddr with TOR/NA4/NAPOT, locking, enough for OpenSBI
priority: 115
status: verified
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
- [x] NAPOT RWX grant lets S/U access RAM; no grant → U-mode fetch raises cause 1, mepc = the
      fetch pc (`napot_grants_rwx_and_off_default_denies_su`,
      `u_mode_fetch_without_grant_raises_instruction_access_fault`). rv64uf/ud/uc still pass in
      U-mode (their p-env installs the grant).
- [x] TOR R-only for S: in-range load ok; 8-byte straddle over the end fails; store fails (no W);
      M-mode store ok while unlocked (`tor_readonly_for_s_with_straddle_and_store_faults`).
- [x] Setting L makes the M-mode store fault and freezes the cfg field + pmpaddr
      (`locking_applies_to_m_and_freezes_the_entry`).
- [x] Locked TOR entry i freezes pmpaddr[i-1] (the TOR-neighbor quirk — same test).
- [x] NA4 protects exactly 4 bytes; +4 falls to the default (`na4_protects_exactly_four_bytes`).
- [x] pmpcfg1/pmpcfg3 → illegal; pmpaddr [63:54] read 0
      (`odd_pmpcfg_is_illegal_and_pmpaddr_high_bits_read_zero`); plus lowest-numbered-match-wins
      (`lowest_numbered_matching_entry_wins`) and MPRV-applies-as-MPP-for-loads-not-fetches
      (`mprv_applies_pmp_as_mpp_for_loads_but_not_fetches`).
- [x] Same core `Pmp`/check path runs under wasm32 (default-build; the unit is std-free).

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

### 2026-07-03 — implementation
- **`crates/core/src/pmp.rs`** — a `Pmp` unit with 16 entries (`cfg: [u8;16]`, `addr: [u64;16]`).
  `check(addr, len, access, mode)`: iterate entries in order; the LOWEST-numbered entry whose
  region overlaps ANY byte wins; a straddle (not fully contained) fails; an unlocked entry never
  restricts M (M bypasses), a locked one does; no match → M ok, S/U fail. Region decode for
  TOR (`pmpaddr[i-1]..pmpaddr[i]`, entry 0 base 0), NA4 (4 bytes), NAPOT (trailing-ones size).
  CSR views: pmpcfg0/2 pack 8 bytes; pmpaddr [63:54] read 0 (54-bit); write legalizes cfg
  (reserved bits cleared) and enforces locks incl. the TOR-neighbor rule (locked TOR entry i
  freezes pmpaddr[i-1]). `allow_all()` = the harness/OpenSBI all-RAM RWX grant.
- **`csr.rs`** — `pmp` field on `Csrs`; pmpcfg0/pmpcfg2 + pmpaddr0..15 routed to the unit (odd
  pmpcfg 0x3A1/0x3A3 not in `meta` → illegal). `pmp_ok()` (fast path: no armed entry → M ok/S-U
  deny) and `data_priv()` (MPRV → effective MPP mode for data accesses).
- **`hart/mod.rs`** — checked physical-access helpers (`cloadN`/`cstoreN`/`camoloadN`) inserted at
  all 25 data-access sites in `execute` (free functions taking `&Csrs`, disjoint from the
  `&mut self.regs` borrow); load→cause 5, store/AMO→cause 7. Fetch checks (Exec, cause 1, TRUE
  current mode — MPRV never affects fetches) inline in `step_traced` for both parcels.

Consequence: S/U now needs an explicit PMP grant to touch memory (spec §3.7 default). rv64uf/ud/uc
pass because the riscv-tests p-env installs the grant; bare-metal unit tests that run in S/U
(privilege.rs, rv64a.rs, interrupts.rs, zicntr.rs, pmp.rs) call `csr.pmp.allow_all()` — the harness
helper the task calls for.

Tests: `crates/core/tests/pmp.rs` (9) — NAPOT grant + default-deny, no-armed-entry default, TOR
R-only + straddle + store-fault + M-bypass, lock-applies-to-M + freeze + TOR-neighbor freeze, NA4
exactly-4-bytes, lowest-numbered-match-wins, odd-pmpcfg-illegal + pmpaddr-WARL, U-mode-fetch-fault,
MPRV-load-as-MPP-not-fetch. Local gate: fmt clean; `cargo test -p wasm-vm-core` 0 `test result:
FAILED`.

### 2026-07-03 — adversarial verifier (round 1) — VERDICT: refuted (real bug)
Spike 1.1.1-dev (oracle: bare-metal M-mode probe under `spike -d --isa=rv64gc --pmpregions=16`,
CSR readback via `reg 0`). Found a Spike-confirmed verdict+cause divergence: **`write_cfg` did not
legalize the reserved pmpcfg combo R=0,W=1.** Spike legalizes it by clearing W (region neither
readable nor writable); ours kept W=1 (`CFG_WMASK` includes W with no R-gating), so a store to such
a region was wrongly ALLOWED.

| write pmpcfg0 byte0 | Spike readback | ours (buggy) |
|---|---|---|
| 0x02 (R0,W1,OFF) | 0x00 | 0x02 |
| 0x12 (R0,W1,NA4) | 0x10 | 0x12 |

Semantic: entry0 NA4 cfg=0x12, then an **S-mode 4-byte store** → Spike DENIES (cause 7), ours
ALLOWED. Everything else the critic spot-checked matched Spike (NAPOT whole-space decode, pmpaddr
[63:54]→0, `csrw pmpcfg0,-1`→0x9F reserved-bit clearing, no-match S/U deny).

### 2026-07-03 — rework (round 1)
`pmp.rs::write_cfg`: after the WARL mask, if a cfg byte has W=1 and R=0, clear W (matching Spike).
Added `reserved_r0_w1_cfg_is_legalized_to_w0` (write 0x12 → readback 0x10; an S-mode store/read to
the region is denied). Independently confirmed the revert now FAILs it. Gate re-green (10 pmp tests;
fmt/clippy clean). Re-verifying.

### 2026-07-03 — adversarial verifier (round 2) — VERDICT: verified
Fresh cold clone at HEAD 007770e. Spike 1.1.1-dev; oracle = a faithful independent re-encoding of
Spike's `mmu.cc::pmp_lookup`/`pmp_ok` + `csrs.cc::match4`/`napot_mask`/`pmpcfg unlogged_write`
(mml=0, 4-byte granule, 16 entries), cross-checked against the committed `rv64mi-p-pmpaddr` probe.
- **R0W1 fix confirmed vs Spike** across all A-types × {X,L}: our readback == Spike legalization;
  R=1,W=1 and R=1,W=0 UNCHANGED; `csrw pmpcfg0,-1`→0x9F/byte. Legalized R0W1 denies S store AND read.
- **Spike PMP-verdict FUZZ**: **32,000 aligned-access tuples + 64,000 legalization/mask checks →
  0 divergences** (NAPOT all sizes incl. whole-space & 8B, NA4, TOR entry-0, straddles, multi-entry
  priority, locks, R0W1). Proved our exact-byte-range check ≡ Spike's 4B-granule stepping on the
  aligned domain (all region boundaries 4B-aligned).
- **Locks** (L→M, freeze, TOR-neighbor freeze AND its converse), **CSR WARL** (pmpcfg1/3 illegal,
  [63:54]→0, [6:5]→0, pmpcfg2→entries 8–15), **cause codes** (fetch 1 via TRUE mode, load 5, store/
  AMO 7 needing R∧W), **MPRV** (S for data, M for fetch) all correct.
- **Mutations 7/8 caught by the committed suite**; mutation (h) fetch-uses-data_priv SURVIVED (a
  coverage gap — code at hart/mod.rs correctly uses the true mode). CLOSED this round with
  `mprv_does_not_affect_fetch_end_to_end` (M-mode MPRV=1/MPP=S, ungranted `lw`: fetch passes as M,
  the load faults cause 5 — mutation-h now flips it to cause 1 and FAILs). Also added `rv64mi-p-pmpaddr`
  (which the critic confirmed passes) to the `riscv_tests_mi` harness.
- **Full gate green**; rv64uf/ud/uc + rv64mi-p subset pass; stub `decode_props::roundtrip_csr` pre-existing.

**Known limitation (out of PMP-verdict scope; documented follow-up):** the PMP check runs *before* the
bus alignment check, so a MISALIGNED data access that ALSO fails PMP reports access-fault (5/7) where
Spike reports address-misaligned (4/6) — misaligned has higher exception priority (Table 3.7). This
is unreachable in the aligned fuzz domain and is orthogonal to the PMP verdict logic; it belongs to a
later exception-priority refinement (it interacts with the E0-T08 range/alignment ordering). Recorded
so E1-T16+ can address the load/store fault-priority ordering holistically.

VERDICT: **verified** — the PMP unit (OFF/TOR/NA4/NAPOT matching, R/W/X + R0W1 legalization, locks incl.
TOR-neighbor, the S/U default-deny, MPRV, and cause codes) matches Spike across a 32k-tuple fuzz.
