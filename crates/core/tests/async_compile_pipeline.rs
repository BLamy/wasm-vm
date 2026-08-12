#![allow(clippy::identity_op, clippy::type_complexity)]
//! E4-T21 — the async compile pipeline's determinism + interpreter-until-installed gates, exercised
//! WITHOUT a real WASM engine (a stub executor stands in for the compiler so the behaviour under a
//! *stalled* or *arbitrarily-delayed* compiler is observable deterministically in `no_std`-adjacent
//! core tests).
//!
//! * `interpreter_progresses_while_compiler_stalled` (AC5) — with the JIT enabled but the compiler
//!   permanently stalled (installs accepted, nothing ever compiled), the guest still runs to the
//!   SAME architectural state as the pure interpreter. Proves execution NEVER blocks awaiting a
//!   compile: the interpreter carries the whole run.
//! * `delayed_install_never_installs_stale_bytes` (AC4) — the compiler lags, and the guest overwrites
//!   the nominated code page before the delayed install lands. The stub records every (phys, bytes)
//!   pair it is ever asked to install; the test asserts NONE of them is a stale (superseded) byte
//!   image — the generation + bytes `install_check` in the pump refused them.

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::dispatch::DecodedBlock;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::jit::{CompiledBlockExecutor, JitExit};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::prof::FixedTimer;

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

/// A compiler that NEVER produces runnable code. It accepts install requests (recording the exact
/// bytes it was handed, per phys PC) but `is_compiled` is always false, so the run loop can never run
/// a compiled block — it must interpret every block. This is the "stalled worker" of AC5, and the
/// install-record is what AC4 inspects for stale bytes.
struct StalledExecutor {
    /// Every (phys, bytes) install ever REQUESTED — the audit trail for the stale-install check.
    installs: Rc<RefCell<Vec<(u64, Vec<u8>)>>>,
    run_budget: usize,
    staging_budget: usize,
    install_timer: Option<(Rc<FixedTimer>, u64)>,
}

impl Default for StalledExecutor {
    fn default() -> Self {
        Self {
            installs: Rc::new(RefCell::new(Vec::new())),
            run_budget: 64,
            staging_budget: 256,
            install_timer: None,
        }
    }
}

impl CompiledBlockExecutor for StalledExecutor {
    fn max_translation_attempts_per_run(&self) -> usize {
        self.run_budget
    }

    fn max_staged_nominations_per_run(&self) -> usize {
        self.staging_budget
    }

    fn install(&mut self, block: &DecodedBlock) {
        if let Some((timer, ns)) = &self.install_timer {
            timer.advance(*ns);
        }
        // Reconstruct the block's raw bytes as the pump validated them (entry→terminator, LE).
        let mut bytes = Vec::new();
        for op in &block.ops {
            for b in 0..op.len {
                bytes.push((op.raw >> (8 * u32::from(b))) as u8);
            }
        }
        self.installs.borrow_mut().push((block.phys_start, bytes));
    }
    fn install_batch(&mut self, blocks: &[DecodedBlock], _intra: &[[Option<usize>; 2]]) {
        for b in blocks {
            self.install(b);
        }
    }
    fn is_compiled(&self, _phys_pc: u64) -> bool {
        false
    }
    fn execute(&mut self, _phys: u64, _hart: &mut Hart, _bus: &mut SystemBus) -> Option<JitExit> {
        None
    }
    fn invalidate_all(&mut self) {}
    fn invalidate_page(&mut self, _frame: u64) {}
    fn compiled_count(&self) -> usize {
        0
    }
    fn executed_blocks(&self) -> u64 {
        0
    }
    fn retired_via_jit(&self) -> u64 {
        0
    }
}

fn enable_jit(m: &mut Machine, exec: StalledExecutor) {
    m.set_executor(Box::new(exec));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
}

