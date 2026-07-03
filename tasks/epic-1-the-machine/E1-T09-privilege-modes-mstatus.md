---
id: E1-T09
epic: 1
title: M/S/U privilege modes and the mstatus state machine
priority: 109
status: implemented
depends_on: [E1-T02]
estimate: L
capstone: false
---

## Goal
Three privilege modes with the complete mstatus/sstatus state machine: trap-entry and
xRET stack manipulation (MPP/SPP, MPIE/SPIE, MIE/SIE), the memory-behavior modifiers
(MPRV, SUM, MXR), the virtualization/trap knobs (TVM, TW, TSR), FS/SD tracking from T06,
and sstatus as a masked view of mstatus — the skeleton Linux and OpenSBI stand on.

## Context
Privileged spec §3.1.6 (mstatus), §3.3.2 (xRET), §4.1.1 (sstatus). The exact shuffles:
trap to M ⇒ MPIE←MIE, MIE←0, MPP←y (prior mode); MRET ⇒ MIE←MPIE, MPIE←1, mode←MPP,
MPP←U (lowest supported), and MPRV←0 if the new mode != M. Trap to S ⇒ SPIE←SIE, SIE←0,
SPP←(0 if from U, 1 if from S); SRET mirrors. MPP is WARL 2-bit (M/S/U — 0b10 must not
be storable); SPP is 1-bit. TSR=1 makes SRET in S-mode illegal; TW=1 makes WFI in S/U
trap (after a zero timeout for us); TVM=1 makes satp access and SFENCE.VMA in S-mode
illegal. sstatus exposes only SPP/SIE/SPIE/SUM/MXR/FS/SD (+UXL read-only 2); writes
through sstatus must not touch M-level bits. UXL/SXL are read-only 0b10 (64-bit).

## Deliverables
- `PrivMode` enum on the hart; mode changes *only* via trap entry and MRET/SRET.
- mstatus with per-field WARL legalization (MPP rejects 0b10 → document chosen legal
  value); SD (bit 63) computed read-only from FS (and future VS/XS).
- MRET/SRET execution incl. privilege checks (MRET below M illegal; SRET below S illegal;
  SRET in S with TSR=1 illegal); WFI privilege/TW checks (executes as NOP-until-interrupt
  placeholder until T11 wires wakeups).
- sstatus/sie/sip read/write masking as views over mstatus/mie/mip (single storage).
- Tests: full trap/return round-trips M→M, S→M, U→M, U→S(deleg placeholder), with
  before/after mstatus snapshots asserted bit-exactly.

## Acceptance criteria
- [ ] `csrw mstatus` attempting MPP=0b10 reads back a legal mode (documented; matches
      what Spike does with the same misa).
- [ ] MRET from M with MPP=U lands in U-mode with MIE restored from MPIE, MPIE=1, MPP=U,
      and MPRV cleared; subsequent CSR access to any M-CSR from U traps.
- [ ] SRET in S-mode with mstatus.TSR=1 raises illegal instruction (mcause=2).
- [ ] Writing sstatus with all-ones changes only SPP/SIE/SPIE/SUM/MXR/FS in mstatus.
- [ ] ECALL from U/S/M produces mcause 8/9/11 respectively (wired fully in T10 — here
      at minimum the mode plumbing delivers the right cause).
- [ ] All above identical native and wasm32.

## Adversarial verification
Diff the entire mstatus lifecycle against Spike: script a bare-metal binary that walks
M→U (mret), traps back via ecall, M→S, S→U, S-trap, sret, dumping mstatus/sstatus after
every transition to the signature region; byte-diff vs Spike. Attack WARL edges: write
every 2-bit MPP value, all-ones to mstatus, all-ones to sstatus, and diff readbacks vs
Spike. Attack TSR/TW/TVM one at a time from S and U modes (TW in U must trap WFI even
with TW=0? — no: check spec §3.1.6.5 carefully; WFI in U-mode legality depends on
implementation of S — verify our choice matches Spike and is documented). Attack MPRV:
set MPRV with MPP=U in M-mode, do a load — once T16 lands this must translate as U;
pre-MMU it must at least honor PMP (T15) — record the documented interim behavior and
refute if implementation contradicts documentation. Attempt to reach a privilege mode
by any path other than trap/xRET (e.g. CSR write) — success refutes.

## Verification log

