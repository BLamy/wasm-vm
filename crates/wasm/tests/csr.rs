//! E1-T02: the CSR subsystem's core semantics must hold identically on wasm32.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, Csrs, MISA, MISA_RV64GC_SU, MTVEC, PROBE, Priv};
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

fn csr_word(f3: u32, rd: u8, rs1: u8, csr: u16) -> u32 {
    ((csr as u32) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | 0b1110011
}

#[wasm_bindgen_test]
fn csr_semantics_on_wasm32() {
    // Side-effect suppression.
    let mut c = Csrs::at_reset();
    c.access(PROBE, CsrOp::Write, 0xAA, false, true, 0).unwrap();
    assert_eq!(c.probe_reads, 0);
    assert_eq!(c.probe_value, 0xAA);
    c.access(PROBE, CsrOp::Set, 0, true, false, 0).unwrap();
    assert_eq!(c.probe_value, 0xAA); // no write

    // Privilege check + tval on wasm32.
    c.mode = Priv::U;
    let t = c
        .access(MTVEC, CsrOp::Write, 0, false, false, 0xDEAD_BEEF)
        .unwrap_err();
    assert_eq!(t.cause, Exception::IllegalInstruction);
    assert_eq!(t.tval, 0xDEAD_BEEF);

    // WARL: misa write ignored, full 64-bit value intact (no bindgen truncation).
    c.mode = Priv::M;
    c.access(MISA, CsrOp::Write, u64::MAX, false, false, 0)
        .unwrap();
    assert_eq!(
        c.access(MISA, CsrOp::Set, 0, true, false, 0).unwrap(),
        MISA_RV64GC_SU
    );

    // Decode + execute a CSR instruction end to end.
    let mut hart = Hart::new();
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    hart.regs.write(5, 0xABCD);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, csr_word(0b001, 0, 5, PROBE))
        .unwrap(); // csrrw x0, PROBE, x5
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.csr.probe_value, 0xABCD);
    assert_eq!(hart.csr.probe_reads, 0);
}
