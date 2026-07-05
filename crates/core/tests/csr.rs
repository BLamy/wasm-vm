//! E1-T02: the Zicsr CSR subsystem — side-effect suppression, privilege/read-only checks,
//! WARL legalization. The same assertions run under wasm32 (crates/wasm/tests/csr.rs). The
//! decode+execute cases need the real Zicsr decode path, which exists only in the default
//! build (under `zicsr-stub` CSR space routes to the E0-T19 stub), so this file is scoped out
//! there.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{
    CsrOp, Csrs, MCAUSE, MEPC, MHARTID, MISA, MISA_RV64GC_SU, MSTATUS, MTVEC, PROBE, Priv,
};
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

// ── direct access() semantics ─────────────────────────────────────────────────

#[test]
fn side_effect_suppression_matrix() {
    // PROBE is a read/write-observable test CSR. Exercise all six ops × rd/src zero/nonzero.
    let mut c = Csrs::at_reset();

    // CSRRW rd==x0 → NO read side effect; the write still happens.
    c.access(PROBE, CsrOp::Write, 0xAA, false, /*rd0*/ true, 0)
        .unwrap();
    assert_eq!(c.probe_reads, 0, "csrrw x0 must not read");
    assert_eq!(c.probe_value, 0xAA, "csrrw always writes");

    // CSRRW rd!=x0 → reads (returns old) and writes.
    let old = c
        .access(PROBE, CsrOp::Write, 0xBB, false, false, 0)
        .unwrap();
    assert_eq!(old, 0xAA);
    assert_eq!(c.probe_reads, 1);
    assert_eq!(c.probe_value, 0xBB);

    // CSRRS rs1==x0 (src_is_zero) → reads but NO write side effect.
    let old = c
        .access(PROBE, CsrOp::Set, 0, /*src0*/ true, false, 0)
        .unwrap();
    assert_eq!(old, 0xBB);
    assert_eq!(c.probe_value, 0xBB, "csrrs x0 must not write");
    assert_eq!(c.probe_reads, 2);

    // CSRRS rs1!=x0 → set bits.
    c.access(PROBE, CsrOp::Set, 0x0F, false, false, 0).unwrap();
    assert_eq!(c.probe_value, 0xBB | 0x0F);

    // CSRRC rs1==x0 → no write; rs1!=x0 → clear bits.
    let before = c.probe_value;
    c.access(PROBE, CsrOp::Clear, 0, true, false, 0).unwrap();
    assert_eq!(c.probe_value, before, "csrrc x0 must not write");
    c.access(PROBE, CsrOp::Clear, 0x0F, false, false, 0)
        .unwrap();
    assert_eq!(c.probe_value, before & !0x0F);
}

#[test]
fn privilege_check_from_address_encoding() {
    // mtvec (0x305) is M-mode (addr[9:8]=0b11). From U-mode it's an illegal access with
    // cause IllegalInstruction (mcause=2) and tval = the faulting instruction word.
    let mut c = Csrs::at_reset();
    c.mode = Priv::U;
    let t = c
        .access(MTVEC, CsrOp::Write, 0, false, false, 0xDEAD_BEEF)
        .unwrap_err();
    assert_eq!(t.cause, Exception::IllegalInstruction);
    assert_eq!(t.cause as u64, 2, "mcause = 2");
    assert_eq!(t.tval, 0xDEAD_BEEF, "mtval = faulting instruction bits");
    // From M-mode the same access is fine.
    c.mode = Priv::M;
    assert!(c.access(MTVEC, CsrOp::Write, 0x80, false, false, 0).is_ok());
}

#[test]
fn read_only_addresses_trap_on_write() {
    let mut c = Csrs::at_reset();
    // User counters 0xC00–0xC1F are read-only (addr[11:10]=0b11): any write traps.
    for addr in [0xC00u16, 0xC01, 0xC02, 0xC1F] {
        assert!(
            c.access(addr, CsrOp::Write, 1, false, false, 0).is_err(),
            "write to read-only {addr:#x} must trap"
        );
        // csrrs with rs1 != x0 is also a write → traps.
        assert!(c.access(addr, CsrOp::Set, 1, false, false, 0).is_err());
        // csrrs with rs1 == x0 is a pure read → allowed (returns 0).
        assert_eq!(c.access(addr, CsrOp::Set, 0, true, false, 0), Ok(0));
    }
    // mhartid (0xF14) is read-only too.
    assert!(c.access(MHARTID, CsrOp::Write, 5, false, false, 0).is_err());
    assert_eq!(c.access(MHARTID, CsrOp::Set, 0, true, false, 0), Ok(0));
}

