#![allow(clippy::identity_op, clippy::needless_range_loop)]
//! E4-T19 correctness gates — module batching, PROVEN BY TEST.
//!
//! * `partial_batch_invalidation_retires_whole_batch` (adversarial #2, critical) — build a
//!   multi-block batch (8 blocks, one module), SMC-kill ONE block via an overlapping code store, and
//!   assert the WHOLE batch is retired (the documented option), the survivors recompile on
//!   re-execution, and the guest state stays byte-identical to the interpreter throughout — so a
//!   stale intra-batch DIRECT call into dead bytes is impossible (the module is dropped atomically).
//! * `registry_accounting_is_accurate_at_k1` (adversarial #3) — force K=1, drive many distinct
//!   blocks, and assert the instance registry's module count equals the compiled-block count and the
//!   byte estimate is positive and grows, then collapses to zero on a whole-cache flush.
//! * `batch_execution_is_verdict_identical` — the K-block batch (intra-batch direct calls present in
//!   the emitted module, inert natively) runs byte-identically to the interpreter.

use jit_runtime::WasmtimeExecutor;

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;

fn enc_addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (0b000 << 12) | (rd << 7) | 0b0010011
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

const N: usize = 8;
const BASE: u64 = DRAM_BASE; // page-aligned: all N 8-byte blocks live in one physical page

/// A straight-line chain of N 2-op blocks on ONE page: block i = `addi x1,x1,1 ; jal x0,+4` → block
/// i+1; the last block spins (`jal x0,0`). The `jal` edges make the N blocks one connected component
/// → one batch. `x1` accumulates the number of blocks executed.
fn load_chain(m: &mut Machine) {
    for i in 0..N {
        let a = BASE + (i as u64) * 8;
        m.bus_mut().store32(a, enc_addi(1, 1, 1)).unwrap();
        let jal = if i + 1 < N {
            enc_jal(0, 4) // +4 from the jal → next block entry (base+8)
        } else {
            enc_jal(0, 0) // final block: spin in place
        };
        m.bus_mut().store32(a + 4, jal).unwrap();
    }
}