### 2026-07-03 — worker (implementation claim)
The M/S/U privilege state machine on top of the T02 CSR file.
- **`crates/core/src/csr.rs`**: mstatus field bit consts (§3.1.6); `legalize_mstatus` (field-WARL:
  reserved MPP=0b10→U, UXL/SXL hardwired 0b10, SD read-only-computed from FS, WPRI bits 0) —
  applied on every mstatus write and by the state-machine transitions. Transition methods
  `trap_to_m`/`trap_to_s` (MPIE←MIE/SPIE←SIE, I-enable←0, xPP←prior) and `mret`/`sret`
  (I-enable←xPIE, xPIE←1, mode←xPP, xPP←U, MPRV←0 if returning below M). `sstatus` is a masked
  **view** of mstatus (SSTATUS_RMASK read / SSTATUS_WMASK write); `sie`/`sip` masked views of
  `mie`/`mip` (SSIE/STIE/SEIE). `tsr`/`tw`/`tvm` accessors. S-CSRs added (sstatus/sie/sscratch/
  sepc/scause/stval/sip; sepc masks bit 0 like mepc).
- **`crates/core/src/decode.rs`**: SRET (0x10200073) decoded (not-stub, like MRET); exhaustive
  tally +1 (325,400,582), reserved-SYSTEM negatives updated.
- **`crates/core/src/hart/mod.rs`**: MRET does the full mstatus restore + mode change (illegal
  below M); SRET added (illegal below S, or in S with TSR=1); WFI illegal below M when TW=1;
  ECALL cause is now mode-dependent (U→8/S→9/M→11, added `EcallFromS`). Mode changes ONLY via
  trap-entry / MRET / SRET.

Behavior change surfaced + fixed: with real MRET honoring MPP, the rv64u*-p p-env's `mret`
(MPP=U) now drops the test body to U-mode, so its exit ecall is EcallFromU — updated
`riscv_tests_f.rs`'s `run_one` to accept the exit from any mode (trap delivery lands in T10).

Evidence (local):
- `crates/core/tests/privilege.rs` (9): trap_to_m↔mret and trap_to_s↔sret field shuffles
  (bit-exact snapshots); MRET→U clears MPRV then M-CSR-from-U traps; MRET below M / SRET below S
  / SRET-in-S-with-TSR / WFI-with-TW illegal; ECALL cause per mode; sstatus-all-ones touches only
  S-bits (M bits untouched); mode never changes via a plain csrw. csr.rs WARL test extended
  (MPP=0b10→U, UXL/SXL=2, SD from FS).
- wasm32 `crates/wasm/tests/privilege.rs`: state machine identical to native.
- rv64ui/um/ua/uf/ud/uc all still pass; exhaustive 2^32 sweep passes (tally 325,400,582).
- Gate: fmt clean, clippy 0, workspace + both wasm builds 0 FAILED.

### 2026-07-03 — adversarial verifier (round 1) — VERDICT: refuted
The critic diffed a 19-value mstatus WARL battery, sstatus masking, the trap/xRET field
shuffles, and MRET/SRET against Spike (`--isa=rv64gc`, matching misa) — all matched. But it
found a real bug: **sie/sip masked views ignored `mideleg`.** Per Priv §4.1.3 the SSIE/STIE/
SEIE bits are read-only-zero when the interrupt is NOT delegated; Spike returns `sie=0x0`
(mideleg=0) where ours returned `0x222`, and a write through sie/sip leaked to mie/mip. Also a
COVERAGE gap: no committed test exercised the sie/sip CSR view at all.

### 2026-07-03 — rework
`csr.rs`: `sie`/`sip` read and write now gate on `s_int_mask() = SIE_SIP_SMASK & mideleg` —
undelegated S-interrupt bits are read-only zero and writes don't reach mie/mip (matching Spike
Case A: mideleg=0 → sie/mie read 0). Added `privilege.rs::sie_sip_are_mideleg_gated`
(mideleg=0 → sie/sip read-only 0 + no mie/mip leak; mideleg=SBITS → visible/writable; partial
delegation exposes only the delegated bit and leaves M-only mie bits untouched). Gate green;
all six riscv suites + exhaustive still pass. Re-verifying.

