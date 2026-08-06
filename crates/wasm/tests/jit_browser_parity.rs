//! E4-T29 Phase 2 — the headless parity gate for the browser (in-wasm) JIT executor.
//!
//! This runs under `wasm-pack test --node`, i.e. in **node with the real `WebAssembly` global**, and
//! exercises the REAL [`BrowserExecutor`] code path: `WebAssembly.Module` compile +
//! `WebAssembly.Instance` instantiate against the frozen E4-T09 ABI bytes, the JS load/store/AMO/LR/SC
//! import closures routing to `Hart::jit_*`, and CpuState sync through a `Uint8Array` view — the same
//! calls the browser makes.
//!
//! **The key gate (`browser_jit_matches_interpreter_*`)**: run a program under the interpreter
//! [`Machine`] (the oracle) and again under a [`Machine`] with the [`BrowserExecutor`] attached
//! (tier-up armed), then assert the FULL architectural state (32 regs + PC + a guest-RAM window) is
//! byte-identical AND that the JIT actually executed (`executed_blocks > 0`). Covered across I / M / A
//! blocks.
//!
//! **What differs from the true browser path (documented):** in the browser the guest RAM lives in a
//! `SharedArrayBuffer`-backed `WebAssembly.Memory` and the load/store imports route across the CPU
//! worker; here the guest RAM is the `Machine`'s in-process RAM and the imports call `Hart::jit_*`
//! in-process. The compiled-block ABI, the compile/instantiate/invoke path, the exit protocol, and the
//! cache/chain/evict bookkeeping are IDENTICAL — this harness is the closest faithful headless form
//! (a real in-browser boot is dev/browser verification debt: the Mac OS-reaps browser boots).

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::jit::CompiledBlockExecutor;
use wasm_vm_wasm::BrowserExecutor;

// ── tiny RV64 encoders ───────────────────────────────────────────────────────
fn enc_addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (0b000 << 12) | (rd << 7) | 0b0010011
}
fn enc_add(rd: u32, rs1: u32, rs2: u32) -> u32 {
    (rs2 << 20) | (rs1 << 15) | (0b000 << 12) | (rd << 7) | 0b0110011
}
fn enc_bne(rs1: u32, rs2: u32, off: i32) -> u32 {
    let o = off as u32;
    ((o >> 12) & 1) << 31
        | ((o >> 5) & 0x3f) << 25
        | (rs2 << 20)
        | (rs1 << 15)
        | (0b001 << 12)
        | ((o >> 1) & 0xf) << 8
        | ((o >> 11) & 1) << 7
        | 0b1100011
}
fn enc_mul(rd: u32, rs1: u32, rs2: u32) -> u32 {
    (0b0000001 << 25) | (rs2 << 20) | (rs1 << 15) | (0b000 << 12) | (rd << 7) | 0b0110011
}
fn enc_mulh(rd: u32, rs1: u32, rs2: u32) -> u32 {
    (0b0000001 << 25) | (rs2 << 20) | (rs1 << 15) | (0b001 << 12) | (rd << 7) | 0b0110011
}
/// `amoadd.w rd, rs2, (rs1)` — funct5 = 0b00000, aq=rl=0, funct3 = 0b010, opcode = 0b0101111.
fn enc_amoadd_w(rd: u32, rs2: u32, rs1: u32) -> u32 {
    (0b00000 << 27) | (rs2 << 20) | (rs1 << 15) | (0b010 << 12) | (rd << 7) | 0b0101111
}
const ECALL: u32 = 0x0000_0073;

fn poke(m: &mut Machine, base: u64, words: &[u32]) {
    for (i, w) in words.iter().enumerate() {
        m.bus_mut().store32(base + 4 * i as u64, *w).unwrap();
    }
}

fn state(m: &Machine) -> ([u64; 32], u64) {
    let mut r = [0u64; 32];
    for i in 0..32u8 {
        r[i as usize] = m.hart().regs.read(i);
    }
    (r, m.hart().regs.pc)
}

fn ram_window(m: &mut Machine, base: u64, words: usize) -> Vec<u32> {
    (0..words)
        .map(|i| m.bus_mut().load32(base + 4 * i as u64).unwrap())
        .collect()
}

