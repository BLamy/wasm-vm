#![allow(clippy::identity_op, clippy::needless_range_loop)]
//! E4-T20 correctness gates — cache budgets, the single ordered `evict_batch` path, and stats.
//!
//! * `eviction_under_fire_falls_to_interp_and_retranslates` (AC3) — compile the batch holding the
//!   currently-hottest loop, force-evict it mid-run, and assert via the STATS SEQUENCE that (a) the
//!   eviction + generation bump happened, (b) execution fell to the interpreter, (c) the block was
//!   re-nominated (hotness discovery) and RE-TRANSLATED (the thrash counter ticked), and (d) the
//!   guest result stayed byte-identical to the interpreter throughout.
//! * `evict_batch_discharges_every_obligation` — after `evict_batch`, assert every eviction
//!   obligation held: no incoming link-slot points into the evicted batch (E4-T18 unlink), the table
//!   map entries are freed, the registry byte/count is decremented, and the generation is bumped. The
//!   in-code debug assertions in `evict_batch` back-stop the ordering (a drop-before-unlink bug trips
//!   one).
//! * `budget_caps_live_batches` — drive many distinct one-block batches with `max_batches` tiny and
//!   assert the live batch count NEVER exceeds the budget and evictions accrue.

use jit_runtime::WasmtimeExecutor;

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::jit::{EvictPolicy, JitCacheBudget};

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

const BASE: u64 = DRAM_BASE;

fn regs(m: &Machine) -> [u64; 32] {
    let mut r = [0u64; 32];
    for i in 0..32u8 {
        r[i as usize] = m.hart().regs.read(i);
    }
    r
}

/// A single hot self-loop at BASE: `addi x1,x1,1 ; bne x1,x3,-4` — spins until x1 == x3 (x3 = count).
/// One block (the `bne` terminates it), one batch.
fn load_hot_loop(m: &mut Machine) {
    m.bus_mut().store32(BASE, enc_addi(1, 1, 1)).unwrap();
    m.bus_mut().store32(BASE + 4, enc_bne(1, 3, -4)).unwrap();
}

