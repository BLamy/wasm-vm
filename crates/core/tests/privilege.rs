//! E1-T09: the M/S/U privilege modes and the mstatus/sstatus state machine — trap-entry and
//! xRET field shuffles, WARL legalization, sstatus/sie masked views, and the privilege
//! checks on MRET/SRET/WFI. (Trap DELIVERY — the mtvec jump — lands in E1-T10; here the
//! transitions are driven directly + via the executed xRET instructions.)
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, Csrs, MEPC, MSTATUS, Priv, SATP, SEPC, SSTATUS};
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

/// Test-only CSR write that goes through full legalization but bypasses the privilege check
/// (temporarily elevates to M), so setup/inspection works regardless of the mode under test.
fn wr(c: &mut Csrs, addr: u16, v: u64) {
    let save = c.mode;
    c.mode = Priv::M;
    c.access(addr, CsrOp::Write, v, false, false, 0).unwrap();
    c.mode = save;
}
fn rd(c: &mut Csrs, addr: u16) -> u64 {
    let save = c.mode;
    c.mode = Priv::M;
    let v = c.access(addr, CsrOp::Set, 0, true, false, 0).unwrap();
    c.mode = save;
    v
}
fn machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    // E1-T15: these tests exercise xRET/ecall/WFI in S/U mode; grant all-RAM PMP so the
    // instruction FETCH isn't denied before the privilege logic under test runs.
    hart.csr.pmp.allow_all();
    (hart, SystemBus::new(Ram::new(64 * 1024).unwrap()))
}
/// `csrrs rd, csr, x0` — a pure CSR read (used to probe privilege-checked access).
fn csrr(rd: u8, csr: u16) -> u32 {
    ((csr as u32) << 20) | (0b010 << 12) | ((rd as u32) << 7) | 0b1110011
}

const MIE: u64 = 1 << 3;
const MPIE: u64 = 1 << 7;
const SIE: u64 = 1 << 1;
const SPIE: u64 = 1 << 5;
const SPP: u64 = 1 << 8;

// ── the mstatus stack: trap-entry ↔ xRET round-trips ────────────────────────────

#[test]
fn trap_to_m_and_mret_field_shuffle() {
    let mut c = Csrs::at_reset(); // M, mstatus=0
    wr(&mut c, MSTATUS, MIE); // MIE=1
    // Trap from U-mode: MPIE←MIE(1), MIE←0, MPP←U.
    c.trap_to_m(Priv::U);
    assert_eq!(c.mode, Priv::M);
    let m = rd(&mut c, MSTATUS);
    assert_eq!(m & MIE, 0, "MIE cleared on trap");
    assert_eq!(m & MPIE, MPIE, "MPIE = old MIE");
    assert_eq!((m >> 11) & 0b11, 0, "MPP = U (prior mode)");
    // MRET: MIE←MPIE(1), MPIE←1, mode←MPP(U), MPP←U.
    c.mret();
    assert_eq!(c.mode, Priv::U, "mret returns to MPP");
    let m = rd(&mut c, MSTATUS);
    assert_eq!(m & MIE, MIE, "MIE restored from MPIE");
    assert_eq!(m & MPIE, MPIE, "MPIE = 1");
    assert_eq!((m >> 11) & 0b11, 0, "MPP = U (lowest supported)");
}

#[test]
fn trap_to_s_and_sret_field_shuffle() {
    let mut c = Csrs::at_reset();
    c.mode = Priv::S;
    wr(&mut c, MSTATUS, SIE); // SIE=1
    // Trap from S: SPIE←SIE(1), SIE←0, SPP←1 (from S).
    c.trap_to_s(Priv::S);
    assert_eq!(c.mode, Priv::S);
    let m = rd(&mut c, MSTATUS);
    assert_eq!(m & SIE, 0, "SIE cleared");
    assert_eq!(m & SPIE, SPIE, "SPIE = old SIE");
    assert_eq!(m & SPP, SPP, "SPP = 1 (trap from S)");
    // SRET: SIE←SPIE(1), SPIE←1, mode←SPP(S), SPP←U(0).
    c.sret();
    assert_eq!(c.mode, Priv::S);
    let m = rd(&mut c, MSTATUS);
    assert_eq!(m & SIE, SIE, "SIE restored");
    assert_eq!(m & SPP, 0, "SPP = U after sret");
    // A trap from U sets SPP=0.
    c.mode = Priv::U;
    c.trap_to_s(Priv::U);
    assert_eq!(rd(&mut c, MSTATUS) & SPP, 0, "SPP = 0 (trap from U)");
}

