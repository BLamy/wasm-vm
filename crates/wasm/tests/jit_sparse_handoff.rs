#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

#[path = "../../core/tests/jit_sparse_handoff.rs"]
mod core_jit_sparse_handoff;

use sha2::{Digest, Sha256};
use wasm_bindgen_test::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::trace::HashSink;
use wasm_vm_wasm::BrowserExecutor;

fn machine(registers: &[u8], jit: bool) -> Machine {
    let mut m = Machine::new(64 * 1024);
    for (index, &reg) in registers.iter().enumerate() {
        let word = (1 << 20) | (u32::from(reg) << 15) | (u32::from(reg) << 7) | 0x13;
        m.bus_mut()
            .store32(DRAM_BASE + 4 * index as u64, word)
            .unwrap();
    }
    let offset = (-4 * registers.len() as i32) as u32;
    let jal = ((offset >> 20 & 1) << 31)
        | ((offset >> 1 & 0x3ff) << 21)
        | ((offset >> 11 & 1) << 20)
        | ((offset >> 12 & 0xff) << 12)
        | 0x6f;
    m.bus_mut()
        .store32(DRAM_BASE + 4 * registers.len() as u64, jal)
        .unwrap();
    m.hart_mut().regs.pc = DRAM_BASE;
    for reg in 1..32u8 {
        m.hart_mut().regs.write(reg, u64::MAX - u64::from(reg));
    }
    // No timer device here: this fixture isolates register handoff across arbitrary budgets.
    // JIT and interpreter sample the CSR time shadow at different existing boundaries. The
    // production-module benchmark separately compares CPU, CLINT and clock state with a timer.
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    if jit {
        let executor = BrowserExecutor::new_inline(&m).unwrap();
        m.set_executor(Box::new(executor));
        m.set_hotness_threshold(1);
        m.set_jit(true);
    }
    m
}

#[wasm_bindgen_test]
fn compiled_sparse_and_dense_resumes_match_recorded_interpreter() {
    for registers in [vec![0], vec![31], vec![1, 7, 31], (1..32).collect()] {
        let mut oracle = machine(&registers, false);
        let mut candidate = machine(&registers, true);
        let mut trace = HashSink::new();
        let mut total = 0;
        for budget in [0, 1, 2, 3, 31, 127, 128, 129, 4096, 4097] {
            assert_eq!(candidate.run(budget), oracle.run_traced(budget, &mut trace));
            total += budget;
            let state = candidate.save_resume().unwrap();
            assert_eq!(
                state,
                oracle.save_resume().unwrap(),
                "regs={registers:?} budget={budget}"
            );
            let (loops, tail) = (
                total / (registers.len() as u64 + 1),
                total % (registers.len() as u64 + 1),
            );
            for reg in 1..32u8 {
                let increment = registers
                    .iter()
                    .position(|r| *r == reg)
                    .map_or(0, |i| loops + u64::from((i as u64) < tail));
                assert_eq!(
                    candidate.hart().regs.read(reg),
                    (u64::MAX - u64::from(reg)).wrapping_add(increment)
                );
            }
            assert_eq!(candidate.hart().regs.read(0), 0);
            console_log!(
                "HANDOFF_GUEST regs={:?} budget={} total={} trace={:016x} state={:x}",
                registers,
                budget,
                total,
                trace.hash(),
                Sha256::digest(&state)
            );
        }
        assert_eq!(trace.retired(), total);
        assert!(candidate.executor().unwrap().executed_blocks() > 0);
        console_log!(
            "HANDOFF_COMPILED regs={:?} blocks={}",
            registers,
            candidate.executor().unwrap().executed_blocks()
        );
    }
}
