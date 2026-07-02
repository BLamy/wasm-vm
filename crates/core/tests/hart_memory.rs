//! E0-T08 load/store matrix: sign/zero extension, fault causes 4/5/6/7 with
//! tval = effective address, purity on fault, and boundary behavior.

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const RAM: u64 = 64 * 1024;
const RAM_END: u64 = DRAM_BASE + RAM;
const CODE: u64 = DRAM_BASE; // instruction planted here
const DATA: u64 = DRAM_BASE + 0x1000; // data region for memory ops

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    assert!((-2048..=2047).contains(&imm));
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn s_type(imm: i32, rs2: u8, rs1: u8, f3: u32) -> u32 {
    assert!((-2048..=2047).contains(&imm));
    let iu = (imm as u32) & 0xFFF;
    ((iu >> 5) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((iu & 0x1F) << 7)
        | 0b0100011
}
fn load(f3: u32, rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, f3, rd, 0b0000011)
}

/// Plant `word` at CODE, seed registers, step once.
fn exec(bus: &mut SystemBus, word: u32, seed: &[(u8, u64)]) -> Result<Hart, Trap> {
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    bus.store32(CODE, word).unwrap();
    for &(r, v) in seed {
        hart.regs.write(r, v);
    }
    hart.step(bus).map(|()| hart)
}

fn fresh_bus() -> SystemBus {
    SystemBus::new(Ram::new(RAM as usize).unwrap())
}

// ── acceptance anchors ──────────────────────────────────────────────────────

#[test]
fn lw_sign_extends_lwu_zero_extends_acceptance() {
    let mut bus = fresh_bus();
    bus.store32(DATA, 0xFFFF_FFFF).unwrap();
    let h = exec(&mut bus, load(0b010, 1, 2, 0), &[(2, DATA)]).unwrap(); // lw
    assert_eq!(h.regs.read(1), 0xFFFF_FFFF_FFFF_FFFF);
    let h = exec(&mut bus, load(0b110, 1, 2, 0), &[(2, DATA)]).unwrap(); // lwu
    assert_eq!(h.regs.read(1), 0x0000_0000_FFFF_FFFF);
}

#[test]
fn misaligned_ld_sd_causes_4_and_6_acceptance() {
    let mut bus = fresh_bus();
    let addr = DATA + 4; // % 8 == 4
    let t = exec(&mut bus, load(0b011, 1, 2, 4), &[(2, DATA)]).unwrap_err(); // ld
    assert_eq!(t.cause, Exception::LoadAddrMisaligned);
    assert_eq!(t.tval, addr);
    let t = exec(&mut bus, s_type(4, 3, 2, 0b011), &[(2, DATA), (3, 0xAB)]).unwrap_err(); // sd
    assert_eq!(t.cause, Exception::StoreAddrMisaligned);
    assert_eq!(t.tval, addr);
}

#[test]
fn effective_address_wraps_without_panic_acceptance() {
    // rs1 = 0xFFFF_FFFF_FFFF_FFF8, imm = +16 → wraps to 0x8 → access fault, tval wrapped.
    let mut bus = fresh_bus();
    let t = exec(
        &mut bus,
        load(0b011, 1, 2, 16),
        &[(2, 0xFFFF_FFFF_FFFF_FFF8)],
    )
    .unwrap_err();
    assert_eq!(t.cause, Exception::LoadAccessFault);
    assert_eq!(t.tval, 0x8, "tval must be the WRAPPED effective address");
    let t = exec(
        &mut bus,
        s_type(16, 3, 2, 0b011),
        &[(2, 0xFFFF_FFFF_FFFF_FFF8), (3, 1)],
    )
    .unwrap_err();
    assert_eq!(t.cause, Exception::StoreAccessFault);
    assert_eq!(t.tval, 0x8);
}