#[test]
fn mret_to_u_clears_mprv_then_mcsr_from_u_traps() {
    // Acceptance: MRET from M with MPP=U lands in U with MIE←MPIE, MPIE=1, MPP=U, MPRV cleared;
    // a subsequent M-CSR access from U traps illegal.
    let (mut hart, mut bus) = machine();
    wr(&mut hart.csr, MEPC, DRAM_BASE + 0x100);
    wr(&mut hart.csr, MSTATUS, MPIE | (1 << 17)); // MPIE=1, MPP=U(0), MPRV=1
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x3020_0073).unwrap(); // mret
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.csr.mode, Priv::U, "mret dropped to U");
    assert_eq!(hart.regs.pc, DRAM_BASE + 0x100);
    let m = rd(&mut hart.csr, MSTATUS);
    assert_eq!(m & MIE, MIE, "MIE restored from MPIE");
    assert_eq!(m & (1 << 17), 0, "MPRV cleared (returned below M)");
    // csrr x1, mstatus from U-mode → illegal (M-CSR above privilege).
    hart.regs.pc = DRAM_BASE + 0x100;
    bus.store32(DRAM_BASE + 0x100, csrr(1, MSTATUS)).unwrap();
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::IllegalInstruction, "M-CSR from U traps");
}

// ── privilege checks on the xRET / WFI instructions ─────────────────────────────

#[test]
fn mret_below_m_is_illegal() {
    let (mut hart, mut bus) = machine();
    hart.csr.mode = Priv::S;
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x3020_0073).unwrap(); // mret
    assert_eq!(
        hart.step(&mut bus).unwrap_err().cause,
        Exception::IllegalInstruction,
        "MRET below M is illegal"
    );
}

#[test]
fn sret_privilege_and_tsr() {
    // SRET from U → illegal.
    let (mut hart, mut bus) = machine();
    hart.csr.mode = Priv::U;
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x1020_0073).unwrap(); // sret
    assert_eq!(
        hart.step(&mut bus).unwrap_err().cause,
        Exception::IllegalInstruction,
        "SRET from U illegal"
    );
    // SRET in S with mstatus.TSR=1 → illegal.
    let (mut hart, mut bus) = machine();
    hart.csr.mode = Priv::S;
    wr(&mut hart.csr, MSTATUS, 1 << 22); // TSR=1
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x1020_0073).unwrap();
    assert_eq!(
        hart.step(&mut bus).unwrap_err().cause,
        Exception::IllegalInstruction,
        "SRET in S with TSR=1 illegal (mcause=2)"
    );
    // SRET in S with TSR=0 executes (lands at sepc).
    let (mut hart, mut bus) = machine();
    hart.csr.mode = Priv::S;
    wr(&mut hart.csr, SEPC, DRAM_BASE + 0x40);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x1020_0073).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, DRAM_BASE + 0x40, "SRET lands at sepc");
}

#[test]
fn wfi_traps_when_tw_set_below_m() {
    let (mut hart, mut bus) = machine();
    hart.csr.mode = Priv::S;
    wr(&mut hart.csr, MSTATUS, 1 << 21); // TW=1
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x1050_0073).unwrap(); // wfi
    assert_eq!(
        hart.step(&mut bus).unwrap_err().cause,
        Exception::IllegalInstruction,
        "WFI in S with TW=1 illegal"
    );
    // In M-mode, WFI always retires (TW doesn't apply to M).
    let (mut hart, mut bus) = machine();
    wr(&mut hart.csr, MSTATUS, 1 << 21);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x1050_0073).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, DRAM_BASE + 4, "WFI in M retires");
}

// ── ECALL cause per mode ────────────────────────────────────────────────────────

#[test]
fn ecall_cause_depends_on_mode() {
    for (mode, cause) in [
        (Priv::U, Exception::EcallFromU),
        (Priv::S, Exception::EcallFromS),
        (Priv::M, Exception::EcallFromM),
    ] {
        let (mut hart, mut bus) = machine();
        hart.csr.mode = mode;
        hart.regs.pc = DRAM_BASE;
        bus.store32(DRAM_BASE, 0x0000_0073).unwrap(); // ecall
        assert_eq!(hart.step(&mut bus).unwrap_err().cause, cause, "{mode:?}");
    }
}

