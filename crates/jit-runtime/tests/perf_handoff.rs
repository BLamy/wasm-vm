//! E4-T33 release benchmark: compare the production fast interpreter with the native JIT on the
//! same pure-ALU loops and exact architectural work budgets. The six-op loop remains the
//! worst-case fixed-boundary diagnostic; a 64-op ALU block is the acceptance workload that
//! amortizes one mandatory JIT boundary across a production-sized decoded block.
//!
//! Run with:
//! `cargo test -p wasm-vm-jit-runtime --release --test perf_handoff -- --ignored --nocapture --test-threads=1`

#![cfg(not(target_arch = "wasm32"))]

use std::time::Instant;

use jit_runtime::WasmtimeExecutor;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{MCYCLE, MINSTRET};
use wasm_vm_core::{Machine, RunOutcome};

const RUNS: usize = 5;

struct Workload {
    name: &'static str,
    code: Vec<u32>,
    budget: u64,
    initial_x1_to_x5: [u64; 5],
    expected_x1_to_x5: [u64; 5],
}

fn enc_addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32 & 0xfff) << 20) | (rs1 << 15) | (rd << 7) | 0b0010011
}

fn enc_jal(rd: u32, off: i32) -> u32 {
    let o = off as u32;
    ((o >> 20) & 1) << 31
        | ((o >> 1) & 0x3ff) << 21
        | ((o >> 11) & 1) << 20
        | ((o >> 12) & 0xff) << 12
        | (rd << 7)
        | 0b1101111
}

fn enc_add(rd: u32, rs1: u32, rs2: u32) -> u32 {
    (rs2 << 20) | (rs1 << 15) | (rd << 7) | 0b0110011
}

fn tiny_workload() -> Workload {
    let budget = 6_000_000;
    Workload {
        name: "six-op",
        code: vec![
            enc_addi(1, 1, 1),
            enc_addi(2, 2, 1),
            enc_addi(3, 3, 1),
            enc_addi(4, 4, 1),
            enc_addi(5, 5, 1),
            enc_jal(0, -20),
        ],
        budget,
        initial_x1_to_x5: [0; 5],
        expected_x1_to_x5: [budget / 6; 5],
    }
}

fn dense_workload() -> Workload {
    // 63 dependent ALU operations plus one backward jump. This stays below the production
    // DecodedBlock limit (128 ops) while amortizing the mandatory state/engine boundary.
    let budget = 6_400_000;
    let mut code = Vec::with_capacity(64);
    for operation in 0..63u32 {
        let rd = operation % 5 + 1;
        let rs2 = rd % 5 + 1;
        code.push(enc_add(rd, rd, rs2));
    }
    code.push(enc_jal(0, -(63 * 4)));
    let initial: [u64; 5] = [1, 2, 3, 4, 5];
    let mut expected = initial;
    for _ in 0..budget / 64 {
        for operation in 0..63usize {
            let rd = operation % 5;
            let rs2 = (rd + 1) % 5;
            expected[rd] = expected[rd].wrapping_add(expected[rs2]);
        }
    }
    Workload {
        name: "64-op",
        code,
        budget,
        initial_x1_to_x5: initial,
        expected_x1_to_x5: expected,
    }
}

fn build(workload: &Workload, jit: bool) -> Machine {
    let mut machine = Machine::new(8 * 1024 * 1024);
    for (index, word) in workload.code.iter().enumerate() {
        machine
            .bus_mut()
            .store32(DRAM_BASE + index as u64 * 4, *word)
            .unwrap();
    }
    machine.hart_mut().regs.pc = DRAM_BASE;
    machine.set_block_cache(true);
    machine.set_interrupt_batching(true);
    if jit {
        machine.set_executor(Box::new(WasmtimeExecutor::new()));
        machine.set_hotness_threshold(1);
        machine.set_jit(true);
    }
    machine
}