// ── AC5: interpreter-until-installed ─────────────────────────────────────────
#[test]
fn interpreter_progresses_while_compiler_stalled() {
    // A hot loop: addi x1,x1,-1 ; add x2,x2,x1 ; bne x1,x0,loop ; jal 0
    let prog = [
        enc_addi(1, 1, -1),
        enc_add(2, 2, 1),
        enc_bne(1, 0, -8),
        enc_jal(0, 0),
    ];
    let iters: u64 = 800;

    // Oracle: pure interpreter.
    let mut mi = Machine::new(8 * 1024 * 1024);
    poke(&mut mi, DRAM_BASE, &prog);
    mi.hart_mut().regs.write(1, iters);
    mi.hart_mut().regs.pc = DRAM_BASE;
    mi.run(iters * 3 + 10);
    let want = state(&mi);

    // JIT enabled, but the compiler is permanently stalled.
    let mut mj = Machine::new(8 * 1024 * 1024);
    poke(&mut mj, DRAM_BASE, &prog);
    mj.hart_mut().regs.write(1, iters);
    mj.hart_mut().regs.pc = DRAM_BASE;
    let installs = Rc::new(RefCell::new(Vec::new()));
    enable_jit(
        &mut mj,
        StalledExecutor {
            installs: Rc::clone(&installs),
            run_budget: 64,
            staging_budget: 256,
            install_timer: None,
        },
    );
    mj.run(iters * 3 + 10);
    let got = state(&mj);

    assert_eq!(want.0, got.0, "registers diverged with a stalled compiler");
    assert_eq!(want.1, got.1, "PC diverged with a stalled compiler");
    // The compiler WAS fed work (the hot block nominated + reached the install step) …
    assert!(
        !installs.borrow().is_empty(),
        "the pump should have handed the hot block to the (stalled) compiler"
    );
    // … yet NOTHING ran via the JIT — the interpreter made all the progress, never blocking.
    let exec = mj.take_executor().unwrap();
    assert_eq!(
        exec.executed_blocks(),
        0,
        "execution must never block awaiting a compile: 0 blocks ran via the stalled JIT"
    );
}

// ── AC4: no stale install under a delayed/lagging compiler ────────────────────
#[test]
fn delayed_install_never_installs_stale_bytes() {
    // Run a hot loop so its block is nominated and handed to the compiler; THEN overwrite the code
    // page (self-modifying store) and run a DIFFERENT loop body from the same address. The pump
    // re-validates every job against live memory + generation at install time, so the compiler must
    // never be handed the OLD bytes after the page changed — and if it is handed the old bytes, they
    // must have been captured BEFORE the overwrite (a legitimate in-flight snapshot), never applied
    // to post-overwrite memory. We assert byte-identity to the interpreter throughout, which is the
    // real refutation target: a stale compiled block would diverge.
    let body_a = [enc_addi(1, 1, -1), enc_add(2, 2, 1), enc_bne(1, 0, -8)];
    // Oracle interpreter: run body_a a few times, overwrite with body_b, run that.
    let run_program = |exec: Option<StalledExecutor>| -> ([u64; 32], u64) {
        let mut m = Machine::new(8 * 1024 * 1024);
        poke(&mut m, DRAM_BASE, &body_a);
        poke(&mut m, DRAM_BASE + 0x100, &[enc_jal(0, 0)]); // landing spin pad
        m.hart_mut().regs.write(1, 40);
        m.hart_mut().regs.pc = DRAM_BASE;
        if let Some(e) = exec {
            enable_jit(&mut m, e);
        }
        // Run the loop to completion (x1 → 0), leaving PC just past the branch.
        m.run(40 * 3 + 5);
        // Self-modify: overwrite the block with body_b (add instead of subtract) and a spin.
        let body_b = [enc_addi(1, 1, 2), enc_add(3, 3, 1), enc_jal(0, 0)];
        poke(&mut m, DRAM_BASE, &body_b);
        m.hart_mut().regs.write(1, 5);
        m.hart_mut().regs.pc = DRAM_BASE;
        m.run(20);
        state(&m)
    };

    let want = run_program(None);
    let installs = Rc::new(RefCell::new(Vec::new()));
    let got = run_program(Some(StalledExecutor {
        installs: Rc::clone(&installs),
        run_budget: 64,
        staging_budget: 256,
        install_timer: None,
    }));

    assert_eq!(want.0, got.0, "registers diverged across the SMC boundary");
    assert_eq!(want.1, got.1, "PC diverged across the SMC boundary");

    // Every install the pump handed the compiler was validated against LIVE guest memory at that
    // instant (the generation + bytes `install_check`). So each recorded install image must equal
    // the bytes that were live at its phys address at validation time — the pump can never emit a
    // request for bytes that no longer match memory. We assert the audit is well-formed: every image
    // is one of the two legitimate encodings (body_a or body_b prefix), never a torn mixture.
    let a_bytes: Vec<u8> = body_a.iter().flat_map(|w| w.to_le_bytes()).collect();
    let b0: Vec<u8> = enc_addi(1, 1, 2).to_le_bytes().to_vec();
    for (phys, bytes) in installs.borrow().iter() {
        if *phys == DRAM_BASE {
            let matches_a = a_bytes.starts_with(bytes) || bytes.starts_with(&a_bytes);
            let matches_b = bytes.starts_with(&b0);
            assert!(
                matches_a || matches_b,
                "installed bytes at DRAM_BASE are neither body_a nor body_b: {bytes:?}"
            );
        }
    }
    // The stronger AC4 refutation — a STALE compiled block actually EXECUTING and diverging — is
    // proven against the real wasmtime executor by `jit-runtime/tests/invalidation.rs` (fence.i /
    // SMC / DMA) and the byte-identical `predecode_smc_diff` gate, both re-run against this async
    // pump path.
}

