//! wasm32 mirror of the E0-T07 hart suite (`wasm-pack test --node`), including the
//! angle-5 determinism gate: an identical 20k-instruction pseudo-random stream must
//! fold to the identical checksum pinned from the native run — any numeric divergence
//! between native and wasm32 execution fails this test.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::decode::decode;
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const RAM: u64 = 64 * 1024;
/// Must equal hart_semantics::PINNED_CHECKSUM (native). One constant, two targets.
const PINNED_CHECKSUM: u64 = 0x6CF5_617F_8ABB_9804;

fn r_type(f7: u32, rs2: u8, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (f7 << 25) | ((rs2 as u32) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}

#[wasm_bindgen_test]
fn acceptance_anchors_on_wasm32() {
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    let mut bus = SystemBus::new(Ram::new(RAM as usize).unwrap());

    // addiw sign boundary
    bus.store32(DRAM_BASE, i_type(1, 2, 0b000, 1, 0b0011011))
        .unwrap();
    hart.regs.write(2, 0x7FFF_FFFF);
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(1), 0xFFFF_FFFF_8000_0000);

    // sll shamt masking (rs2[5:0])
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, r_type(0, 3, 2, 0b001, 1, 0b0110011))
        .unwrap();
    hart.regs.write(2, 0x0F0F);
    hart.regs.write(3, 0xFFFF_FFFF_FFFF_FFC1);
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(1), 0x0F0F << 1);

    // fetch fault purity
    hart.regs.pc = 0x1000;
    let trap = hart.step(&mut bus).unwrap_err();
    assert_eq!(trap.cause, Exception::InstrAccessFault);
    assert_eq!(trap.tval, 0x1000);
    assert_eq!(hart.regs.pc, 0x1000);
}

#[wasm_bindgen_test]
fn determinism_checksum_matches_native_pin() {
    // IDENTICAL generator to hart_semantics::determinism_checksum (native).
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    let mut bus = SystemBus::new(Ram::new(RAM as usize).unwrap());
    let mut state: u64 = 0x5EED_2026_0702_0007;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for _ in 0..20_000 {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let rd = 1 + ((state >> 10) % 31) as u8;
        let rs1 = ((state >> 20) % 32) as u8;
        let rs2 = ((state >> 25) % 32) as u8;
        let f3 = ((state >> 30) & 7) as u32;
        let word = match (state >> 33) % 3 {
            0 => {
                let f7 = match f3 {
                    0b000 | 0b101 => {
                        if state & 1 == 1 {
                            0b0100000
                        } else {
                            0
                        }
                    }
                    _ => 0,
                };
                r_type(f7, rs2, rs1, f3, rd, 0b0110011)
            }
            1 => {
                let (f7, f3w) = match f3 & 1 {
                    0 => (if state & 2 == 2 { 0b0100000 } else { 0 }, 0b000),
                    _ => (0, 0b001),
                };
                r_type(f7, rs2, rs1, f3w, rd, 0b0111011)
            }
            _ => i_type(
                ((state >> 40) as i32 & 0xFFF) - 2048,
                rs1,
                f3,
                rd,
                0b0010011,
            ),
        };
        if decode(word).is_err() {
            continue;
        }
        bus.store32(hart.regs.pc, word).unwrap();
        if hart.step(&mut bus).is_err() {
            continue;
        }
        if hart.regs.pc >= DRAM_BASE + RAM - 8 {
            hart.regs.pc = DRAM_BASE;
        }
        hash = (hash ^ hart.regs.read(rd)).wrapping_mul(0x100_0000_01b3);
        hash = (hash ^ hart.regs.pc).wrapping_mul(0x100_0000_01b3);
    }
    assert_eq!(
        hash, PINNED_CHECKSUM,
        "wasm32 execution diverged numerically from native"
    );
}
