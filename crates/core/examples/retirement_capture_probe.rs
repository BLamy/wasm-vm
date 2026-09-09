//! E5-T26p compiler probes. These exercise the actual public unit/recording entries.
//! They do not claim a browser speedup or provide the semantic parity suite.
use core::hint::black_box;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::trace::HashSink;

#[unsafe(no_mangle)]
#[inline(never)]
pub extern "C" fn capture_hart_unit_probe(bus: &mut SystemBus, hart: &mut Hart) {
    let _ = black_box(hart.step(bus));
}

#[unsafe(no_mangle)]
#[inline(never)]
pub extern "C" fn capture_hart_record_probe(bus: &mut SystemBus, hart: &mut Hart) -> u64 {
    let mut sink = HashSink::new();
    let _ = black_box(hart.step_traced(bus, &mut sink));
    black_box(sink.hash())
}

#[unsafe(no_mangle)]
#[inline(never)]
pub extern "C" fn capture_machine_unit_probe(machine: &mut Machine, count: u64) {
    let _ = black_box(machine.run(black_box(count)));
}

#[unsafe(no_mangle)]
#[inline(never)]
pub extern "C" fn capture_machine_record_probe(machine: &mut Machine, count: u64) -> u64 {
    let mut sink = HashSink::new();
    let _ = black_box(machine.run_traced(black_box(count), &mut sink));
    black_box(sink.hash())
}

fn main() {
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut hart = Hart::new();
    bus.store32(DRAM_BASE, black_box(0x0000_0013)).unwrap();
    hart.regs.pc = DRAM_BASE;
    capture_hart_unit_probe(&mut bus, &mut hart);
    hart.regs.pc = DRAM_BASE;
    black_box(capture_hart_record_probe(&mut bus, &mut hart));
    for cached in [false, true] {
        let mut machine = Machine::new(64 * 1024);
        machine
            .bus_mut()
            .store32(DRAM_BASE, black_box(0x0000_0013))
            .unwrap();
        machine.set_block_cache(cached);
        machine.hart_mut().regs.pc = DRAM_BASE;
        capture_machine_unit_probe(&mut machine, 1);
        machine.hart_mut().regs.pc = DRAM_BASE;
        black_box(capture_machine_record_probe(&mut machine, 1));
    }
}
