#![allow(clippy::identity_op)]
//! E4-T24 — Timekeeping correctness gates that need the real JIT executor.
//!
//! These are the ticket's headless correctness gates that require the wasmtime executor + the full
//! `Machine` run loop (the pure-policy clamp/slew/jump unit tests live in `wasm-vm-core`'s
//! `time` module):
//!
//! * `icount_two_runs_identical_mtime_trace` (AC5) — two JIT runs of the SAME guest under the
//!   deterministic ICount clock produce BYTE-IDENTICAL instruction-timestamped `mtime` traces AND
//!   deliver the timer interrupt at the IDENTICAL retire index.
//! * `clock_monotonic_never_decreases_under_churn` (AC3) — `mtime` sampled in a tight loop across
//!   mixed JIT / interpreter / eviction churn NEVER decreases.
//! * `icount_lockstep_with_timer_interrupts_byte_identical` (the E4-T25 integration E4-T25 had to
//!   defer) — a run WITH timer interrupts enabled under ICount stays byte-identical between the JIT
//!   master and the shadow interpreter: same final architectural state, same interrupt-fire retire
//!   index, same `mtime`.

use jit_runtime::WasmtimeExecutor;

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};
use wasm_vm_core::jit::{EvictPolicy, JitCacheBudget};

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
fn enc_jal(rd: u32, off: i32) -> u32 {
    let o = off as u32;
    ((o >> 20) & 1) << 31
        | ((o >> 1) & 0x3ff) << 21
        | ((o >> 11) & 1) << 20
        | ((o >> 12) & 0xff) << 12
        | (rd << 7)
        | 0b1101111
}
const MRET: u32 = 0x3020_0073;

fn set_csr(m: &mut Machine, addr: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, CsrOp::Write, v, false, false, 0)
        .unwrap();
}

fn poke(m: &mut Machine, base: u64, words: &[u32]) {
    for (i, w) in words.iter().enumerate() {
        m.bus_mut().store32(base + 4 * i as u64, *w).unwrap();
    }
}