fn reset_loop(machine: &mut Machine, workload: &Workload) {
    machine.hart_mut().regs.pc = DRAM_BASE;
    for (register, value) in (1..=5).zip(workload.initial_x1_to_x5) {
        machine.hart_mut().regs.write(register, value);
    }
}

fn measure(workload: &Workload, jit: bool) -> f64 {
    let mut machine = build(workload, jit);
    let warm_budget = workload.code.len() as u64 * 32;
    assert_eq!(machine.run(warm_budget), RunOutcome::MaxInstrs);
    if jit {
        assert!(
            machine.executor().unwrap().is_compiled(DRAM_BASE),
            "warm phase must compile the measured block"
        );
    }
    reset_loop(&mut machine, workload);

    let irq_before = machine.irq_stats().retired;
    let mcycle_before = machine.hart_mut().csr.read(MCYCLE);
    let minstret_before = machine.hart_mut().csr.read(MINSTRET);
    let jit_before = machine
        .executor()
        .map_or(0, |executor| executor.retired_via_jit());

    let start = Instant::now();
    let outcome = machine.run(workload.budget);
    let elapsed = start.elapsed().as_secs_f64();

    assert_eq!(outcome, RunOutcome::MaxInstrs);
    assert_eq!(machine.irq_stats().retired - irq_before, workload.budget);
    assert_eq!(
        machine.hart_mut().csr.read(MCYCLE) - mcycle_before,
        workload.budget
    );
    assert_eq!(
        machine.hart_mut().csr.read(MINSTRET) - minstret_before,
        workload.budget
    );
    assert_eq!(machine.hart().regs.pc, DRAM_BASE);
    for (register, expected) in (1..=5).zip(workload.expected_x1_to_x5) {
        assert_eq!(
            machine.hart().regs.read(register),
            expected,
            "x{register} must reflect the exact loop count"
        );
    }
    if jit {
        let executor = machine.executor().unwrap();
        assert!(executor.executed_blocks() > 0);
        assert_eq!(
            executor.retired_via_jit() - jit_before,
            workload.budget,
            "a block-aligned measured run must retire entirely through the JIT"
        );
    }

    workload.budget as f64 / elapsed / 1_000_000.0
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    values[values.len() / 2]
}

fn paired(workload: &Workload) -> (f64, f64, f64) {
    // Untimed warmups heat both Rust/Cranelift code paths before paired measurements begin.
    let _ = measure(workload, false);
    let _ = measure(workload, true);

    let mut interpreter = Vec::with_capacity(RUNS);
    let mut jit = Vec::with_capacity(RUNS);
    for sample in 0..RUNS {
        if sample % 2 == 0 {
            interpreter.push(measure(workload, false));
            jit.push(measure(workload, true));
        } else {
            jit.push(measure(workload, true));
            interpreter.push(measure(workload, false));
        }
    }

    let interpreter_median = median(&mut interpreter);
    let jit_median = median(&mut jit);
    let ratio = jit_median / interpreter_median;
    eprintln!(
        "E4-T33 perf_handoff {}: interpreter={interpreter_median:.3} MIPS, JIT={jit_median:.3} MIPS, JIT/interpreter={ratio:.3}x, budget={}, samples={RUNS}",
        workload.name, workload.budget
    );
    (interpreter_median, jit_median, ratio)
}

fn require_release_build() {
    #[cfg(debug_assertions)]
    panic!("perf_handoff must be run with --release");
}

#[test]
#[ignore = "release performance differential; run explicitly with --ignored --nocapture"]
fn six_op_boundary_diagnostic() {
    require_release_build();
    let _ = paired(&tiny_workload());
}

#[test]
#[ignore = "release performance differential; run explicitly with --ignored --nocapture"]
fn bulk_handoff_jit_beats_production_fast_interpreter() {
    require_release_build();
    let (interpreter_median, jit_median, ratio) = paired(&dense_workload());
    assert!(
        ratio > 1.0,
        "JIT must beat the production fast interpreter: {jit_median:.3} vs {interpreter_median:.3} MIPS ({ratio:.3}x)"
    );
}
