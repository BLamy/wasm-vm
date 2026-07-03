//! E1-T08: compressed instruction decoding + the pc+2/insn-length fetch path must behave
//! identically on wasm32 (expansion + execution are integer-deterministic).
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::decode_c::expand_c;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

#[wasm_bindgen_test]
fn compressed_on_wasm32() {
    // Expansion matches native ground-truth.
    assert_eq!(expand_c(0x0808), Ok(0x0101_0513)); // c.addi4spn a0, sp, 16
    assert_eq!(expand_c(0x9702), Ok(0x0007_00e7)); // c.jalr a4
    assert!(expand_c(0x0000).is_err()); // all-zeros illegal

    // Fetch/execute: C.ADDI a0,1 advances pc by 2.
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    bus.store16(DRAM_BASE, 0x0505).unwrap(); // c.addi a0, 1
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(10), 1);
    assert_eq!(hart.regs.pc, DRAM_BASE + 2);

    // C.JALR writes pc+2, not pc+4.
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    hart.regs.write(14, DRAM_BASE + 0x40);
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    bus.store16(DRAM_BASE, 0x9702).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, DRAM_BASE + 0x40);
    assert_eq!(hart.regs.read(1), DRAM_BASE + 2, "link = pc + 2");
}
