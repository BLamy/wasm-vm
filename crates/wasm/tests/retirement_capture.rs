//! Focused actual-wasm32 mirror of the E5-T26p public capture boundary.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::trace::{TraceRecord, TraceSink};
use wasm_vm_core::{Machine, RunOutcome};

const DATA: u64 = DRAM_BASE + 0x1000;

#[derive(Default)]
struct FalseSink {
    records: Vec<TraceRecord>,
}

impl TraceSink for FalseSink {
    fn retire(&mut self, record: &TraceRecord) {
        self.records.push(*record);
    }

    fn wants_records(&self) -> bool {
        false
    }
}

fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    (((imm as u32) & 0xfff) << 20) | (u32::from(rs1) << 15) | (u32::from(rd) << 7) | 0x13
}

fn s_type(rs2: u8, rs1: u8, funct3: u32, imm: i32, opcode: u32) -> u32 {
    let imm = (imm as u32) & 0xfff;
    ((imm >> 5) << 25)
        | (u32::from(rs2) << 20)
        | (u32::from(rs1) << 15)
        | (funct3 << 12)
        | ((imm & 0x1f) << 7)
        | opcode
}

fn amo(funct5: u32, funct3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (funct5 << 27)
        | (u32::from(rs2) << 20)
        | (u32::from(rs1) << 15)
        | (funct3 << 12)
        | (u32::from(rd) << 7)
        | 0x2f
}

fn machine(cache: bool) -> Machine {
    let mut machine = Machine::new(64 * 1024);
    machine.set_block_cache(cache);
    machine.hart_mut().regs.pc = DRAM_BASE;
    machine.hart_mut().regs.write(2, DATA);
    machine.hart_mut().regs.write(3, 0x1122_3344_5566_7788);
    let bus = machine.bus_mut();
    bus.store32(DRAM_BASE, addi(1, 0, 7)).unwrap();
    bus.store32(DRAM_BASE + 4, s_type(3, 2, 0b011, 0, 0x23))
        .unwrap();
    bus.store32(DRAM_BASE + 8, addi(4, 1, 1)).unwrap();
    machine
}

#[wasm_bindgen_test]
fn wasm_unit_and_false_sink_paths_preserve_parity() {
    let mut ordinary = machine(false);
    let mut cached = machine(true);
    assert_eq!(ordinary.run(3), RunOutcome::MaxInstrs);
    assert_eq!(cached.run(3), RunOutcome::MaxInstrs);
    assert_eq!(ordinary.hart(), cached.hart());
    assert_eq!(
        ordinary.bus_mut().load64(DATA).unwrap(),
        0x1122_3344_5566_7788
    );
    assert_eq!(
        cached.bus_mut().load64(DATA).unwrap(),
        0x1122_3344_5566_7788
    );

    for cache in [false, true] {
        let mut machine = machine(cache);
        let mut sink = FalseSink::default();
        assert_eq!(machine.run_traced(3, &mut sink), RunOutcome::MaxInstrs);
        assert_eq!(sink.records.len(), 3, "cache={cache}");
        assert_eq!(sink.records[0].rd, Some((1, 7)), "cache={cache}");
        assert_eq!(sink.records[1].mem.unwrap().len, 8, "cache={cache}");
    }
}

#[wasm_bindgen_test]
fn wasm_unit_capture_preserves_lrsc_amo_fp_store_effects() {
    let mut hart = Hart::new();
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    hart.regs.pc = DRAM_BASE;
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0x20);
    bus.store32(DATA, 0x10).unwrap();
    bus.store32(DRAM_BASE, amo(0b00010, 0b010, 11, 10, 0))
        .unwrap(); // lr.w
    bus.store32(DRAM_BASE + 4, amo(0b00011, 0b010, 11, 10, 12))
        .unwrap(); // sc.w
    hart.step(&mut bus).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.resv, None);
    assert_eq!(bus.load32(DATA).unwrap(), 0x20);

    hart.regs.pc = DRAM_BASE;
    hart.regs.write(12, 3);
    bus.store32(DATA, 4).unwrap();
    bus.store32(DRAM_BASE, amo(0, 0b010, 11, 10, 12)).unwrap();
    hart.resv = Some((DATA, 4));
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(11), 4);
    assert_eq!(bus.load32(DATA).unwrap(), 7);
    assert_eq!(hart.resv, None);

    hart.csr.mstatus |= 0b01 << 13; // FS=Initial
    hart.regs.write(2, DATA);
    hart.fregs.write_f32(1, 0x3f80_0000);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, s_type(1, 2, 0b010, 0, 0x27))
        .unwrap(); // fsw f1, 0(x2)
    hart.step(&mut bus).unwrap();
    assert_eq!(bus.load32(DATA).unwrap(), 0x3f80_0000);
}
