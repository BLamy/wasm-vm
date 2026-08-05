//! E4-T01 phase 2 — the hot-PC sample hook wired into `Machine::run_traced`.
//!
//! Proves the run loop actually feeds the profiler: a guest spinning in a tiny two-instruction loop
//! (both instructions inside ONE 64-byte region) concentrates essentially all PC samples into that
//! region, the profiler is a no-op until armed, and sampling is deterministic (a repeat run samples
//! the identical count). Runs entirely headless through the native interpreter — no browser boot.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::platform::virt::KERNEL_BASE;
use wasm_vm_core::trace::NullSink;

const RAM_BYTES: usize = 8 << 20;

// A two-instruction infinite loop at `KERNEL_BASE` (which is 64-byte aligned, so both instructions
// share one histogram region):
//   addi x5, x5, 1      ; 0x00128293  — a plain retiring instruction
//   jal  x0, -4         ; 0xffdff06f  — jump back to the addi (offset -4)
const LOOP_CODE: [u32; 2] = [0x0012_8293, 0xffdf_f06f];

/// A machine whose PC sits at a tight two-instruction loop written into RAM.
fn machine_in_a_loop() -> Machine {
    let mut m = Machine::new(RAM_BYTES);
    let mut bytes = [0u8; 8];
    bytes[0..4].copy_from_slice(&LOOP_CODE[0].to_le_bytes());
    bytes[4..8].copy_from_slice(&LOOP_CODE[1].to_le_bytes());
    m.bus_mut()
        .ram_mut()
        .write_slice(KERNEL_BASE, &bytes)
        .expect("write loop into RAM");
    m.hart_mut().regs.pc = KERNEL_BASE;
    m
}

#[test]
fn hot_loop_concentrates_samples_in_its_region() {
    let mut m = machine_in_a_loop();
    m.set_profiling(true);
    let _ = m.run_traced(200_000, &mut NullSink);

    let report = m.prof_report(0, 4);
    // ~200k retires at a ~1024 stride → ~195 samples; be generous against jitter.
    assert!(
        report.sample_count > 100,
        "expected ~195 samples, got {}",
        report.sample_count
    );
    assert!(!report.top_regions.is_empty(), "no hot region recorded");

    // The hottest region is the loop's 64-byte region (KERNEL_BASE is 64-byte aligned), and it holds
    // essentially every sample — the whole run lives in that loop.
    let hottest = &report.top_regions[0];
    assert_eq!(
        hottest.phys_pc,
        KERNEL_BASE & !63,
        "hottest region is not the loop's"
    );
    assert!(
        hottest.pct >= 80.0,
        "loop should own >=80% of samples, got {:.1}%",
        hottest.pct
    );
    // A single tight loop must not alias into phantom regions.
    assert_eq!(report.collisions, 0, "unexpected histogram collisions");
}

#[test]
fn profiler_is_inert_until_armed() {
    let mut m = machine_in_a_loop();
    // Not armed: run a chunk and confirm nothing was sampled.
    let _ = m.run_traced(50_000, &mut NullSink);
    let report = m.prof_report(0, 4);
    assert_eq!(report.sample_count, 0, "sampled while disabled");
    assert!(report.top_regions.is_empty());
}

#[test]
fn sampling_is_deterministic() {
    // The jittered stride is driven by a deterministic LCG, so two identical armed runs sample the
    // exact same number of instructions (native == wasm relies on this).
    let counts: Vec<u64> = (0..2)
        .map(|_| {
            let mut m = machine_in_a_loop();
            m.set_profiling(true);
            let _ = m.run_traced(120_000, &mut NullSink);
            m.prof_report(0, 1).sample_count
        })
        .collect();
    assert_eq!(
        counts[0], counts[1],
        "sampling diverged between identical runs"
    );
}