// ── sstatus / sie masked views ──────────────────────────────────────────────────

#[test]
fn sstatus_write_touches_only_s_bits() {
    // Writing all-ones through sstatus must change only SPP/SIE/SPIE/SUM/MXR/FS in mstatus —
    // never M-level bits (MIE/MPIE/MPP/MPRV/TVM/TW/TSR).
    let mut c = Csrs::at_reset();
    wr(&mut c, SSTATUS, u64::MAX);
    let m = rd(&mut c, MSTATUS);
    assert_eq!(m & MIE, 0, "MIE (M-only) untouched");
    assert_eq!(m & MPIE, 0, "MPIE (M-only) untouched");
    assert_eq!((m >> 11) & 0b11, 0, "MPP untouched");
    assert_eq!(m & (1 << 22), 0, "TSR untouched");
    assert_eq!(m & SIE, SIE, "SIE set via sstatus");
    assert_eq!(m & SPP, SPP, "SPP set via sstatus");
    assert_eq!((m >> 13) & 0b11, 0b11, "FS set via sstatus");
    // sstatus read exposes only the S-subset (no MPP/MIE bits leak).
    let s = rd(&mut c, SSTATUS);
    assert_eq!(s & MIE, 0);
    assert_eq!((s >> 11) & 0b11, 0, "sstatus read hides MPP");
    assert_eq!(s & SIE, SIE);
}

// ── sie/sip are gated on mideleg (Priv §4.1.3) ──────────────────────────────────

#[test]
fn sie_sip_are_mideleg_gated() {
    // CSR addresses (kept local so they don't clash with the bit-mask consts above).
    const A_MIDELEG: u16 = 0x303;
    const A_MIE: u16 = 0x304;
    const A_MIP: u16 = 0x344;
    const A_SIE: u16 = 0x104;
    const A_SIP: u16 = 0x144;
    const SBITS: u64 = (1 << 1) | (1 << 5) | (1 << 9); // SSIE/STIE/SEIE

    // mideleg = 0: NO S-interrupt is delegated → sie/sip are read-only zero and a write
    // through them does not reach mie/mip.
    let mut c = Csrs::at_reset();
    wr(&mut c, A_MIDELEG, 0);
    wr(&mut c, A_SIE, u64::MAX);
    assert_eq!(rd(&mut c, A_SIE), 0, "sie read-only zero when mideleg=0");
    assert_eq!(
        rd(&mut c, A_MIE),
        0,
        "sie write did not reach mie (undelegated)"
    );
    wr(&mut c, A_SIP, u64::MAX);
    assert_eq!(rd(&mut c, A_SIP), 0, "sip read-only zero when mideleg=0");
    assert_eq!(rd(&mut c, A_MIP), 0, "sip write did not reach mip");

    // Delegate all S-interrupts: now sie/sip expose and mask those bits, and a write lands
    // in mie/mip.
    let mut c = Csrs::at_reset();
    wr(&mut c, A_MIDELEG, SBITS);
    wr(&mut c, A_SIE, u64::MAX);
    assert_eq!(
        rd(&mut c, A_SIE),
        SBITS,
        "delegated S-interrupt enables visible"
    );
    assert_eq!(
        rd(&mut c, A_MIE),
        SBITS,
        "sie write reached mie for delegated bits"
    );
    // Only the delegated bits move: an M-only interrupt bit in mie is untouched via sie.
    let mut c = Csrs::at_reset();
    wr(&mut c, A_MIDELEG, 1 << 1); // delegate only SSI
    wr(&mut c, A_MIE, 1 << 3); // MTIE (M-only) preset in mie
    wr(&mut c, A_SIE, u64::MAX);
    assert_eq!(
        rd(&mut c, A_MIE) & (1 << 3),
        1 << 3,
        "sie write left MTIE untouched"
    );
    assert_eq!(
        rd(&mut c, A_SIE),
        1 << 1,
        "only the delegated SSI is visible"
    );

    // READ-side gate (kills the mutation where `sie` read drops `& s_int_mask()`): seed an
    // UNdelegated S-interrupt-enable bit straight into mie via `csrw mie`, then read sie — it
    // must read zero because that bit is not delegated, even though it is present in mie.
    let mut c = Csrs::at_reset();
    wr(&mut c, A_MIDELEG, 1 << 1); // delegate SSI only
    wr(&mut c, A_MIE, SBITS); // but seed ALL three S-enable bits into mie directly
    assert_eq!(
        rd(&mut c, A_SIE),
        1 << 1,
        "sie READ masks undelegated STIE/SEIE to zero (mideleg-gated read)"
    );

    // sip WRITE mask is SSIP-only (Priv §4.1.3): STIP/SEIP are read-only in the sip view.
    // Match Spike — mideleg=0x222, `csrw sip,-1` sets only SSIP, so sip reads 0x2 (not 0x222).
    let mut c = Csrs::at_reset();
    wr(&mut c, A_MIDELEG, SBITS); // delegate all three
    wr(&mut c, A_SIP, u64::MAX); // try to set SSIP+STIP+SEIP through sip
    assert_eq!(
        rd(&mut c, A_SIP),
        1 << 1,
        "sip write sets only SSIP; STIP/SEIP are read-only in the sip view"
    );
    assert_eq!(
        rd(&mut c, A_MIP),
        1 << 1,
        "the sip write reached mip only for SSIP"
    );
    // But STIP/SEIP ARE readable through sip when M-mode drives them into mip (they are just
    // not writable *via* sip): set them directly in mip, then read sip.
    wr(&mut c, A_MIP, (1 << 5) | (1 << 9)); // M-mode sets STIP+SEIP in mip
    assert_eq!(
        rd(&mut c, A_SIP),
        (1 << 5) | (1 << 9),
        "delegated STIP/SEIP are visible through sip (read), even if not writable via sip"
    );

    // sip READ-side mideleg gate (symmetric to the sie read case above; kills the mutation
    // where `sip` read drops `& s_int_mask()`): delegate SSIP only, then M-mode drives the
    // UNdelegated STIP+SEIP straight into mip — sip read MUST mask them to zero.
    // (Spike: mideleg=0x2, mip=STIP|SEIP → `csrr sip` reads 0.)
    let mut c = Csrs::at_reset();
    wr(&mut c, A_MIDELEG, 1 << 1); // delegate SSIP only
    wr(&mut c, A_MIP, (1 << 5) | (1 << 9)); // undelegated STIP+SEIP pending in mip
    assert_eq!(
        rd(&mut c, A_SIP),
        0,
        "sip READ masks undelegated STIP/SEIP to zero (mideleg-gated read)"
    );
}

