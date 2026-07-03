//! E1-T03: the RV64M boundary table must produce bit-identical results on wasm32, where
//! there is no native i128 — the MULH/MULHSU/MULHU 128-bit intermediates are lowered to
//! compiler-rt `__multi3`, so any native/WASM mismatch here is a refutation.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const OP: u32 = 0b0110011;
const OP32: u32 = 0b0111011;
const MEXT: u32 = 0b0000001;

fn r_word(op: u32, f3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (MEXT << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((rd as u32) << 7)
        | op
}

fn run(op: u32, f3: u32, a: u64, b: u64) -> u64 {
    let mut hart = Hart::new();
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    hart.regs.write(1, a);
    hart.regs.write(2, b);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, r_word(op, f3, 3, 1, 2)).unwrap();
    hart.step(&mut bus).unwrap();
    hart.regs.read(3)
}

const IMIN: u64 = 0x8000_0000_0000_0000;
const IMAX: u64 = 0x7FFF_FFFF_FFFF_FFFF;
const ALL1: u64 = 0xFFFF_FFFF_FFFF_FFFF;

#[wasm_bindgen_test]
fn rv64m_boundary_table_on_wasm32() {
    // 128-bit-intermediate ops (the __multi3 paths).
    assert_eq!(run(OP, 0b001, IMIN, IMIN), 0x4000_0000_0000_0000); // mulh
    assert_eq!(run(OP, 0b001, IMAX, IMAX), 0x3FFF_FFFF_FFFF_FFFF);
    assert_eq!(run(OP, 0b011, ALL1, ALL1), 0xFFFF_FFFF_FFFF_FFFE); // mulhu
    assert_eq!(run(OP, 0b010, ALL1, ALL1), ALL1); // mulhsu(-1, 2^64-1)
    assert_eq!(run(OP, 0b010, IMIN, ALL1), IMIN); // mulhsu(-2^63, 2^64-1)
    assert_eq!(run(OP, 0b000, ALL1, 2), 0xFFFF_FFFF_FFFF_FFFE); // mul

    // Trap-free division edges.
    assert_eq!(run(OP, 0b100, 5, 0), ALL1); // div/0
    assert_eq!(run(OP, 0b101, 5, 0), ALL1); // divu/0
    assert_eq!(run(OP, 0b110, 5, 0), 5); // rem/0
    assert_eq!(run(OP, 0b100, IMIN, ALL1), IMIN); // signed overflow
    assert_eq!(run(OP, 0b110, IMIN, ALL1), 0);

    // W-form sign extension.
    assert_eq!(run(OP32, 0b100, 0x8000_0000, ALL1), 0xFFFF_FFFF_8000_0000); // divw min/-1
    assert_eq!(run(OP32, 0b101, 0xFFFF_FFFF, 1), 0xFFFF_FFFF_FFFF_FFFF); // divuw
    assert_eq!(
        run(OP32, 0b000, 0x0000_FFFF, 0x0000_FFFF),
        0xFFFF_FFFF_FFFE_0001
    ); // mulw
}
