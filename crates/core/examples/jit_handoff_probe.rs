//! Host-clock microbenchmark through the public handoff API; assertions are outside timing.
use std::hint::black_box;
use std::time::Instant;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::jit::CpuStateHandoff;

fn main() {
    let mask: u32 = std::env::args().nth(1).unwrap().parse().unwrap();
    let iterations: u64 = std::env::args().nth(2).unwrap().parse().unwrap();
    let mut hart = Hart::default();
    let mut handoff = CpuStateHandoff::default();
    for reg in 0..32u64 {
        let value = 0xfedc_ba98_7654_0000 | reg;
        let at = reg as usize * 8;
        handoff.as_mut_bytes()[at..at + 8].copy_from_slice(&value.to_le_bytes());
    }
    let started = Instant::now();
    for _ in 0..iterations {
        black_box(&handoff).commit_registers_mask(black_box(&mut hart), black_box(mask));
    }
    let seconds = started.elapsed().as_secs_f64();
    let mut words = [0u64; 32];
    for reg in 0..32u8 {
        words[reg as usize] = hart.regs.read(reg);
        let expected = if reg != 0 && mask & (1 << reg) != 0 {
            0xfedc_ba98_7654_0000 | u64::from(reg)
        } else {
            0
        };
        assert_eq!(words[reg as usize], expected);
    }
    assert_eq!(
        hart.regs.jit_version(),
        iterations * u64::from(mask >> 1 != 0)
    );
    // Preserve every bit when the benchmark JSON is parsed by JavaScript.
    let words = words.map(|word| format!("{word:016x}"));
    println!(
        "{{\"mask\":{mask},\"iterations\":{iterations},\"seconds\":{seconds},\"version\":{},\"words\":{words:?}}}",
        hart.regs.jit_version()
    );
}