/// Run `prog` under the interpreter, then under the browser JIT, and assert byte-identical arch state.
/// `setup` seeds registers; `budget` bounds the run. Returns the JIT machine's executed-block count so
/// the caller can assert the JIT genuinely ran.
fn parity(prog: &[u32], setup: impl Fn(&mut Machine), budget: u64, ram_words: usize) -> u64 {
    // Interpreter oracle.
    let mut mi = Machine::new(8 * 1024 * 1024);
    poke(&mut mi, DRAM_BASE, prog);
    setup(&mut mi);
    mi.hart_mut().regs.pc = DRAM_BASE;
    mi.run(budget);
    let want = state(&mi);
    let want_ram = ram_window(&mut mi, DRAM_BASE, ram_words);

    // Browser-JIT run (real WebAssembly.compile/instantiate/invoke).
    let mut mj = Machine::new(8 * 1024 * 1024);
    poke(&mut mj, DRAM_BASE, prog);
    setup(&mut mj);
    mj.hart_mut().regs.pc = DRAM_BASE;
    mj.set_executor(Box::new(BrowserExecutor::new()));
    mj.set_block_cache(true);
    mj.set_interrupt_batching(true);
    mj.set_hotness_threshold(1);
    mj.set_jit(true);
    mj.run(budget);
    let got = state(&mj);
    let got_ram = ram_window(&mut mj, DRAM_BASE, ram_words);

    assert_eq!(want.0, got.0, "register file diverged (JIT vs interpreter)");
    assert_eq!(want.1, got.1, "PC diverged (JIT vs interpreter)");
    assert_eq!(want_ram, got_ram, "guest RAM diverged (JIT vs interpreter)");
    mj.executor().map(|e| e.executed_blocks()).unwrap_or(0)
}

// ── the parity gate: I / M / A ───────────────────────────────────────────────

#[wasm_bindgen_test]
fn browser_jit_matches_interpreter_i_block() {
    // loop: addi x1,x1,-1 ; add x2,x2,x1 ; bne x1,x0,loop ; ecall
    let prog = [
        enc_addi(1, 1, -1),
        enc_add(2, 2, 1),
        enc_bne(1, 0, -8),
        ECALL,
    ];
    let executed = parity(
        &prog,
        |m| {
            m.hart_mut().regs.write(1, 300);
            m.hart_mut().regs.write(2, 0);
        },
        300 * 3 + 10,
        4,
    );
    assert!(
        executed > 0,
        "the browser JIT must actually execute blocks (I)"
    );
}

#[wasm_bindgen_test]
fn browser_jit_matches_interpreter_m_block() {
    // loop: addi x1,x1,-1 ; mul x2,x2,x1 ; mulh x4,x2,x1 ; bne x1,x0,loop ; ecall
    let prog = [
        enc_addi(1, 1, -1),
        enc_mul(2, 2, 1),
        enc_mulh(4, 2, 1),
        enc_bne(1, 0, -12),
        ECALL,
    ];
    let executed = parity(
        &prog,
        |m| {
            m.hart_mut().regs.write(1, 200);
            m.hart_mut().regs.write(2, 3);
        },
        200 * 4 + 10,
        4,
    );
    assert!(
        executed > 0,
        "the browser JIT must actually execute blocks (M)"
    );
}

#[wasm_bindgen_test]
fn browser_jit_matches_interpreter_a_block() {
    // x10 = DRAM_BASE + 0x1000 (aligned scratch word); increment it atomically each iteration.
    // loop: amoadd.w x2,x3,(x10) ; addi x1,x1,-1 ; bne x1,x0,loop ; ecall
    let scratch = DRAM_BASE + 0x1000;
    let prog = [
        enc_amoadd_w(2, 3, 10),
        enc_addi(1, 1, -1),
        enc_bne(1, 0, -8),
        ECALL,
    ];
    let executed = parity(
        &prog,
        |m| {
            m.hart_mut().regs.write(1, 150);
            m.hart_mut().regs.write(3, 7);
            m.hart_mut().regs.write(10, scratch);
            m.bus_mut().store32(scratch, 0).unwrap();
        },
        150 * 3 + 10,
        // The scratch word is 0x1000/4 = 1024 words past DRAM_BASE — widen the compared window.
        1025,
    );
    assert!(
        executed > 0,
        "the browser JIT must actually execute blocks (A)"
    );
}

// ── compile/instantiate + cache/invalidate + chaining unit gate ──────────────
//
// Drives the executor object directly (no run loop) to prove the E4-T16/T17/T18/T19/T20 obligations
// hold in the browser backend exactly as native. These need no live Hart/bus — they exercise the
// compile+instantiate+registry path and the pure chaining/eviction bookkeeping.