fn arm_jit(m: &mut Machine) {
    m.set_executor(Box::new(WasmtimeExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
}

fn run_loop(m: &mut Machine, count: u64) {
    m.hart_mut().regs.write(1, 0);
    m.hart_mut().regs.write(3, count);
    m.hart_mut().regs.pc = BASE;
    m.run(count * 3 + 100);
}

#[test]
fn eviction_under_fire_falls_to_interp_and_retranslates() {
    // Oracle: pure interpreter.
    let oracle = {
        let mut m = Machine::new(8 * 1024 * 1024);
        load_hot_loop(&mut m);
        run_loop(&mut m, 200);
        regs(&m)
    };

    let mut m = Machine::new(8 * 1024 * 1024);
    load_hot_loop(&mut m);
    arm_jit(&mut m);

    // Phase 1: warm the loop so its block compiles into a batch and actually runs via the JIT.
    run_loop(&mut m, 100);
    assert!(m.executor().unwrap().is_compiled(BASE), "loop must compile");
    let s0 = m.jit_cache_stats();
    assert!(s0.installs >= 1, "at least one install");
    assert_eq!(s0.evictions, 0, "no eviction yet");
    let executed_before = m.executor().unwrap().executed_blocks();
    assert!(executed_before > 0, "JIT must have run the hot loop");

    // Phase 2: EVICT THE BATCH CONTAINING THE HOTTEST LOOP through the single ordered path.
    assert!(
        m.evict_jit_batch_containing(BASE),
        "the hot loop's batch must be evicted"
    );
    let s1 = m.jit_cache_stats();
    assert_eq!(s1.evictions, s0.evictions + 1, "eviction counted");
    assert!(s1.generation > s0.generation, "generation bumped on evict");
    assert!(
        !m.executor().unwrap().is_compiled(BASE),
        "the evicted block must no longer be compiled — execution now falls to the interpreter"
    );

    // Phase 3: keep running. The block is re-nominated by hotness discovery and RE-TRANSLATED; the
    // thrash counter ticks. Correctness holds throughout.
    run_loop(&mut m, 200);
    let s2 = m.jit_cache_stats();
    assert!(
        s2.retranslations >= 1,
        "the evicted-then-hot block must be re-translated (thrash signal), got {}",
        s2.retranslations
    );
    assert!(s2.installs > s0.installs, "a fresh install happened");
    assert!(
        m.executor().unwrap().is_compiled(BASE),
        "the block re-compiled after re-nomination"
    );
    // Byte-identical to the interpreter after the whole evict-under-fire sequence.
    for i in 1..32 {
        assert_eq!(
            oracle[i],
            regs(&m)[i],
            "reg x{i} diverged across eviction-under-fire"
        );
    }
    eprintln!(
        "eviction-under-fire: evictions={} retranslations={} installs={} gen={}",
        s2.evictions, s2.retranslations, s2.installs, s2.generation
    );
}

/// An N-block straight-line chain on one page — block i = `addi x1,x1,1 ; jal x0,+4` → block i+1,
/// last spins. The jal edges make it one connected component → one batch (with intra-batch links).
const N: usize = 6;
fn load_chain(m: &mut Machine) {
    for i in 0..N {
        let a = BASE + (i as u64) * 8;
        m.bus_mut().store32(a, enc_addi(1, 1, 1)).unwrap();
        let jal = if i + 1 < N {
            enc_jal(0, 4)
        } else {
            enc_jal(0, 0)
        };
        m.bus_mut().store32(a + 4, jal).unwrap();
    }
}

#[test]
fn evict_batch_discharges_every_obligation() {
    let mut m = Machine::new(8 * 1024 * 1024);
    load_chain(&mut m);
    arm_jit(&mut m);
    m.set_chaining(true);
    // Warm the chain so the batch compiles AND intra/cross links form.
    m.hart_mut().regs.write(1, 0);
    m.hart_mut().regs.pc = BASE;
    m.run(2000);
    let exec = m.executor().unwrap();
    assert_eq!(m.jit_registry().0, 1, "one batch before eviction");
    assert!(
        (0..N).all(|i| exec.is_compiled(BASE + i as u64 * 8)),
        "all chain blocks compiled"
    );
    let (_, bytes_before) = m.jit_registry();
    assert!(bytes_before > 0);
    let gen_before = m.jit_cache_stats().generation;

    // Evict the batch that owns block 0 — the WHOLE chain goes (one batch). The in-code debug
    // assertions in `evict_batch` prove the ordering (no live slot points into the freed table
    // indices); here we assert the externally-visible obligations.
    assert!(m.evict_jit_batch_containing(BASE));

    // Obligation: table entries freed / blocks uninstalled.
    let exec = m.executor().unwrap();
    for i in 0..N {
        let phys = BASE + i as u64 * 8;
        assert!(
            !exec.is_compiled(phys),
            "block {i} still compiled after evict"
        );
    }
    // Obligation: no link-slot points into the evicted batch (E4-T18 unlink complete).
    for i in 0..N {
        let phys = BASE + i as u64 * 8;
        for edge in 0..2u8 {
            assert_eq!(
                exec.linked_target(phys, edge),
                None,
                "block {i} edge {edge} still linked after evict"
            );
        }
    }
    // Obligation: registry count + bytes decremented.
    assert_eq!(
        m.jit_registry().0,
        0,
        "registry batch count not decremented"
    );
    assert_eq!(m.jit_registry().1, 0, "registry bytes not decremented");
    // Obligation: generation bumped.
    assert!(
        m.jit_cache_stats().generation > gen_before,
        "generation not bumped by evict"
    );
    eprintln!(
        "evict_batch obligations all discharged; jitstat:\n{}",
        m.jitstat()
    );
}

#[test]
fn budget_caps_live_batches() {
    // K=1 so every block is its own batch; max_batches=3 so the live batch count is hard-capped.
    let mut m = Machine::new(64 * 1024 * 1024);
    // A run of 40 distinct one-block segments: `addi x1,x1,1 ; jal x0,+4` walking forward.
    let segs = 40u64;
    for i in 0..segs {
        let a = BASE + i * 8;
        m.bus_mut().store32(a, enc_addi(1, 1, 1)).unwrap();
        let jal = if i + 1 < segs {
            enc_jal(0, 4)
        } else {
            enc_jal(0, 0)
        };
        m.bus_mut().store32(a + 4, jal).unwrap();
    }
    arm_jit(&mut m);
    m.set_batch_size(1);
    m.set_evict_policy(EvictPolicy::BatchLru);
    m.set_jit_budget(JitCacheBudget {
        max_batches: 3,
        ..JitCacheBudget::DEFAULT
    });
    m.hart_mut().regs.write(1, 0);
    m.hart_mut().regs.pc = BASE;
    // Run forward through all segments repeatedly; installs continually create new batches.
    for _ in 0..4 {
        m.hart_mut().regs.pc = BASE;
        m.run(segs * 3 + 50);
        let s = m.jit_cache_stats();
        assert!(
            s.batches <= s.budget.max_batches,
            "live batches {} exceeded budget {}",
            s.batches,
            s.budget.max_batches
        );
    }
    let s = m.jit_cache_stats();
    assert!(s.evictions > 0, "budget churn must have evicted something");
    assert!(
        m.jit_registry().0 <= 3,
        "registry batch count over budget: {}",
        m.jit_registry().0
    );
    eprintln!(
        "budget cap held: batches={} evictions={} installs={} retranslations={}",
        s.batches, s.evictions, s.installs, s.retranslations
    );
}