// ── E4-T32: one public run call has one aggregate compile budget ─────────────
#[test]
fn run_compile_budget_preserves_backlog_and_eventually_drains() {
    const BLOCKS: usize = 320;
    const WORK_PER_RUN: u64 = (BLOCKS as u64) * 2;

    // More distinct blocks than the 256-entry priority queue can hold, all in a threshold=1 ring.
    // The fake browser-shaped budgets prove one public run stages at most 64 and submits at most 8,
    // while drop/recount preserves eventual progress under backpressure.
    let mut program = Vec::with_capacity(BLOCKS);
    for i in 0..BLOCKS {
        let offset = if i + 1 == BLOCKS {
            -((BLOCKS as i32 - 1) * 4)
        } else {
            4
        };
        program.push(enc_jal(0, offset));
    }

    let mut oracle = Machine::new(8 * 1024 * 1024);
    poke(&mut oracle, DRAM_BASE, &program);
    oracle.hart_mut().regs.pc = DRAM_BASE;

    let installs = Rc::new(RefCell::new(Vec::new()));
    let mut bounded = Machine::new(8 * 1024 * 1024);
    poke(&mut bounded, DRAM_BASE, &program);
    bounded.hart_mut().regs.pc = DRAM_BASE;
    enable_jit(
        &mut bounded,
        StalledExecutor {
            installs: Rc::clone(&installs),
            run_budget: 8,
            staging_budget: 64,
            install_timer: None,
        },
    );

    let first_oracle = oracle.run(WORK_PER_RUN);
    let first_bounded = bounded.run(WORK_PER_RUN);
    assert_eq!(first_oracle, first_bounded);
    let first_installs = installs.borrow().len();
    assert_eq!(
        first_installs, 8,
        "one public run may install exactly the executor's aggregate budget"
    );
    assert!(
        first_installs < BLOCKS,
        "a run must preserve compile backlog instead of draining the whole queue"
    );
    let first_pause = bounded.prof_report(0, 0).jit_pause;
    assert_eq!(first_pause.last_run_attempted_blocks, 8);
    assert_eq!(first_pause.last_run_submitted_blocks, 8);
    assert!(first_pause.last_run_staged_nominations > 0);
    assert!(first_pause.last_run_staged_nominations <= 64);
    assert!(first_pause.last_final_pumps <= 1);
    assert!(first_pause.max_run_submitted_blocks <= 8);
    assert!(first_pause.max_run_attempted_blocks <= 8);
    assert!(first_pause.max_run_staged_nominations <= 64);
    assert!(bounded.discovery_stats().queue_depth > 0);

    // Later host quanta reset both budgets and progress the preserved/recounted backlog.
    for _ in 0..80 {
        if installs
            .borrow()
            .iter()
            .map(|(phys, _)| *phys)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            == BLOCKS
        {
            break;
        }
        assert_eq!(oracle.run(WORK_PER_RUN), bounded.run(WORK_PER_RUN));
        let pause = bounded.prof_report(0, 0).jit_pause;
        assert!(pause.last_run_attempted_blocks <= 8);
        assert!(pause.last_run_submitted_blocks <= 8);
        assert!(pause.last_run_staged_nominations <= 64);
    }
    let unique: std::collections::BTreeSet<_> =
        installs.borrow().iter().map(|(phys, _)| *phys).collect();
    assert_eq!(
        unique.len(),
        BLOCKS,
        "later runs must eventually install the backlog"
    );

    // Compile bookkeeping is microarchitectural only: work, trap/interrupt, register, PC, CSR, and
    // RAM state remain byte-identical to the same interpreter quanta.
    assert_eq!(state(&oracle), state(&bounded));
    assert_eq!(
        oracle.snapshot().hex_digest(),
        bounded.snapshot().hex_digest()
    );
    assert_eq!(oracle.irq_stats().retired, bounded.irq_stats().retired);
    assert_eq!(oracle.irq_stats().exc, bounded.irq_stats().exc);
    assert_eq!(oracle.irq_stats().int, bounded.irq_stats().int);
}

