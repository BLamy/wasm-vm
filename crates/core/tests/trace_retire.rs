//! E0-T15 retire-hook purity (promoted from the verifier's finding): `step_traced`
//! must fire `on_retire` EXACTLY once on a successful retirement, and NEVER on a
//! trapping step — the trap-purity contract extended to tracing. The committed suite
//! had no test pinning this (the verifier's Mutation C, firing on_retire on the trap
//! path, survived without it).

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::trace::{TraceRecord, TraceSink};

/// Records every retirement it is told about.
#[derive(Default)]
struct Counter {
    events: Vec<(u64, u32)>,
}
impl TraceSink for Counter {
    fn retire(&mut self, r: &TraceRecord) {
        self.events.push((r.pc, r.insn));
    }
}

fn machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    (hart, SystemBus::new(Ram::new(64 * 1024).unwrap()))
}

#[test]
fn on_retire_fires_once_on_success_with_pc_and_insn() {
    let (mut hart, mut bus) = machine();
    let nop = 0x0000_0013u32; // addi x0,x0,0
    bus.store32(DRAM_BASE, nop).unwrap();
    let mut sink = Counter::default();
    hart.step_traced(&mut bus, &mut sink).unwrap();
    assert_eq!(
        sink.events,
        [(DRAM_BASE, nop)],
        "one retire record, exact pc+insn"
    );
    assert_eq!(hart.regs.pc, DRAM_BASE + 4);
}

#[test]
fn on_retire_never_fires_on_a_trap() {
    // Three trap shapes: illegal instruction, ECALL, and a fetch access fault.
    // None retires, so the sink must stay empty (Mutation C — fire-on-trap — dies here).
    for (desc, setup) in [("illegal", 0x0000_0000u32), ("ecall", 0x0000_0073u32)] {
        let (mut hart, mut bus) = machine();
        bus.store32(DRAM_BASE, setup).unwrap();
        let mut sink = Counter::default();
        assert!(
            hart.step_traced(&mut bus, &mut sink).is_err(),
            "{desc} must trap"
        );
        assert!(sink.events.is_empty(), "{desc}: no retire record on a trap");
    }
    // Fetch access fault: PC in an unmapped hole.
    let (mut hart, mut bus) = machine();
    hart.regs.pc = 0x1000;
    let mut sink = Counter::default();
    assert!(hart.step_traced(&mut bus, &mut sink).is_err());
    assert!(sink.events.is_empty(), "fetch fault: no retire record");
}

#[test]
fn on_retire_fires_per_retired_instruction_in_a_sequence() {
    // A 3-instruction straight-line run (nop; nop; ecall): exactly 2 retire records,
    // then the ecall traps with no third record.
    let (mut hart, mut bus) = machine();
    bus.store32(DRAM_BASE, 0x0000_0013).unwrap(); // nop
    bus.store32(DRAM_BASE + 4, 0x0000_0013).unwrap(); // nop
    bus.store32(DRAM_BASE + 8, 0x0000_0073).unwrap(); // ecall (traps)
    let mut sink = Counter::default();
    assert!(hart.step_traced(&mut bus, &mut sink).is_ok());
    assert!(hart.step_traced(&mut bus, &mut sink).is_ok());
    assert!(hart.step_traced(&mut bus, &mut sink).is_err());
    assert_eq!(
        sink.events,
        [(DRAM_BASE, 0x0000_0013), (DRAM_BASE + 4, 0x0000_0013)],
        "one record per RETIRED instruction, none for the trapping ecall"
    );
}