#[test]
fn faulting_load_leaves_rd_faulting_store_leaves_ram_acceptance() {
    let mut bus = fresh_bus();
    // Fill a data window with a pattern, digest the ENTIRE ram before/after.
    for i in 0..64u64 {
        bus.store8(DATA + i, (i as u8).wrapping_mul(37)).unwrap();
    }
    let mut before = vec![0u8; RAM as usize];
    bus.ram().read_slice(DRAM_BASE, &mut before).unwrap();

    // Faulting load: rd sentinel untouched, pc unmoved.
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    bus.store32(CODE, load(0b011, 1, 2, 0)).unwrap();
    hart.regs.write(1, 0xC0DE); // rd sentinel
    hart.regs.write(2, 0x4000); // unmapped hole
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::LoadAccessFault);
    assert_eq!(
        hart.regs.read(1),
        0xC0DE,
        "faulting load must leave rd untouched"
    );
    assert_eq!(hart.regs.pc, CODE);

    // Faulting stores at hole, straddle, and misaligned-in-ram.
    for (rs1, imm) in [(0x4000u64, 0), (RAM_END - 4, 0), (DATA + 1, 0)] {
        let _ = exec(
            &mut bus,
            s_type(imm, 3, 2, 0b011),
            &[(2, rs1), (3, u64::MAX)],
        )
        .unwrap_err();
    }
    let mut after = vec![0u8; RAM as usize];
    bus.ram().read_slice(DRAM_BASE, &mut after).unwrap();
    // The exec() calls planted the instruction word at CODE — mask that out.
    before[..4].copy_from_slice(&after[..4]);
    assert_eq!(before, after, "a faulting store mutated RAM");
}

#[test]
fn load_with_rd_equals_rs1_writes_loaded_value_acceptance() {
    let mut bus = fresh_bus();
    bus.store64(DATA, 0x1122_3344_5566_7788).unwrap();
    // ld x2, 0(x2) with x2 = DATA
    let h = exec(&mut bus, load(0b011, 2, 2, 0), &[(2, DATA)]).unwrap();
    assert_eq!(
        h.regs.read(2),
        0x1122_3344_5566_7788,
        "rd==rs1 must hold the LOADED VALUE, not the address"
    );
}

// ── sign/zero extension matrix ──────────────────────────────────────────────

#[test]
fn extension_matrix_all_widths_all_patterns() {
    let mut bus = fresh_bus();
    // memory bytes: 80 7F FF 00 FF FF FF 7F (LE)
    let bytes = [0x80u8, 0x7F, 0xFF, 0x00, 0xFF, 0xFF, 0xFF, 0x7F];
    bus.ram_mut().write_slice(DATA, &bytes).unwrap();

    // (f3, offset, expected)
    let cases: &[(u32, i32, u64)] = &[
        (0b000, 0, 0xFFFF_FFFF_FFFF_FF80), // lb  0x80 → sext
        (0b000, 1, 0x7F),                  // lb  0x7F
        (0b100, 0, 0x80),                  // lbu 0x80 → zext
        (0b100, 2, 0xFF),                  // lbu 0xFF
        (0b001, 0, 0x7F80),                // lh  80 7F LE → 0x7F80 positive
        (0b001, 2, 0x00FF),                // lh  FF 00 LE → 0x00FF, bit15 clear → positive
        (0b101, 4, 0xFFFF),                // lhu FF FF
        (0b010, 0, 0x00FF_7F80),           // lw  80 7F FF 00 LE → 0x00FF7F80 positive
        (0b010, 4, 0x7FFF_FFFF), // lw  FF FF FF 7F LE → 0x7FFFFFFF, bit31 clear → positive
        (0b110, 0, 0x00FF_7F80), // lwu same, zext
        (0b011, 0, 0x7FFF_FFFF_00FF_7F80), // ld  full 8 bytes
    ];
    for &(f3, off, want) in cases {
        let h = exec(&mut bus, load(f3, 1, 2, off), &[(2, DATA)]).unwrap();
        assert_eq!(h.regs.read(1), want, "f3={f3:#b} off={off}");
    }
}

#[test]
fn store_matrix_verified_bytewise_through_bus() {
    let mut bus = fresh_bus();
    let val: u64 = 0x8899_AABB_CCDD_EEFF;
    // sb/sh/sw/sd of the same register — verify exact bytes landed, and no more.
    for (f3, width) in [(0b000u32, 1usize), (0b001, 2), (0b010, 4), (0b011, 8)] {
        // clear an aligned 16-byte window then store
        bus.ram_mut().write_slice(DATA, &[0u8; 16]).unwrap();
        exec(&mut bus, s_type(0, 3, 2, f3), &[(2, DATA), (3, val)]).unwrap();
        let mut got = [0u8; 16];
        bus.ram().read_slice(DATA, &mut got).unwrap();
        let expect_bytes = val.to_le_bytes();
        assert_eq!(&got[..width], &expect_bytes[..width], "width {width}");
        assert!(
            got[width..].iter().all(|&b| b == 0),
            "store width {width} wrote past its width"
        );
    }
}