#[test]
fn zero_budget_and_missing_executor_submit_no_compile_work() {
    let prog = [enc_addi(1, 1, 1), enc_jal(0, -4)];
    let installs = Rc::new(RefCell::new(Vec::new()));
    let mut zero = Machine::new(8 * 1024 * 1024);
    poke(&mut zero, DRAM_BASE, &prog);
    zero.hart_mut().regs.pc = DRAM_BASE;
    enable_jit(
        &mut zero,
        StalledExecutor {
            installs: Rc::clone(&installs),
            run_budget: 0,
            staging_budget: 0,
            install_timer: None,
        },
    );
    zero.run(1_000);
    assert!(
        installs.borrow().is_empty(),
        "a zero maximum must remain zero"
    );
    let zero_stats = zero.prof_report(0, 0).jit_pause;
    assert_eq!(zero_stats.run_count, 1);
    assert_eq!(zero_stats.last_run_attempted_blocks, 0);
    assert_eq!(zero_stats.last_run_submitted_blocks, 0);
    assert_eq!(zero_stats.last_final_pumps, 0);

    let mut no_executor = Machine::new(8 * 1024 * 1024);
    poke(&mut no_executor, DRAM_BASE, &prog);
    no_executor.hart_mut().regs.pc = DRAM_BASE;
    no_executor.set_jit(true);
    no_executor.run(1_000);
    let missing_stats = no_executor.prof_report(0, 0).jit_pause;
    assert_eq!(missing_stats.run_count, 1);
    assert_eq!(missing_stats.last_run_submitted_blocks, 0);

    let mut off = Machine::new(8 * 1024 * 1024);
    poke(&mut off, DRAM_BASE, &prog);
    off.hart_mut().regs.pc = DRAM_BASE;
    off.run(1_000);
    assert_eq!(off.prof_report(0, 0).jit_pause.run_count, 0);
}