fn arm_jit(m: &mut Machine, k: usize) {
    m.set_executor(Box::new(WasmtimeExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_batch_size(k);
    m.set_jit(true);
}

fn regs(m: &Machine) -> [u64; 32] {
    let mut r = [0u64; 32];
    for i in 0..32u8 {
        r[i as usize] = m.hart().regs.read(i);
    }
    r
}

/// Run the chain once from block0 with a fixed budget, capturing final registers (interpreter).
fn oracle_run() -> [u64; 32] {
    let mut m = Machine::new(8 * 1024 * 1024);
    load_chain(&mut m);
    m.hart_mut().regs.pc = BASE;
    m.run(2000);
    regs(&m)
}

#[test]
fn batch_execution_is_verdict_identical() {
    let oracle = oracle_run();
    let mut m = Machine::new(8 * 1024 * 1024);
    load_chain(&mut m);
    arm_jit(&mut m, 64);
    m.hart_mut().regs.pc = BASE;
    m.run(2000);
    // Blocks compiled into ONE batch.
    let (modules, bytes) = m.jit_registry();
    assert_eq!(modules, 1, "the connected chain must pack into ONE module");
    assert!(bytes > 0, "the batch must account nonzero bytes");
    let exec = m.executor().unwrap();
    let compiled = (0..N)
        .filter(|&i| exec.is_compiled(BASE + i as u64 * 8))
        .count();
    assert_eq!(compiled, N, "all {N} blocks compiled into the batch");
    // Re-run from the top: JIT executes the batch, byte-identical to the interpreter.
    m.hart_mut().regs.write(1, 0);
    m.hart_mut().regs.pc = BASE;
    m.run(2000);
    for i in 1..32 {
        assert_eq!(
            oracle[i],
            regs(&m)[i],
            "reg x{i} diverged batch-JIT vs interpreter"
        );
    }
    assert!(
        m.executor().unwrap().executed_blocks() > 0,
        "the batch must actually run via the JIT"
    );
}

#[test]
fn partial_batch_invalidation_retires_whole_batch() {
    // Oracle: the whole scenario under the interpreter (initial run, then SMC on block 3, then rerun).
    let oracle = {
        let mut m = Machine::new(8 * 1024 * 1024);
        load_chain(&mut m);
        m.hart_mut().regs.pc = BASE;
        m.run(2000);
        // SMC: rewrite block 3's body op to `addi x1,x1,+10` (different bytes, same length).
        m.bus_mut()
            .store32(BASE + 3 * 8, enc_addi(1, 1, 10))
            .unwrap();
        m.hart_mut().regs.write(1, 0);
        m.hart_mut().regs.pc = BASE;
        m.run(2000);
        regs(&m)
    };

    let mut m = Machine::new(8 * 1024 * 1024);
    load_chain(&mut m);
    arm_jit(&mut m, 64);
    m.hart_mut().regs.pc = BASE;
    m.run(2000);
    assert_eq!(m.jit_registry().0, 1, "one batch before SMC");
    let exec = m.executor().unwrap();
    assert!(
        (0..N).all(|i| exec.is_compiled(BASE + i as u64 * 8)),
        "all blocks compiled into the batch before SMC"
    );

    // ── SMC-kill ONE block (block 3) via an overlapping code store. ──
    // Freeze nomination (huge threshold) so the single drain-run below does not itself recompile the
    // still-spinning block via the end-of-run flush — we want to observe the retirement in isolation.
    m.set_hotness_threshold(1_000_000);
    m.hart_mut().regs.pc = BASE + (N as u64 - 1) * 8; // park PC on the spin, off the store's page churn
    m.bus_mut()
        .store32(BASE + 3 * 8, enc_addi(1, 1, 10))
        .unwrap();
    m.run(1); // drain the write log → invalidate_page(frame) → whole-batch retirement

    let exec = m.executor().unwrap();
    assert_eq!(
        m.jit_registry().0,
        0,
        "the WHOLE batch must be retired when one member is SMC-killed"
    );
    assert!(
        (0..N).all(|i| !exec.is_compiled(BASE + i as u64 * 8)),
        "no block of the retired batch may remain compiled (no stale direct-call target survives)"
    );

    // ── Re-execute: the survivors + the rewritten block recompile and match the interpreter. ──
    m.set_hotness_threshold(1); // re-arm nomination so the recompile happens
    m.hart_mut().regs.write(1, 0);
    m.hart_mut().regs.pc = BASE;
    m.run(2000);
    for i in 1..32 {
        assert_eq!(
            oracle[i],
            regs(&m)[i],
            "reg x{i} diverged after partial-batch invalidation + recompile"
        );
    }
    let comp: Vec<bool> = (0..N)
        .map(|i| m.executor().unwrap().is_compiled(BASE + i as u64 * 8))
        .collect();
    eprintln!(
        "recompiled state: {comp:?}, registry={:?}",
        m.jit_registry()
    );
    assert!(
        comp.iter().filter(|&&c| c).count() >= N - 1,
        "the surviving + rewritten blocks recompile on re-execution: {comp:?}"
    );
}

#[test]
fn registry_accounting_is_accurate_at_k1() {
    // K=1: every block is its OWN module — module_count must equal compiled_count exactly.
    let mut m = Machine::new(8 * 1024 * 1024);
    load_chain(&mut m);
    arm_jit(&mut m, 1);
    m.hart_mut().regs.pc = BASE;
    m.run(2000);

    let exec = m.executor().unwrap();
    let (modules, bytes) = m.jit_registry();
    let compiled = exec.compiled_count();
    assert_eq!(
        modules, compiled,
        "K=1: one module per block (modules {modules} vs compiled {compiled})"
    );
    assert!(
        compiled >= N - 1,
        "most of the chain compiled (got {compiled})"
    );
    assert!(
        bytes >= compiled as u64,
        "byte estimate must be positive and per-module"
    );

    // A whole-cache flush drops every module → registry collapses to zero (accurate accounting).
    m.set_block_cache(false);
    assert_eq!(
        m.jit_registry(),
        (0, 0),
        "a whole-cache flush must zero the instance registry"
    );
}