fn arm_jit(m: &mut Machine) {
    m.set_executor(Box::new(WasmtimeExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
}

/// A guest that (a) has a long hot loop the JIT will compile, and (b) takes exactly ONE machine timer
/// interrupt part-way through. The handler disarms the timer (mtimecmp = u64::MAX) and counts into
/// x10, so the interrupt fires once and the run is fully deterministic under the ICount clock.
///
/// `clock_div = 1` ⇒ `mtime == retired`, so the timer crosses `mtimecmp` at a retire index that is a
/// pure function of the program — IDENTICAL under the interpreter and the JIT.
///
/// The guest halts via a syscon poweroff after the loop, so BOTH engines stop at the identical
/// instruction (and hence identical retired count / mtime) — the block-atomic JIT and the
/// instruction-at-a-time interpreter converge on the same terminus rather than on a `run()` budget
/// (which counts dispatch iterations, not instructions, and would let a chained JIT overshoot).
fn build_timer_machine(mtimecmp: u64) -> Machine {
    const HANDLER: u64 = DRAM_BASE + 0x2000;
    const ITERS: u64 = 3000;
    let mut m = Machine::new(16 * 1024 * 1024);
    m.enable_syscon();

    // Hot loop at DRAM_BASE, then a syscon poweroff terminus:
    //   loop: addi x1,x1,-1 ; add x2,x2,x1 ; bne x1,x0,loop
    //   lui x5,0x100 ; lui x6,0x5 ; addi x6,x6,0x555 ; sw x6,0(x5) ; jal x0,0(unreached)
    poke(
        &mut m,
        DRAM_BASE,
        &[
            enc_addi(1, 1, -1),
            enc_add(2, 2, 1),
            enc_bne(1, 0, -8),
            0x0010_02B7,   // lui  x5, 0x100   -> x5 = 0x0010_0000 (syscon TEST_BASE)
            0x0000_5337,   // lui  x6, 0x5     -> x6 = 0x5000
            0x5553_0313,   // addi x6, x6, 0x555 -> x6 = 0x5555 (FINISHER_PASS)
            0x0062_A023,   // sw   x6, 0(x5)   -> poweroff
            enc_jal(0, 0), // unreached spin
        ],
    );
    // Handler: disarm the timer then count.
    //   lui x28,0x2004 ; addi x29,x0,-1 ; sd x29,0(x28) ; addi x10,x10,1 ; mret
    poke(
        &mut m,
        HANDLER,
        &[
            0x0200_4E37, // lui  x28, 0x2004  -> x28 = 0x0200_4000
            0xFFF0_0E93, // addi x29, x0, -1  -> x29 = u64::MAX
            0x01D_E3023, // sd   x29, 0(x28)  -> mtimecmp = u64::MAX (disarm)
            enc_addi(10, 10, 1),
            MRET,
        ],
    );

    let clint = m.enable_clint(1); // clock_div = 1: mtime == retired count
    clint.borrow_mut().mtimecmp = mtimecmp;
    set_csr(&mut m, MTVEC, HANDLER);
    set_csr(&mut m, MIE, 1 << 7); // MTIE
    set_csr(&mut m, MSTATUS, 1 << 3); // mstatus.MIE
    m.hart_mut().regs.write(1, ITERS);
    m.hart_mut().regs.pc = DRAM_BASE;
    m
}

fn arch_state(m: &Machine) -> ([u64; 32], u64) {
    let mut r = [0u64; 32];
    for i in 0..32u8 {
        r[i as usize] = m.hart().regs.read(i);
    }
    (r, m.hart().regs.pc)
}

/// Run `m` for `budget` instructions in `step`-sized chunks, recording an instruction-timestamped
/// `mtime` trace `(retired, mtime)` after every chunk, plus the retire index at which the timer
/// interrupt was first delivered (x10 becomes 1).
fn run_traced_mtime(mut m_owned: Machine, budget: u64, step: u64) -> Traced {
    let mut trace = Vec::new();
    let mut fire_retired = None;
    let mut ran = 0u64;
    while ran < budget {
        m_owned.run(step);
        ran += step;
        let retired = m_owned.irq_stats().retired;
        let mtime = m_owned.clint_mtime();
        trace.push((retired, mtime));
        if fire_retired.is_none() && m_owned.hart().regs.read(10) >= 1 {
            fire_retired = Some(retired);
        }
    }
    Traced {
        trace,
        fire_retired,
        int_timer: m_owned.irq_stats().int[7],
        final_mtime: m_owned.clint_mtime(),
    }
}

struct Traced {
    trace: Vec<(u64, u64)>,
    fire_retired: Option<u64>,
    int_timer: u64,
    final_mtime: u64,
}

// ── AC5: two ICount runs are byte-identical (mtime trace + interrupt boundary) ─
#[test]
fn icount_two_runs_identical_mtime_trace() {
    let mtimecmp = 4000; // fire mid-loop (retired passes 4000 while the loop is hot)
    let budget = 12_000;
    let step = 37; // an odd step so chunk boundaries don't align to block boundaries

    let mut am = build_timer_machine(mtimecmp);
    arm_jit(&mut am);
    let ta = run_traced_mtime(am, budget, step);

    let mut bm = build_timer_machine(mtimecmp);
    arm_jit(&mut bm);
    let tb = run_traced_mtime(bm, budget, step);

    assert_eq!(
        ta.trace, tb.trace,
        "two ICount JIT runs produced DIFFERENT instruction-timestamped mtime traces (nondeterminism)"
    );
    assert_eq!(
        ta.fire_retired, tb.fire_retired,
        "timer interrupt landed at DIFFERENT retire indices across two runs"
    );
    assert!(
        ta.fire_retired.is_some(),
        "the timer interrupt must actually fire in the traced window"
    );
    assert_eq!(ta.int_timer, 1, "exactly one timer interrupt expected");
    eprintln!(
        "AC5: two ICount JIT runs byte-identical — {} trace samples, timer fired at retired={:?}, final mtime={}",
        ta.trace.len(),
        ta.fire_retired,
        ta.final_mtime
    );
}

// ── AC3: CLOCK_MONOTONIC (mtime) never decreases across JIT/interp/eviction churn ─
#[test]
fn clock_monotonic_never_decreases_under_churn() {
    const BASE: u64 = DRAM_BASE;
    // 40 distinct one-block segments walking forward (each: addi x1,x1,1 ; jal +4), then spin. With a
    // tiny JIT budget + K=1 this continually installs and EVICTS batches while the clock advances.
    let segs = 40u64;
    let mut m = Machine::new(64 * 1024 * 1024);
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
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = u64::MAX; // no interrupt; just advance the clock
    arm_jit(&mut m);
    m.set_batch_size(1);
    m.set_evict_policy(EvictPolicy::BatchLru);
    m.set_jit_budget(JitCacheBudget {
        max_batches: 3, // hard cap → continual eviction churn
        ..JitCacheBudget::DEFAULT
    });
    m.hart_mut().regs.pc = BASE;

    let mut last = m.clint_mtime();
    let mut samples = 0u64;
    let mut evicted_seen = false;
    // Tight sampling loop: run a few instructions, read mtime, assert monotone. Re-enter from BASE
    // repeatedly so the walk keeps installing/evicting distinct blocks (mixed JIT + interp + evict).
    for round in 0..600u64 {
        m.hart_mut().regs.pc = BASE;
        for _ in 0..(segs * 2 + 8) {
            m.run(1);
            let now = m.clint_mtime();
            assert!(
                now >= last,
                "mtime DECREASED at round {round}: {now} < {last} (CLOCK_MONOTONIC violated)"
            );
            last = now;
            samples += 1;
        }
        if m.jit_cache_stats().evictions > 0 {
            evicted_seen = true;
        }
    }
    assert!(
        evicted_seen,
        "the churn config never actually evicted — test did not exercise eviction"
    );
    eprintln!(
        "AC3: mtime monotone across {samples} samples of JIT/interp/eviction churn (evictions={}, final mtime={})",
        m.jit_cache_stats().evictions,
        last
    );
}

// ── the E4-T25 integration: ICount lockstep WITH timer interrupts, byte-identical ─
#[test]
fn icount_lockstep_with_timer_interrupts_byte_identical() {
    let mtimecmp = 4000;
    let budget = 20_000;

    // Shadow: pure interpreter (no executor).
    let mut shadow = build_timer_machine(mtimecmp);
    shadow.run(budget);

    // Master: JIT active.
    let mut master = build_timer_machine(mtimecmp);
    arm_jit(&mut master);
    master.run(budget);

    // Byte-identical architectural state.
    assert_eq!(
        arch_state(&shadow).0,
        arch_state(&master).0,
        "registers diverged between shadow interpreter and JIT master under timer interrupts"
    );
    assert_eq!(
        arch_state(&shadow).1,
        arch_state(&master).1,
        "PC diverged between shadow interpreter and JIT master"
    );
    // The timer interrupt was delivered in BOTH, exactly once.
    assert_eq!(
        shadow.irq_stats().int[7],
        1,
        "shadow interpreter must take exactly one timer interrupt"
    );
    assert_eq!(
        master.irq_stats().int[7],
        shadow.irq_stats().int[7],
        "master and shadow disagree on timer-interrupt count"
    );
    // mtime is retire-derived, so it must be identical too.
    assert_eq!(
        shadow.clint_mtime(),
        master.clint_mtime(),
        "mtime diverged between shadow and master (retire clock not byte-identical)"
    );
    assert_eq!(
        shadow.irq_stats().retired,
        master.irq_stats().retired,
        "retire count diverged"
    );

    // Prove the JIT actually executed compiled blocks (this isn't secretly an interpreter run).
    let exec = master.take_executor().unwrap();
    assert!(
        exec.executed_blocks() > 0,
        "the JIT master must have executed compiled blocks"
    );
    eprintln!(
        "E4-T25 integration: ICount lockstep WITH timer interrupts byte-identical — retired={}, mtime={}, timer_ints={}, jit_blocks_exec={}",
        shadow.irq_stats().retired,
        shadow.clint_mtime(),
        shadow.irq_stats().int[7],
        exec.executed_blocks()
    );
}