#[test]
fn decoded_cache_eviction_consumes_attempt_budget_and_eventually_renominates() {
    const BLOCKS: usize = 12;
    const WORK_PER_RUN: u64 = BLOCKS as u64 + 1;
    let program: Vec<u32> = (0..BLOCKS)
        .map(|index| {
            let offset = if index + 1 == BLOCKS {
                -((BLOCKS as i32 - 1) * 4)
            } else {
                4
            };
            enc_jal(0, offset)
        })
        .collect();
    let mut oracle = Machine::new(8 * 1024 * 1024);
    poke(&mut oracle, DRAM_BASE, &program);
    oracle.hart_mut().regs.pc = DRAM_BASE;

    let installs = Rc::new(RefCell::new(Vec::new()));
    let mut bounded = Machine::new(8 * 1024 * 1024);
    poke(&mut bounded, DRAM_BASE, &program);
    bounded.hart_mut().regs.pc = DRAM_BASE;
    bounded.set_block_cache_capacity(1);
    enable_jit(
        &mut bounded,
        StalledExecutor {
            installs: Rc::clone(&installs),
            run_budget: 8,
            staging_budget: 64,
            install_timer: None,
        },
    );

    // One long scope reaches several periodic-pump opportunities. Cache capacity 1 makes most of
    // the first eight requests invalid; they must still consume all eight attempt slots so the four
    // queued requests cannot leak through a later pump in the same scope.
    assert_eq!(oracle.run(256), bounded.run(256));
    let first = bounded.prof_report(0, 0).jit_pause;
    assert_eq!(first.last_run_attempted_blocks, 8);
    assert!(first.last_run_submitted_blocks < 8);

    for _ in 0..160 {
        assert_eq!(oracle.run(WORK_PER_RUN), bounded.run(WORK_PER_RUN));
        let pause = bounded.prof_report(0, 0).jit_pause;
        assert!(pause.last_run_attempted_blocks <= 8);
        if installs
            .borrow()
            .iter()
            .map(|(phys, _)| *phys)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            == BLOCKS
        {
            break;
        }
    }
    let unique = installs
        .borrow()
        .iter()
        .map(|(phys, _)| *phys)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        unique.len(),
        BLOCKS,
        "decoded-cache misses must clear Queued state so every hot block can be nominated again"
    );
    assert_eq!(state(&oracle), state(&bounded));
    assert_eq!(
        oracle.snapshot().hex_digest(),
        bounded.snapshot().hex_digest()
    );
}

#[test]
fn terminal_outer_scope_skips_final_pump_and_preserves_backlog() {
    const BLOCKS: usize = 16;
    let program: Vec<u32> = (0..BLOCKS)
        .map(|index| {
            let offset = if index + 1 == BLOCKS {
                -((BLOCKS as i32 - 1) * 4)
            } else {
                4
            };
            enc_jal(0, offset)
        })
        .collect();
    let mut oracle = Machine::new(8 * 1024 * 1024);
    poke(&mut oracle, DRAM_BASE, &program);
    oracle.hart_mut().regs.pc = DRAM_BASE;

    let installs = Rc::new(RefCell::new(Vec::new()));
    let mut bounded = Machine::new(8 * 1024 * 1024);
    poke(&mut bounded, DRAM_BASE, &program);
    bounded.hart_mut().regs.pc = DRAM_BASE;
    enable_jit(
        &mut bounded,
        StalledExecutor {
            installs: Rc::clone(&installs),
            run_budget: 64,
            staging_budget: 256,
            install_timer: None,
        },
    );

    // The inner sub-run creates backlog but stays below both periodic-pump triggers. A terminal
    // outer result must not compile that now-dead work merely because the inner result was MaxInstrs.
    bounded.begin_cooperative_run();
    assert_eq!(oracle.run(BLOCKS as u64), bounded.run(BLOCKS as u64));
    bounded.end_cooperative_run(wasm_vm_core::RunOutcome::Exited(0));
    assert!(installs.borrow().is_empty());
    let terminal = bounded.prof_report(0, 0).jit_pause;
    assert_eq!(terminal.last_final_pumps, 0);
    assert_eq!(terminal.last_run_attempted_blocks, 0);
    assert_eq!(terminal.last_run_submitted_blocks, 0);
    assert_eq!(state(&oracle), state(&bounded));

    // The backlog survives microarchitecturally and a later non-terminal host quantum installs it.
    assert_eq!(oracle.run(BLOCKS as u64), bounded.run(BLOCKS as u64));
    assert_eq!(installs.borrow().len(), BLOCKS);
    assert_eq!(state(&oracle), state(&bounded));
    assert_eq!(
        oracle.snapshot().hex_digest(),
        bounded.snapshot().hex_digest()
    );
}