#[test]
fn unimplemented_csr_traps() {
    let mut c = Csrs::at_reset();
    // 0x7FF is not implemented → illegal.
    assert!(c.access(0x7FF, CsrOp::Set, 0, true, false, 0).is_err());
}

#[test]
fn warl_write_all_ones_reads_back_only_legal_values() {
    let mut c = Csrs::at_reset();
    // misa is WARL-hardwired: writing all-ones legalizes to the fixed value.
    c.access(MISA, CsrOp::Write, u64::MAX, false, false, 0)
        .unwrap();
    assert_eq!(
        c.access(MISA, CsrOp::Set, 0, true, false, 0).unwrap(),
        MISA_RV64GC_SU,
        "misa write is ignored (WARL hardwired)"
    );
    // Fully-writable WARL registers keep the value.
    for addr in [MSTATUS, MCAUSE, MEPC, MTVEC] {
        c.access(addr, CsrOp::Write, u64::MAX, false, false, 0)
            .unwrap();
        assert_eq!(
            c.access(addr, CsrOp::Set, 0, true, false, 0).unwrap(),
            u64::MAX,
            "{addr:#x} is fully writable WARL"
        );
    }
}

// ── decode + execute integration (the acceptance's exact patterns) ────────────

fn machine() -> (Hart, SystemBus) {
    (Hart::new(), SystemBus::new(Ram::new(64 * 1024).unwrap()))
}

/// Encode a CSR instruction word.
fn csr_word(f3: u32, rd: u8, rs1: u8, csr: u16) -> u32 {
    ((csr as u32) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | 0b1110011
}

#[test]
fn csrrw_x0_performs_no_read_and_csrrs_x0_performs_no_write() {
    let (mut hart, mut bus) = machine();
    // Prime PROBE and the source register.
    hart.csr.probe_value = 0x1234;
    hart.regs.write(5, 0xABCD);
    hart.regs.pc = DRAM_BASE;

    // csrrw x0, PROBE, x5 — writes PROBE=x5, suppresses the read.
    bus.store32(DRAM_BASE, csr_word(0b001, 0, 5, PROBE))
        .unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.csr.probe_reads, 0, "csrrw x0 read suppressed");
    assert_eq!(
        hart.csr.probe_value, 0xABCD,
        "csrrw wrote the register value"
    );

    // csrrs x5, PROBE, x0 — reads PROBE into x5, suppresses the write.
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, csr_word(0b010, 5, 0, PROBE))
        .unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(5), 0xABCD, "csrrs read PROBE into rd");
    assert_eq!(hart.csr.probe_value, 0xABCD, "csrrs x0 write suppressed");
    assert_eq!(hart.csr.probe_reads, 1, "csrrs read once");
}

#[test]
fn fence_i_and_wfi_retire_as_noops() {
    let (mut hart, mut bus) = machine();
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x0000_100F).unwrap(); // fence.i
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, DRAM_BASE + 4, "fence.i retires, pc advances");

    bus.store32(DRAM_BASE + 4, 0x1050_0073).unwrap(); // wfi
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, DRAM_BASE + 8, "wfi retires as a no-op");
}

#[test]
fn mret_jumps_to_mepc() {
    let (mut hart, mut bus) = machine();
    // Set mepc via csrrw, then MRET must transfer to it.
    hart.regs.write(1, 0x8000_0040);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, csr_word(0b001, 0, 1, MEPC)).unwrap(); // csrrw x0, mepc, x1
    hart.step(&mut bus).unwrap();
    hart.regs.pc = DRAM_BASE + 4;
    bus.store32(DRAM_BASE + 4, 0x3020_0073).unwrap(); // mret
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, 0x8000_0040, "mret jumps to mepc");
}
