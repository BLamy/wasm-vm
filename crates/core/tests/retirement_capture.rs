//! Focused public-boundary fixtures for E5-T26p.
//!
//! These compare the ordinary and predecoded paths with JIT disabled, keep a recording
//! positive control, and pin the architectural effects that must not depend on capture mode.

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::trace::{TraceRecord, TraceSink};
use wasm_vm_core::{Machine, RunOutcome};

const DATA: u64 = DRAM_BASE + 0x1000;
const RAM_BYTES: usize = 64 * 1024;

#[derive(Default)]
struct Records {
    records: Vec<TraceRecord>,
}

impl TraceSink for Records {
    fn retire(&mut self, record: &TraceRecord) {
        self.records.push(*record);
    }
}

#[derive(Default)]
struct FalseRecordingSink {
    records: Vec<TraceRecord>,
}

impl TraceSink for FalseRecordingSink {
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

fn seeded_machine(cache: bool) -> Machine {
    let mut machine = Machine::new(RAM_BYTES);
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

fn assert_machine_state_equal(mut left: Machine, mut right: Machine) {
    assert_eq!(left.hart(), right.hart());
    assert_eq!(
        left.bus_mut().load64(DATA).unwrap(),
        right.bus_mut().load64(DATA).unwrap()
    );
}

#[test]
fn ordinary_and_cached_unit_runs_match_recording_positive_control() {
    let mut ordinary = seeded_machine(false);
    let mut cached = seeded_machine(true);
    assert_eq!(ordinary.run(3), RunOutcome::MaxInstrs);
    assert_eq!(cached.run(3), RunOutcome::MaxInstrs);
    assert_machine_state_equal(ordinary, cached);

    let mut ordinary = seeded_machine(false);
    let mut cached = seeded_machine(true);
    let mut ordinary_records = Records::default();
    let mut cached_records = Records::default();
    assert_eq!(
        ordinary.run_traced(3, &mut ordinary_records),
        RunOutcome::MaxInstrs
    );
    assert_eq!(
        cached.run_traced(3, &mut cached_records),
        RunOutcome::MaxInstrs
    );
    assert_eq!(ordinary_records.records, cached_records.records);
    assert_machine_state_equal(ordinary, cached);
}

#[test]
fn public_false_sink_still_receives_callbacks_on_both_paths() {
    for cache in [false, true] {
        let mut machine = seeded_machine(cache);
        let mut sink = FalseRecordingSink::default();
        assert_eq!(machine.run_traced(3, &mut sink), RunOutcome::MaxInstrs);
        assert_eq!(sink.records.len(), 3, "cache={cache}");
        assert_eq!(sink.records[0].rd, Some((1, 7)), "cache={cache}");
        assert_eq!(sink.records[1].mem.unwrap().len, 8, "cache={cache}");
    }

    let (mut hart, mut bus) = direct_hart();
    bus.store32(DRAM_BASE, addi(1, 0, 9)).unwrap();
    let mut sink = FalseRecordingSink::default();
    hart.step_traced(&mut bus, &mut sink).unwrap();
    assert_eq!(sink.records.len(), 1);
    assert_eq!(sink.records[0].rd, Some((1, 9)));
}

fn direct_hart() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    (hart, SystemBus::new(Ram::new(RAM_BYTES).unwrap()))
}

#[test]
fn unit_capture_preserves_success_fault_lrsc_store_fp_and_amo_effects() {
    // Successful LR/SC and AMO effects, including reservation invalidation by the AMO store.
    let (mut hart, mut bus) = direct_hart();
    bus.store32(DATA, 0x10).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0x20);
    bus.store32(DRAM_BASE, amo(0b00010, 0b010, 11, 10, 0))
        .unwrap(); // lr.w
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.resv, Some((DATA, 4)));
    bus.store32(DRAM_BASE + 4, amo(0b00011, 0b010, 11, 10, 12))
        .unwrap(); // sc.w
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(11), 0);
    assert_eq!(hart.resv, None);
    assert_eq!(bus.load32(DATA).unwrap(), 0x20);

    hart.regs.pc = DRAM_BASE;
    hart.regs.write(12, 3);
    bus.store32(DATA, 4).unwrap();
    bus.store32(DRAM_BASE, amo(0b00000, 0b010, 11, 10, 12))
        .unwrap(); // amoadd.w
    hart.resv = Some((DATA, 4));
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(11), 4);
    assert_eq!(bus.load32(DATA).unwrap(), 7);
    assert_eq!(hart.resv, None);

    // A successful reservation is consumed before a PMP-denied SC store can fault.
    hart.regs.pc = DRAM_BASE;
    hart.csr.mstatus &= !(1 << 17); // MPRV off for LR
    bus.store32(DRAM_BASE, amo(0b00010, 0b010, 11, 10, 0))
        .unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.resv, Some((DATA, 4)));
    hart.csr.mstatus |= 1 << 17; // MPRV=1, MPP=S; no PMP grant means the store faults.
    hart.csr.mstatus = (hart.csr.mstatus & !(0b11 << 11)) | (0b01 << 11);
    bus.store32(DRAM_BASE + 4, amo(0b00011, 0b010, 11, 10, 12))
        .unwrap();
    let trap = hart.step(&mut bus).unwrap_err();
    assert_eq!(trap.cause, Exception::StoreAccessFault);
    assert_eq!(hart.resv, None, "SC consumes before its fallible store");
    assert_eq!(bus.load32(DATA).unwrap(), 7);

    // FP store uses the same unit path and still writes the exact bytes.
    let (mut hart, mut bus) = direct_hart();
    hart.csr.mstatus |= 0b01 << 13; // FS=Initial
    hart.fregs.write_f32(1, 0x3f80_0000);
    hart.regs.write(2, DATA);
    bus.store32(DRAM_BASE, s_type(1, 2, 0b010, 0, 0x27))
        .unwrap(); // fsw f1, 0(x2)
    hart.step(&mut bus).unwrap();
    assert_eq!(bus.load32(DATA).unwrap(), 0x3f80_0000);
}