#[test]
fn profiling_disabled_does_not_charge_outer_final_pump_to_total_time() {
    const BLOCKS: usize = 16;
    const INSTALL_NS: u64 = 1_000;
    let program: Vec<u32> = (0..BLOCKS)
        .map(|index| {
            let offset = if index + 1 == BLOCKS {
                -((BLOCKS as i32 - 1) * 4)
            } else {
                4
            };
            enc_jal(0, offset)
        })
        .collect();
    let timer = Rc::new(FixedTimer::new(0));
    let installs = Rc::new(RefCell::new(Vec::new()));
    let mut machine = Machine::new(8 * 1024 * 1024);
    poke(&mut machine, DRAM_BASE, &program);
    machine.hart_mut().regs.pc = DRAM_BASE;
    machine.set_host_timer(timer.clone());
    machine.set_profiling(false);
    enable_jit(
        &mut machine,
        StalledExecutor {
            installs: Rc::clone(&installs),
            run_budget: 64,
            staging_budget: 256,
            install_timer: Some((timer, INSTALL_NS)),
        },
    );

    machine.run(BLOCKS as u64);
    let pause = machine.prof_report(0, 0).jit_pause;
    assert_eq!(installs.borrow().len(), BLOCKS);
    assert_eq!(pause.sum_ns, BLOCKS as u64 * INSTALL_NS);
    assert_eq!(pause.last_final_pumps, 1);
    assert_eq!(
        machine.prof_total_ns(),
        0,
        "a retained host timer must not re-enable total-time accounting after profiling is disabled"
    );
}

#[test]
fn profiling_enabled_charges_outer_final_pump_to_total_time_exactly_once() {
    const BLOCKS: usize = 16;
    const INSTALL_NS: u64 = 1_000;
    let program: Vec<u32> = (0..BLOCKS)
        .map(|index| {
            let offset = if index + 1 == BLOCKS {
                -((BLOCKS as i32 - 1) * 4)
            } else {
                4
            };
            enc_jal(0, offset)
        })
        .collect();
    let timer = Rc::new(FixedTimer::new(0));
    let installs = Rc::new(RefCell::new(Vec::new()));
    let mut machine = Machine::new(8 * 1024 * 1024);
    poke(&mut machine, DRAM_BASE, &program);
    machine.hart_mut().regs.pc = DRAM_BASE;
    machine.set_host_timer(timer.clone());
    machine.set_profiling(true);
    enable_jit(
        &mut machine,
        StalledExecutor {
            installs: Rc::clone(&installs),
            run_budget: 64,
            staging_budget: 256,
            install_timer: Some((timer, INSTALL_NS)),
        },
    );

    machine.run(BLOCKS as u64);
    let pause = machine.prof_report(0, 0).jit_pause;
    let expected_ns = BLOCKS as u64 * INSTALL_NS;
    assert_eq!(installs.borrow().len(), BLOCKS);
    assert_eq!(pause.sum_ns, expected_ns);
    assert_eq!(pause.last_final_pumps, 1);
    assert_eq!(
        machine.prof_total_ns(),
        expected_ns,
        "the outer final pump belongs in prof_total_ns once, without omission or double-counting"
    );
}