// ── fault-cause matrix ──────────────────────────────────────────────────────

#[test]
fn misaligned_traps_at_every_width_and_negative_offset_faults() {
    let mut bus = fresh_bus();
    // loads: cause 4 with tval = ea
    for (f3, mis) in [(0b001u32, 1i32), (0b010, 2), (0b011, 4)] {
        let t = exec(&mut bus, load(f3, 1, 2, mis), &[(2, DATA)]).unwrap_err();
        assert_eq!(t.cause, Exception::LoadAddrMisaligned, "load f3={f3:#b}");
        assert_eq!(t.tval, DATA + mis as u64);
    }
    // stores: cause 6
    for (f3, mis) in [(0b001u32, 1i32), (0b010, 2), (0b011, 4)] {
        let t = exec(&mut bus, s_type(mis, 3, 2, f3), &[(2, DATA), (3, 1)]).unwrap_err();
        assert_eq!(t.cause, Exception::StoreAddrMisaligned, "store f3={f3:#b}");
        assert_eq!(t.tval, DATA + mis as u64);
    }
    // negative offset off the RAM base: DRAM_BASE - 1 (adversarial angle 3)
    let t = exec(&mut bus, load(0b000, 1, 2, -1), &[(2, DRAM_BASE)]).unwrap_err();
    assert_eq!(t.cause, Exception::LoadAccessFault);
    assert_eq!(t.tval, DRAM_BASE - 1);
}

#[test]
fn boundary_sweep_last_slot_succeeds_one_past_faults() {
    // Adversarial angle 4, done proactively. NB: CODE lives at DRAM_BASE, data at end.
    let widths: &[(u32, u32, u64)] = &[
        (0b000, 0b000, 1),
        (0b001, 0b001, 2),
        (0b010, 0b010, 4),
        (0b011, 0b011, 8),
    ];
    for &(lf3, sf3, w) in widths {
        let mut bus = fresh_bus();
        let last = RAM_END - w;
        // load at last valid slot succeeds
        exec(&mut bus, load(lf3, 1, 2, 0), &[(2, last)]).unwrap();
        // store at last valid slot succeeds
        exec(&mut bus, s_type(0, 3, 2, sf3), &[(2, last), (3, 7)]).unwrap();
        // one byte past: straddles the end → Access (range beats alignment, E0-T03)
        let t = exec(&mut bus, load(lf3, 1, 2, 1), &[(2, last)]).unwrap_err();
        assert_eq!(t.cause, Exception::LoadAccessFault, "w={w}");
        assert_eq!(t.tval, last + 1);
        let t = exec(&mut bus, s_type(1, 3, 2, sf3), &[(2, last), (3, 7)]).unwrap_err();
        assert_eq!(t.cause, Exception::StoreAccessFault, "w={w}");
    }
}

#[test]
fn pc_unmoved_after_every_memory_fault() {
    let mut bus = fresh_bus();
    for word in [
        load(0b011, 1, 2, 4),   // misaligned ld (x2=DATA)
        load(0b011, 1, 3, 0),   // access ld (x3=hole)
        s_type(4, 3, 2, 0b011), // misaligned sd
        s_type(0, 3, 4, 0b011), // access sd (x4=hole)
    ] {
        let mut hart = Hart::new();
        hart.regs.pc = CODE;
        bus.store32(CODE, word).unwrap();
        hart.regs.write(2, DATA);
        hart.regs.write(3, 0x4000);
        hart.regs.write(4, 0x4000);
        hart.step(&mut bus).unwrap_err();
        assert_eq!(hart.regs.pc, CODE, "{word:#010x}: pc moved on fault");
    }
}

#[test]
fn store_then_load_roundtrip_through_instructions() {
    let mut bus = fresh_bus();
    exec(
        &mut bus,
        s_type(8, 3, 2, 0b011),
        &[(2, DATA), (3, 0xDEAD_BEEF_CAFE_F00D)],
    )
    .unwrap();
    let h = exec(&mut bus, load(0b011, 1, 2, 8), &[(2, DATA)]).unwrap();
    assert_eq!(h.regs.read(1), 0xDEAD_BEEF_CAFE_F00D);
    assert_eq!(h.regs.pc, CODE + 4);
}
