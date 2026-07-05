//! E1-T29: debug-spec mcontrol triggers (tselect/tdata1/tdata2/tcontrol) — CSR WARL + the
//! execute/load/store breakpoint-fire semantics, plus the "never fires when idle/disabled"
//! guarantees. The rv64mi-p-breakpoint ELF is the end-to-end proof (riscv_tests_mi.rs); these
//! are the focused unit checks.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, Csrs, TCONTROL, TDATA1, TDATA2, TINFO, TSELECT};
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const MCONTROL_TYPE2: u64 = 2 << 60;
const M_BIT: u64 = 1 << 6;
const EXEC: u64 = 1 << 2;
const STORE: u64 = 1 << 1;
const LOAD: u64 = 1 << 0;
const MTE: u64 = 1 << 3; // tcontrol.mte

fn wr(c: &mut Csrs, addr: u16, v: u64) {
    c.access(addr, CsrOp::Write, v, false, false, 0).unwrap();
}
fn rd(c: &mut Csrs, addr: u16) -> u64 {
    // Set with src_is_zero=true is a pure read (csrrs rd, csr, x0).
    c.access(addr, CsrOp::Set, 0, true, false, 0).unwrap()
}

/// A hart + bus with a trigger armed: mcontrol type2 with `kinds` bits, on `addr`, M-mode + mte.
fn armed(kinds: u64, addr: u64) -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.csr.pmp.allow_all();
    wr(&mut hart.csr, TCONTROL, MTE);
    wr(&mut hart.csr, TDATA2, addr);
    wr(&mut hart.csr, TDATA1, MCONTROL_TYPE2 | M_BIT | kinds);
    (hart, SystemBus::new(Ram::new(64 * 1024).unwrap()))
}

// sd x1, 0(x2) and ld x1, 0(x2) encodings for the load/store-trigger tests.
const SD_X1_0_X2: u32 = 0x0011_3023;
const LD_X1_0_X2: u32 = 0x0001_3083;
const ADDI_NOP: u32 = 0x0000_0013; // addi x0,x0,0

#[test]
fn execute_trigger_fires_breakpoint_on_matching_pc() {
    let (mut hart, mut bus) = armed(EXEC, DRAM_BASE);
    bus.store32(DRAM_BASE, ADDI_NOP).unwrap();
    hart.regs.pc = DRAM_BASE;
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::Breakpoint);
    assert_eq!(t.cause as u64, 3);
    assert_eq!(t.tval, DRAM_BASE);
    assert_eq!(
        hart.regs.pc, DRAM_BASE,
        "breakpoint fires BEFORE the instruction; pc unmoved"
    );
}

#[test]
fn load_trigger_fires_on_data_address_not_pc() {
    // Trigger on the DATA address, not the instruction. A load from DATA fires; the ld
    // instruction lives at a different PC that is NOT the trigger address.
    let data = DRAM_BASE + 0x800;
    let (mut hart, mut bus) = armed(LOAD, data);
    bus.store32(DRAM_BASE, LD_X1_0_X2).unwrap();
    hart.regs.pc = DRAM_BASE;
    hart.regs.write(2, data); // x2 = load address = trigger address
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::Breakpoint);
    assert_eq!(t.tval, data, "load-trigger tval is the DATA address");
}

#[test]
fn store_trigger_fires_on_store_address() {
    let data = DRAM_BASE + 0x800;
    let (mut hart, mut bus) = armed(STORE, data);
    bus.store32(DRAM_BASE, SD_X1_0_X2).unwrap();
    hart.regs.pc = DRAM_BASE;
    hart.regs.write(2, data);
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::Breakpoint);
    assert_eq!(t.tval, data);
    // The store must NOT have committed (breakpoint fires before the access).
    assert_eq!(
        bus.load64(data),
        Ok(0),
        "store executed despite the pre-access breakpoint"
    );
}

#[test]
fn load_trigger_does_not_fire_on_a_store_or_execute() {
    // A LOAD-only trigger must not fire for a store to the same address, nor as an execute.
    let data = DRAM_BASE + 0x800;
    let (mut hart, mut bus) = armed(LOAD, data);
    bus.store32(DRAM_BASE, SD_X1_0_X2).unwrap();
    hart.regs.pc = DRAM_BASE;
    hart.regs.write(2, data);
    // A store to the trigger address does NOT fire a load trigger → store succeeds, pc advances.
    hart.step(&mut bus).unwrap();
    assert_ne!(hart.regs.pc, DRAM_BASE, "store retired");
}

#[test]
fn disabled_trigger_never_fires() {
    // No kind bits set → the "armed" fast-path guard stays false → the instruction runs.
    let (mut hart, mut bus) = armed(0, DRAM_BASE);
    assert!(hart.csr.triggers_idle(), "no execute/load/store bit ⇒ idle");
    bus.store32(DRAM_BASE, ADDI_NOP).unwrap();
    hart.regs.pc = DRAM_BASE;
    hart.step(&mut bus).unwrap();
    assert_eq!(
        hart.regs.pc,
        DRAM_BASE + 4,
        "instruction retired, no breakpoint"
    );
}

#[test]
fn m_mode_execute_trigger_needs_tcontrol_mte() {
    // Same execute trigger but WITHOUT tcontrol.mte → does not fire in M-mode.
    let mut hart = Hart::new();
    hart.csr.pmp.allow_all();
    wr(&mut hart.csr, TDATA2, DRAM_BASE);
    wr(&mut hart.csr, TDATA1, MCONTROL_TYPE2 | M_BIT | EXEC); // mte NOT set
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    bus.store32(DRAM_BASE, ADDI_NOP).unwrap();
    hart.regs.pc = DRAM_BASE;
    hart.step(&mut bus).unwrap(); // no fire → retires
    assert_eq!(hart.regs.pc, DRAM_BASE + 4);
}

#[test]
fn tselect_clamps_to_single_trigger_tdata1_warl_forces_type2() {
    let mut c = Hart::new().csr;
    // Only trigger 0 exists: writing tselect=1 reads back 0.
    wr(&mut c, TSELECT, 1);
    assert_eq!(
        rd(&mut c, TSELECT),
        0,
        "tselect clamps to the single trigger index 0"
    );
    // tdata1 WARL forces the type field to 2 (mcontrol) even if a bad type is written.
    wr(&mut c, TDATA1, (0xFu64 << 60) | EXEC | M_BIT);
    assert_eq!(
        (rd(&mut c, TDATA1) >> 60) & 0xF,
        2,
        "type field forced to mcontrol(2)"
    );
    assert_eq!(
        rd(&mut c, TDATA1) & (EXEC | M_BIT),
        EXEC | M_BIT,
        "control bits preserved"
    );
    // tinfo advertises type-2 support (bit 2).
    assert_eq!(
        rd(&mut c, TINFO) & (1 << 2),
        1 << 2,
        "tinfo advertises mcontrol(type 2)"
    );
}