fn block(phys: u64, ops: &[Instr]) -> DecodedBlock {
    let ops: Vec<MicroOp> = ops
        .iter()
        .copied()
        .map(|instr| MicroOp {
            instr,
            len: 4,
            raw: 0,
        })
        .collect();
    let total = 4 * ops.len() as u64;
    DecodedBlock::new(phys, ops, total)
}

#[wasm_bindgen_test]
fn compile_instantiate_and_cache_by_phys_pc() {
    let mut ex = BrowserExecutor::new();
    let p0 = DRAM_BASE;
    // A simple 2-op block ending in a conditional branch (2 outgoing link-slots).
    let b0 = block(
        p0,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Bne {
                rs1: 1,
                rs2: 0,
                imm: 8,
            },
        ],
    );
    assert!(!ex.is_compiled(p0));
    ex.install(&b0);
    assert!(
        ex.is_compiled(p0),
        "block must be cached by physical PC after compile+instantiate"
    );
    assert_eq!(ex.compiled_count(), 1);
    assert!(
        ex.module_count() >= 1,
        "a live WebAssembly.Instance must be registered"
    );
}

#[wasm_bindgen_test]
fn page_write_invalidates_compiled_block() {
    // E4-T17: a code-write to a block's physical page frame drops the compiled block.
    let mut ex = BrowserExecutor::new();
    let p0 = DRAM_BASE;
    let b0 = block(
        p0,
        &[Instr::Addi {
            rd: 5,
            rs1: 0,
            imm: 42,
        }],
    );
    ex.install(&b0);
    assert!(ex.is_compiled(p0));
    ex.invalidate_page(p0 >> 12);
    assert!(
        !ex.is_compiled(p0),
        "SMC page-write must invalidate the compiled block"
    );
    assert_eq!(ex.compiled_count(), 0);
}

#[wasm_bindgen_test]
fn chain_edge_links_and_unlinks_on_invalidation() {
    // E4-T18: a chained edge uses the funcref link-slot, and invalidation unlinks it completely.
    let mut ex = BrowserExecutor::new();
    let p0 = DRAM_BASE;
    let p1 = DRAM_BASE + 0x40;
    let b0 = block(
        p0,
        &[Instr::Bne {
            rs1: 1,
            rs2: 0,
            imm: 0x40,
        }], // 2 slots (taken/not-taken)
    );
    let b1 = block(
        p1,
        &[Instr::Addi {
            rd: 2,
            rs1: 2,
            imm: 1,
        }],
    );
    ex.install(&b0);
    ex.install(&b1);
    assert_eq!(
        ex.linked_target(p0, 0),
        None,
        "edge starts on the dispatch stub"
    );
    ex.link_edge(p0, 0, p1);
    assert_eq!(
        ex.linked_target(p0, 0),
        Some(p1),
        "edge 0 now points at the successor"
    );
    let links_made = ex.chain_stats().links_made;
    assert_eq!(links_made, 1);
    // Invalidate the successor's page: the incoming link-slot from p0 must be restored to the stub.
    ex.invalidate_page(p1 >> 12);
    assert_eq!(
        ex.linked_target(p0, 0),
        None,
        "unlink must restore the dispatch stub after invalidation"
    );
    assert!(
        ex.chain_stats().links_cut >= 1,
        "the cut edge must be counted"
    );
}

#[wasm_bindgen_test]
fn directed_eviction_through_the_single_ordered_path() {
    // E4-T20: force-evict the batch owning a block; the block is gone and the eviction is counted.
    let mut ex = BrowserExecutor::new();
    ex.set_batch_size(1); // one block per module → deterministic per-block eviction
    let p0 = DRAM_BASE;
    ex.install(&block(
        p0,
        &[Instr::Addi {
            rd: 1,
            rs1: 1,
            imm: 1,
        }],
    ));
    assert!(ex.is_compiled(p0));
    assert!(
        ex.evict_batch_containing(p0),
        "must evict the batch owning the block"
    );
    assert!(!ex.is_compiled(p0));
    assert_eq!(ex.jit_cache_stats().evictions, 1);
    // The evicted phys is drained for re-nomination (E4-T20 AC3).
    assert!(ex.take_evicted().contains(&p0));
}