### 2026-07-03 — adversarial verifier (round 2) — VERDICT: refuted
The critic re-ran the sie/sip vs Spike matrix (oracle `spike --isa=rv64gc --log-commits`) over
mideleg ∈ {0, 0x222, 0x2, 0x20, 0x200, all-ones}. **sie now matches Spike in every case** — the
round-1 mideleg gate is genuinely fixed. But two of this task's own refute criteria still trip:
1. **sip writable mask wrong.** Per Priv §4.1.3 only **SSIP (bit 1)** is software-writable via
   the `sip` view; **STIP (bit 5) and SEIP (bit 9) are read-only in sip** (driven by the timer /
   external controller through `mip`). Ours reused the full delegated S-mask as the sip *write*
   mask, so `csrw sip,-1` with mideleg=0x222 gave `sip=0x222` where Spike gives `0x2` (only SSIP
   latches; Spike `mip` confirms STIP/SEIP never set). Confirmed for mideleg ∈ {0x222,0x20,0x200,
   all-ones}. (The critic correctly excluded Spike's CLINT-driven MTIP bit 7 — M-only, outside
   the sip S-view.)
2. **Mutation (a) survived.** Dropping `& s_int_mask()` from the sie *read* path left all 10
   committed tests passing — the read-side mideleg mask was untested (no test seeded an
   undelegated S-bit straight into mie via `csrw mie`, then read sie).

(The critic's initial finding #3 — web/* churn as scope creep — was retracted: those are Brett's
intentional hand edits, not part of this fix.)

### 2026-07-03 — rework (round 2)
`csr.rs`: split the sip **write** mask from the read mask. New `sip_write_mask() = SIP_SSIP &
mideleg` (SSIP-only, still delegation-gated) governs `sip` writes; STIP/SEIP are now read-only in
the sip view. The sip **read** path keeps `s_int_mask()` so delegated STIP/SEIP driven into `mip`
by M-mode remain *visible* through sip (readable, just not writable via sip). `sie` is unchanged
(STIE/SEIE are legitimately writable there). Extended `privilege.rs::sie_sip_are_mideleg_gated`
with: (1) a READ-gate case — seed all three S-enable bits into mie via `csrw mie` under
mideleg=SSI-only, assert `sie` reads back only SSIE (kills mutation a); (2) a sip-write case —
`csrw sip,-1` under mideleg=0x222 yields `sip=0x2`/`mip=0x2` (matches Spike), then M-mode drives
STIP+SEIP into mip and sip reads them back (read-visible but not sip-writable). Verified locally:
both the mutation-(a) revert (sie read unconditional) and the sip-write-mask revert (sip write =
s_int_mask) now FAIL the committed suite. Gate green; all six riscv suites + exhaustive pass.
Re-verifying.

### 2026-07-03 — adversarial verifier (round 3) — VERDICT: refuted (coverage only)
The critic re-ran the Spike differential (`spike --isa=rv64gc --log-commits`, Spike 1.1.1-dev)
over mideleg ∈ {0, 0x2, 0x20, 0x200, 0x222, all-ones} and confirmed **our sie/sip match Spike
EXACTLY in every case** — the round-2 sip write-mask fix is behaviorally correct, and both
STIP/SEIP directions verified (write via sip never latches them; delegated STIP/SEIP driven into
mip are read-visible through sip). The implementation code is correct. BUT the mutation battery
exposed a coverage hole: mutation **(d) — `sip` READ drops `& s_int_mask()` — SURVIVED** the
committed test. The test only ever seeded pending bits into mip when mideleg=0x222 (all
delegated), so it never exercised the sip read mask against an UNdelegated pending bit. The sie
read path had exactly this test; the symmetric sip case was missing. Grounded: Spike with
mideleg=0x2 and STIP+SEIP driven into mip reads `sip=0`, while the mutant returns raw mip bits.

### 2026-07-03 — rework (round 3, test-only)
Added the symmetric sip read-gate assertion to `privilege.rs::sie_sip_are_mideleg_gated`:
delegate SSIP only, M-mode drives the UNdelegated STIP+SEIP into mip, assert `sip` reads 0
(matches Spike). No production-code change — the code was already Spike-correct. Independently
confirmed the mutation (d) revert (`SIP => self.warl_get(MIP)`, gate dropped) now FAILs the
suite. Full mutation battery (a–e) now all CAUGHT. Gate green: fmt/clippy clean, workspace 0
FAILED. Re-verifying.