// ── the ONLY paths to a mode change are trap-entry and xRET ─────────────────────

#[test]
fn mode_never_changes_via_plain_csr_write() {
    // Writing mstatus (even with MPP/SPP set) must NOT change the current privilege mode —
    // only trap-entry and MRET/SRET move the mode.
    let mut c = Csrs::at_reset();
    assert_eq!(c.mode, Priv::M);
    wr(&mut c, MSTATUS, (0b01 << 11) | SPP | u64::MAX); // scribble MPP/SPP + everything
    assert_eq!(
        c.mode,
        Priv::M,
        "csrw mstatus does not change privilege mode"
    );
}

/// E1-T20 (RISCOF vm mstatus_tvm tests, §3.1.6.5): with mstatus.TVM=1, a `satp` CSR access in
/// S-mode is illegal (the hypervisor-intercept partner of the SFENCE.VMA-in-S trap, E1-T17).
/// M-mode is unaffected; TVM=0 leaves satp accessible in S.
#[test]
fn tvm_makes_satp_access_illegal_in_s_mode() {
    let (mut hart, _bus) = machine();
    wr(&mut hart.csr, MSTATUS, 1 << 20); // set TVM while still in M
    hart.csr.mode = Priv::S;
    for op in [CsrOp::Set, CsrOp::Write, CsrOp::Clear] {
        assert_eq!(
            hart.csr
                .access(SATP, op, 0, true, false, 0xbeef)
                .unwrap_err()
                .cause,
            Exception::IllegalInstruction,
            "satp {op:?} in S with TVM=1 must be illegal"
        );
    }
    // M-mode is unaffected even with TVM set.
    hart.csr.mode = Priv::M;
    assert!(
        hart.csr
            .access(SATP, CsrOp::Write, 0, false, false, 0)
            .is_ok()
    );

    // A fresh hart with TVM=0: satp is accessible in S.
    let (mut h2, _b2) = machine();
    h2.csr.mode = Priv::S;
    assert!(
        h2.csr
            .access(SATP, CsrOp::Write, 0, false, false, 0)
            .is_ok()
    );
}
