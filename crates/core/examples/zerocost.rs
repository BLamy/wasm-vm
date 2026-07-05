//! Zero-cost trace probes for tools/check-zero-cost.sh (E0-T15). Two `#[no_mangle]`
//! functions the asm scan can find by name: the null-sink path (must have no trace
//! code) and a recording-sink path (must have it — the detector's self-test target).

use core::hint::black_box;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::trace::{NullSink, TraceSink};

/// A sink that does observable work per retirement — the opposite of NullSink, so the
/// detector can confirm it SEES trace code when trace code is present.
struct RecordingSink {
    last_pc: u64,
    count: u64,
}
impl TraceSink for RecordingSink {
    #[inline(never)]
    fn on_retire(&mut self, pc: u64, insn: u32) {
        // Distinctive, non-elidable body so the symbol/call survives optimization.
        self.last_pc = pc ^ (insn as u64).rotate_left(7);
        self.count = self.count.wrapping_add(1);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn step_nullsink_probe(bus: &mut SystemBus, hart: &mut Hart) {
    let _ = black_box(hart.step_traced(bus, &mut NullSink));
}

#[unsafe(no_mangle)]
pub extern "C" fn step_recording_probe(bus: &mut SystemBus, hart: &mut Hart, sink: &mut ()) {
    let _ = sink;
    let mut rec = RecordingSink {
        last_pc: black_box(0),
        count: black_box(0),
    };
    let _ = black_box(hart.step_traced(bus, &mut rec));
    black_box(rec.last_pc);
}

fn main() {
    // Drive the probes so nothing is dead-code-eliminated before asm emission.
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x0000_0013).unwrap(); // nop (addi x0,x0,0)
    step_nullsink_probe(&mut bus, &mut hart);
    hart.regs.pc = DRAM_BASE;
    step_recording_probe(&mut bus, &mut hart, &mut ());
}
