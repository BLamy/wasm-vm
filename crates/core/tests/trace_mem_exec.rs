//! E0-T16 execution-level mem-capture assertions (promoted from the verifier's Mutation
//! D/E finding): actually EXECUTE loads and stores through the hart and assert the
//! emitted `TraceRecord.mem`. The committed suite previously only tested `fmt_canonical`
//! on hand-built records, so a bug in the hart's 11 mem-capture arms (e.g. logging the
//! store address instead of the value, or dropping the field) shipped green.
#![cfg(feature = "trace")]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::trace::{MemOp, TraceSink};

const CODE: u64 = DRAM_BASE;
const DATA: u64 = DRAM_BASE + 0x1000;

/// Captures the single record produced by stepping one instruction.
#[derive(Default)]
struct One {
    rec: Option<wasm_vm_core::trace::TraceRecord>,
}
impl TraceSink for One {
    fn retire(&mut self, r: &wasm_vm_core::trace::TraceRecord) {
        self.rec = Some(*r);
    }
}

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn s_type(imm: i32, rs2: u8, rs1: u8, f3: u32) -> u32 {
    let iu = (imm as u32) & 0xFFF;
    ((iu >> 5) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((iu & 0x1F) << 7)
        | 0b0100011
}

fn step_one(word: u32, seed: &[(u8, u64)]) -> wasm_vm_core::trace::TraceRecord {
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    bus.store32(CODE, word).unwrap();
    for &(r, v) in seed {
        hart.regs.write(r, v);
    }
    let mut sink = One::default();
    hart.step_traced(&mut bus, &mut sink).unwrap();
    sink.rec.expect("a retired instruction must emit a record")
}

#[test]
fn executed_stores_record_masked_value_at_every_width() {
    // (f3, len, stored-reg-value, expected masked value)
    let cases: &[(u32, u8, u64, u64)] = &[
        (0b000, 1, 0x1122_3344_5566_77AB, 0xAB),        // sb
        (0b001, 2, 0x1122_3344_5566_BEEF, 0xBEEF),      // sh
        (0b010, 4, 0x1122_3344_DEAD_BEEF, 0xDEAD_BEEF), // sw
        (0b011, 8, 0x0123_4567_89AB_CDEF, 0x0123_4567_89AB_CDEF), // sd
    ];
    for &(f3, len, regval, masked) in cases {
        // sd/sw/sh/sb rs2=x5, rs1=x6(=DATA), imm=0
        let rec = step_one(s_type(0, 5, 6, f3), &[(5, regval), (6, DATA)]);
        assert_eq!(
            rec.mem,
            Some(MemOp {
                addr: DATA,
                len,
                is_store: true,
                value: regval
            }),
            "store f3={f3:#b}: mem must be the store with the FULL reg value (fmt masks to {masked:#x})"
        );
        // rd field absent for stores.
        assert_eq!(rec.rd, None, "stores write no register");
    }
}

#[test]
fn executed_load_records_mem_and_loaded_value_incl_rd_equals_rs1() {
    // Seed memory, then ld x6, 0(x6) (rd == rs1): the record's rd must be the LOADED
    // value, and mem the load address — not the base address masquerading as data.
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    bus.store64(DATA, 0x0123_4567_89AB_CDEF).unwrap();
    bus.store32(CODE, i_type(0, 6, 0b011, 6, 0b0000011))
        .unwrap(); // ld x6, 0(x6)
    hart.regs.write(6, DATA);
    let mut sink = One::default();
    hart.step_traced(&mut bus, &mut sink).unwrap();
    let rec = sink.rec.unwrap();
    assert_eq!(
        rec.rd,
        Some((6, 0x0123_4567_89AB_CDEF)),
        "rd == rs1 load must record the LOADED value"
    );
    assert_eq!(
        rec.mem,
        Some(MemOp {
            addr: DATA,
            len: 8,
            is_store: false,
            value: 0
        }),
        "load must record a non-store mem op at the effective address"
    );
}

#[test]
fn executed_load_widths_record_correct_len_and_non_store() {
    for (f3, len) in [(0b000u32, 1u8), (0b001, 2), (0b010, 4), (0b011, 8)] {
        let rec = step_one(i_type(0, 6, f3, 1, 0b0000011), &[(6, DATA)]);
        assert_eq!(
            rec.mem,
            Some(MemOp {
                addr: DATA,
                len,
                is_store: false,
                value: 0
            }),
            "load f3={f3:#b}: len {len}, non-store, addr = DATA"
        );
    }
}

#[test]
fn non_memory_op_records_no_mem() {
    // addi x1, x0, 5 — a pure compute op emits no mem field (guards against a stray
    // capture leaking into non-memory arms).
    let rec = step_one(i_type(5, 0, 0b000, 1, 0b0010011), &[]);
    assert_eq!(rec.mem, None);
    assert_eq!(rec.rd, Some((1, 5)));
}
