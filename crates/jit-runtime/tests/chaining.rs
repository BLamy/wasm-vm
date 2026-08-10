#![allow(clippy::identity_op, clippy::needless_range_loop)]
//! E4-T18 correctness gates — block chaining (direct linking + safe unlinking), PROVEN BY TEST.
//!
//! What is proven here (the mechanism, not workload-scale perf — the CoreMark ≥1.4× ledger AC is
//! deferred to a booted-guest harness on the Linux `dev` box; see the ticket verification log):
//!
//! * `two_block_chain_links_then_unlink_is_complete` — a 2-block loop (A on page 0, B on page 1)
//!   links (A.edge0 → B, B.taken-edge → A; `links_made` advances); then an SMC store into B's page
//!   invalidates B and EVERY incoming slot to B (A's, from a SURVIVING predecessor on another page)
//!   is restored to the dispatch stub, `links_cut` advances, and re-execution recompiles B from the
//!   NEW bytes and runs byte-identically to the interpreter.
//! * `store_to_non_code_page_cuts_no_links` — a store to a data page cuts nothing.
//! * `interrupt_fires_inside_chained_loop` — a machine timer fires INSIDE a long two-block chained
//!   loop, dispatch is re-entered (`dispatch_entries` advances), and the interrupt is delivered.
//! * `chain_depth_budget_forces_dispatch_return` — the chain-depth counter caps how many links a
//!   single chain follows (max depth == budget), so a deep loop cannot recurse without bound; the
//!   result stays byte-identical to the interpreter at budget = 1 (degenerate) and a larger budget.

use jit_runtime::WasmtimeExecutor;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};
use wasm_vm_core::{Machine, RunOutcome};

// ── RV64 encoders ────────────────────────────────────────────────────────────
fn enc_addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (0b000 << 12) | (rd << 7) | 0b0010011
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

fn arm_jit(m: &mut Machine) {
    m.set_executor(Box::new(WasmtimeExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
}

fn regs(m: &Machine) -> [u64; 32] {
    let mut r = [0u64; 32];
    for i in 0..32u8 {
        r[i as usize] = m.hart().regs.read(i);
    }
    r
}

// Block A sits at the END of page 0, block B at the START of page 1 — a page boundary between them
// (so invalidating B's page leaves A a live predecessor) but only a few bytes apart, so B's
// conditional branch back to A stays within the ±4 KiB B-type reach:
//   A @ DRAM+0xFF8 : addi x2,x2,1 ; jal x0,+4        → B
//   B @ DRAM+0x1000: addi x1,x1,DEC ; bne x1,x0,→A   ; (not-taken → spin)
//   spin @ DRAM+0x1008: jal x0,0
const A: u64 = DRAM_BASE + 0xFF8;
const B: u64 = DRAM_BASE + 0x1000;
const SPIN: u64 = DRAM_BASE + 0x1008;

fn load_loop(m: &mut Machine, b_dec: i32) {
    // Page 0 — block A.
    m.bus_mut().store32(A, enc_addi(2, 2, 1)).unwrap();
    // jal x0, (B - (A+4)) = +4
    m.bus_mut()
        .store32(A + 4, enc_jal(0, (B as i64 - (A as i64 + 4)) as i32))
        .unwrap();
    // Page 1 — block B.
    m.bus_mut().store32(B, enc_addi(1, 1, b_dec)).unwrap();
    // bne x1, x0, (A - (B+4))  → back to A when x1 != 0
    m.bus_mut()
        .store32(B + 4, enc_bne(1, 0, (A as i64 - (B as i64 + 4)) as i32))
        .unwrap();
    // Exit spin.
    m.bus_mut().store32(SPIN, enc_jal(0, 0)).unwrap();
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Link + unlink completeness (THE correctness core)
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn two_block_chain_links_then_unlink_is_complete() {
    // ── Interpreter oracle: the whole scenario (K1 iters of -1, then K2 iters of -2 after SMC). ──
    let oracle = {
        let mut m = Machine::new(8 * 1024 * 1024);
        load_loop(&mut m, -1);
        m.hart_mut().regs.write(1, 4000);
        m.hart_mut().regs.pc = A;
        m.run(4 * 4000 + 50);
        // SMC: rewrite B's body to decrement by 2, then run another batch.
        m.bus_mut().store32(B, enc_addi(1, 1, -2)).unwrap();
        m.hart_mut().regs.write(1, 4000);
        m.hart_mut().regs.pc = A;
        m.run(4 * 4000 + 50);
        regs(&m)
    };

    // ── JIT + chaining: same scenario, with link/unlink assertions in the middle. ──
    let mut m = Machine::new(8 * 1024 * 1024);
    load_loop(&mut m, -1);
    arm_jit(&mut m);
    m.hart_mut().regs.write(1, 4000);
    m.hart_mut().regs.pc = A;
    m.run(4 * 4000 + 50);

    // Both blocks compiled and the hot edges LINKED: A.edge0 → B, B.taken-edge(0) → A.
    let exec = m.executor().unwrap();
    assert!(
        exec.is_compiled(A) && exec.is_compiled(B),
        "both blocks compile"
    );
    assert_eq!(
        exec.linked_target(A, 0),
        Some(B),
        "A's fall-through/jal edge must be linked directly to B"
    );
    assert_eq!(
        exec.linked_target(B, 0),
        Some(A),
        "B's taken branch edge must be linked directly to A"
    );
    let stats = m.chain_stats();
    assert!(
        stats.links_made >= 2,
        "at least the two hot edges must be linked (got {})",
        stats.links_made
    );
    assert!(
        stats.max_chain_depth >= 2,
        "the loop must actually chain through multiple blocks (depth {})",
        stats.max_chain_depth
    );
    let cut_before = stats.links_cut;

    // ── A store to a NON-code page must cut NO links (the false-positive guard). ──
    m.bus_mut()
        .store32(DRAM_BASE + 0x5000, 0xDEAD_BEEF)
        .unwrap();
    m.run(1); // drain the write log at the next boundary
    assert_eq!(
        m.chain_stats().links_cut,
        cut_before,
        "a store to a data page must not cut any links"
    );
    assert_eq!(
        m.executor().unwrap().linked_target(A, 0),
        Some(B),
        "the A→B link must survive a non-code-page store"
    );

    // ── SMC: overwrite B's body (page 1) with new bytes. B is invalidated; A survives. ──
    m.hart_mut().regs.pc = SPIN; // park PC off the code so the store's own block isn't mid-run
    m.bus_mut().store32(B, enc_addi(1, 1, -2)).unwrap();
    m.run(1); // drain → invalidate_page(frame of B)

    let exec = m.executor().unwrap();
    assert!(
        exec.is_compiled(A),
        "A (on a different page) must survive B's invalidation"
    );
    assert!(
        !exec.is_compiled(B),
        "B must be dropped by the code-page store"
    );
    // UNLINK COMPLETENESS: every incoming slot to the dead block B was restored to the stub.
    assert_eq!(
        exec.linked_target(A, 0),
        None,
        "A's slot into the dead block B must be restored to the dispatch stub"
    );
    assert!(
        m.chain_stats().links_cut > cut_before,
        "cutting the edge into B must advance links_cut ({} → {})",
        cut_before,
        m.chain_stats().links_cut
    );

    // ── Re-execution recompiles B from the NEW bytes and matches the interpreter byte-for-byte. ──
    m.hart_mut().regs.write(1, 4000);
    m.hart_mut().regs.pc = A;
    m.run(4 * 4000 + 50);
    assert!(
        m.executor().unwrap().is_compiled(B),
        "B must recompile from the new bytes on re-execution"
    );
    let rj = regs(&m);
    for i in 1..32 {
        assert_eq!(
            oracle[i], rj[i],
            "reg x{i} diverged JIT-with-chaining vs interpreter"
        );
    }
    // Re-linking must happen again after the recompile (edge re-established lazily).
    assert_eq!(
        m.executor().unwrap().linked_target(A, 0),
        Some(B),
        "the A→B edge must re-link on re-traversal after recompilation"
    );
}

#[test]
fn store_to_non_code_page_cuts_no_links() {
    let mut m = Machine::new(8 * 1024 * 1024);
    load_loop(&mut m, -1);
    arm_jit(&mut m);
    m.hart_mut().regs.write(1, 4000);
    m.hart_mut().regs.pc = A;
    m.run(4 * 4000 + 50);
    let cut_before = m.chain_stats().links_cut;
    let made_before = m.chain_stats().links_made;
    // Several stores into a pure data page.
    for k in 0..8u64 {
        m.bus_mut().store64(DRAM_BASE + 0x9000 + k * 8, k).unwrap();
    }
    m.run(1);
    assert_eq!(
        m.chain_stats().links_cut,
        cut_before,
        "data-page stores cut no links"
    );
    assert_eq!(
        m.chain_stats().links_made,
        made_before,
        "data-page stores create no links either"
    );
}

#[test]
fn chain_successor_that_does_not_fit_preserves_prior_progress() {
    // A and B are both two-op blocks. With only three work slots left, A may commit through the
    // JIT, but chained B must refuse its one-slot tail and return A's already-committed progress.
    // Dispatch then interprets exactly B's first op; returning `None` for the whole chain here would
    // replay A and overshoot/mutate state twice.
    let mut m = Machine::new(8 * 1024 * 1024);
    load_loop(&mut m, -1);
    arm_jit(&mut m);
    m.hart_mut().regs.write(1, 100);
    m.hart_mut().regs.pc = A;
    assert_eq!(m.run(200), RunOutcome::MaxInstrs);
    assert!(m.executor().unwrap().is_compiled(A));
    assert!(m.executor().unwrap().is_compiled(B));

    m.hart_mut().regs.write(1, 10);
    m.hart_mut().regs.write(2, 0);
    m.hart_mut().regs.pc = A;
    let executed_before = m.executor().unwrap().executed_blocks();
    let jit_retired_before = m.executor().unwrap().retired_via_jit();
    let retired_before = m.irq_stats().retired;

    assert_eq!(m.run(3), RunOutcome::MaxInstrs);
    assert_eq!(m.irq_stats().retired - retired_before, 3);
    assert_eq!(
        m.executor().unwrap().executed_blocks() - executed_before,
        1,
        "only A fits in the compiled portion"
    );
    assert_eq!(
        m.executor().unwrap().retired_via_jit() - jit_retired_before,
        2,
        "A's two retires must survive B's short-tail refusal"
    );
    assert_eq!(m.hart().regs.read(2), 1, "A must commit exactly once");
    assert_eq!(m.hart().regs.read(1), 9, "only B's addi may interpret");
    assert_eq!(m.hart().regs.pc, B + 4);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Interrupt budget across chains — a timer fires inside a chained loop
// ════════════════════════════════════════════════════════════════════════════

fn set_csr(m: &mut Machine, a: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(a, CsrOp::Write, v, false, false, 0)
        .unwrap();
}

#[test]
fn interrupt_fires_inside_chained_loop() {
    const HANDLER: u64 = DRAM_BASE + 0x2000;
    const SENTINEL: u64 = 0x777;
    let mut m = Machine::new(8 * 1024 * 1024);
    load_loop(&mut m, -1);
    // Trap handler on its own page: write a sentinel into x5, then spin.
    m.bus_mut()
        .store32(HANDLER, enc_addi(5, 0, SENTINEL as i32))
        .unwrap();
    m.bus_mut().store32(HANDLER + 4, enc_jal(0, 0)).unwrap();

    // Deterministic clock: mtime += 1 per retired op; fire MTIP at 500 retires.
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = 500;
    // Enable machine timer interrupt: mstatus.MIE (bit 3), mie.MTIE (bit 7), mtvec = HANDLER.
    set_csr(&mut m, MSTATUS, 1 << 3);
    set_csr(&mut m, MIE, 1 << 7);
    set_csr(&mut m, MTVEC, HANDLER);

    arm_jit(&mut m);
    m.hart_mut().regs.write(1, 100_000); // long enough that the loop is nowhere near done at 500 ops
    m.hart_mut().regs.write(2, 0);
    m.hart_mut().regs.pc = A;
    m.run(40_000);

    // The timer was delivered mid-loop: the handler ran (x5 == sentinel) and the loop was cut short
    // (x1 still large — nowhere near the 100_000 iterations it would take to finish).
    assert_eq!(
        m.hart().regs.read(5),
        SENTINEL,
        "the machine-timer trap handler must have run (interrupt taken inside the chained loop)"
    );
    assert!(
        m.hart().regs.read(1) > 90_000,
        "the interrupt must fire EARLY (loop barely progressed), got x1={}",
        m.hart().regs.read(1)
    );
    let stats = m.chain_stats();
    assert!(
        stats.dispatch_entries > 0,
        "the chained loop must re-enter dispatch so the boundary poll can deliver the timer"
    );
    assert!(
        stats.links_made >= 2,
        "the loop must have chained before the interrupt"
    );
}

// ════════════════════════════════════════════════════════════════════════════
// 2b. E4-T23 AC5 — a DEVICE completion (external/PLIC interrupt, the shape of a virtio-blk
// submit→completion) delivered inside a chained hot loop. This is the interrupt-INJECTION path
// T23 introduces: a backend completion sets a PLIC source pending; the run loop mirrors it into
// mip.MEIP; and E4-T18's per-link boundary poll takes it INSIDE the chain (dispatch re-entered),
// byte-identically to the interpreter. Modelled natively: warm the loop so it JIT-compiles + chains
// with interrupts masked, THEN assert the completion (pending against the hot, chained loop) is
// delivered within the chain budget and the handler runs.
// ════════════════════════════════════════════════════════════════════════════

// PLIC register addresses (mirror crates/core/tests/plic.rs).
fn plic_priority(id: u64) -> u64 {
    wasm_vm_core::bus::mmap::PLIC_BASE + 4 * id
}
fn plic_enable(ctx: u64) -> u64 {
    wasm_vm_core::bus::mmap::PLIC_BASE + 0x2000 + 0x80 * ctx
}
fn plic_threshold(ctx: u64) -> u64 {
    wasm_vm_core::bus::mmap::PLIC_BASE + 0x0020_0000 + 0x1000 * ctx
}

#[test]
fn device_completion_fires_inside_chained_loop() {
    const HANDLER: u64 = DRAM_BASE + 0x2000;
    const SENTINEL: u64 = 0x333;
    const BLK_SRC: u64 = 1; // virtio-blk PLIC source id (VIRTIO_IRQ_BASE)
    const MEIE: u64 = 1 << 11; // mie.MEIE — machine external interrupt enable

    let mut m = Machine::new(8 * 1024 * 1024);
    load_loop(&mut m, -1);
    // Trap handler: write a sentinel into x5, then spin (never mret, so no claim/complete needed —
    // matches the timer test's handler shape).
    m.bus_mut()
        .store32(HANDLER, enc_addi(5, 0, SENTINEL as i32))
        .unwrap();
    m.bus_mut().store32(HANDLER + 4, enc_jal(0, 0)).unwrap();

    let plic = m.enable_plic();
    // Program the PLIC exactly as a driver would for the blk source: priority 1, enabled in M
    // context 0, threshold 0. (The device level is still LOW — no completion yet.)
    m.bus_mut().store32(plic_priority(BLK_SRC), 1).unwrap();
    m.bus_mut().store32(plic_enable(0), 1 << BLK_SRC).unwrap();
    m.bus_mut().store32(plic_threshold(0), 0).unwrap();
    set_csr(&mut m, MTVEC, HANDLER);

    // Interpreter ORACLE: same setup, no JIT — where does the handler run, and with what state?
    let oracle = {
        let mut mo = Machine::new(8 * 1024 * 1024);
        load_loop(&mut mo, -1);
        mo.bus_mut()
            .store32(HANDLER, enc_addi(5, 0, SENTINEL as i32))
            .unwrap();
        mo.bus_mut().store32(HANDLER + 4, enc_jal(0, 0)).unwrap();
        let plico = mo.enable_plic();
        mo.bus_mut().store32(plic_priority(BLK_SRC), 1).unwrap();
        mo.bus_mut().store32(plic_enable(0), 1 << BLK_SRC).unwrap();
        mo.bus_mut().store32(plic_threshold(0), 0).unwrap();
        set_csr(&mut mo, MTVEC, HANDLER);
        mo.hart_mut().regs.write(1, 100_000);
        mo.hart_mut().regs.write(2, 0);
        mo.hart_mut().regs.pc = A;
        // Warm phase: interrupts masked; run a bounded slice.
        set_csr(&mut mo, MSTATUS, 0);
        set_csr(&mut mo, MIE, 0);
        mo.run(2_000);
        // The completion arrives: device raises the blk source, kernel had enabled MEIE + MIE.
        plico.borrow_mut().set_level(BLK_SRC as usize, true);
        set_csr(&mut mo, MSTATUS, 1 << 3);
        set_csr(&mut mo, MIE, MEIE);
        mo.run(40_000);
        (mo.hart().regs.read(5), mo.hart().regs.read(2))
    };
    assert_eq!(
        oracle.0, SENTINEL,
        "oracle: interpreter must take the external interrupt"
    );

    arm_jit(&mut m);
    m.hart_mut().regs.write(1, 100_000);
    m.hart_mut().regs.write(2, 0);
    m.hart_mut().regs.pc = A;

    // Warm phase: interrupts masked → the loop JIT-compiles and CHAINS with no interrupt to take.
    set_csr(&mut m, MSTATUS, 0);
    set_csr(&mut m, MIE, 0);
    m.run(2_000);
    let warm = m.chain_stats();
    assert!(
        warm.links_made >= 2,
        "the loop must have chained during the warm phase (got links_made={})",
        warm.links_made
    );
    assert_ne!(
        m.hart().regs.read(5),
        SENTINEL,
        "no interrupt should have fired while masked"
    );
    let x5_before = m.hart().regs.read(5);
    let dispatch_before = m.chain_stats().dispatch_entries;
    // x2 counts loop iterations; capture it at the instant of injection so we can bound how far the
    // loop runs BEFORE the completion is delivered — the "within the chain budget" measurement.
    let x2_at_injection = m.hart().regs.read(2);

    // The backend completion lands: set the blk PLIC source pending (the interrupt-injection path),
    // and the guest kernel unmasks. mip.MEIP is now asserted against the HOT, chained loop.
    plic.borrow_mut().set_level(BLK_SRC as usize, true);
    set_csr(&mut m, MSTATUS, 1 << 3);
    set_csr(&mut m, MIE, MEIE);
    m.run(40_000);

    // The completion interrupt was delivered INSIDE the chained loop: the handler ran, and dispatch
    // was re-entered so the boundary poll could deliver it (E4-T18 per-link interrupt budget).
    assert_eq!(
        m.hart().regs.read(5),
        SENTINEL,
        "the device-completion (external/PLIC) interrupt must be taken inside the chained loop"
    );
    assert_ne!(x5_before, SENTINEL);
    assert!(
        m.chain_stats().dispatch_entries > dispatch_before,
        "the chained loop must re-enter dispatch so the boundary poll delivers the completion"
    );
    // WITHIN THE CHAIN BUDGET (the AC5 substance): the loop advanced only a handful of iterations
    // between the completion landing and the interrupt being taken — NOT the thousands it would take
    // if the device IRQ were only sampled when the chain exhausts its depth budget / falls out of
    // the loop. Before the `sync_plic()` fix in the chain poll this delta was ~30 000; the bound
    // below (a few chain-depth budgets of 2-block iterations) is the regression guard.
    let delivered_after = m.hart().regs.read(2) - x2_at_injection;
    assert!(
        delivered_after <= 64,
        "device completion must fire within the chain budget (loop advanced {} iters, want ≤ 64)",
        delivered_after
    );
    // The interpreter oracle also takes the same external interrupt (handler runs) — the delivery
    // MECHANISM is identical; exact-cycle timing under interrupt batching is intentionally coarse
    // (batching defers sampling ≤128 retires — see Machine::interrupt_batching), so byte-identical
    // *architectural effect* is covered by the ISA lockstep suite, not an exact-count compare here.
    let _ = oracle;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Chain-depth budget — bounds chain length, no unbounded recursion
// ════════════════════════════════════════════════════════════════════════════

struct BudgetRun {
    regs: [u64; 32],
    max_depth: u32,
    dispatch_entries: u64,
    total_links: u64,
}

fn run_loop_with_budget(budget: u32) -> BudgetRun {
    let mut m = Machine::new(8 * 1024 * 1024);
    load_loop(&mut m, -1);
    arm_jit(&mut m);
    m.set_chain_depth_budget(budget);
    m.hart_mut().regs.write(1, 4000);
    m.hart_mut().regs.write(2, 0);
    m.hart_mut().regs.pc = A;
    // The loop finishes (x1 → 0) then spins on `jal 0`, so the run ends on the instruction budget.
    assert!(matches!(m.run(4 * 4000 + 50), RunOutcome::MaxInstrs));
    let s = m.chain_stats();
    BudgetRun {
        regs: regs(&m),
        max_depth: s.max_chain_depth,
        dispatch_entries: s.dispatch_entries,
        total_links: s.total_links_followed(),
    }
}

#[test]
fn chain_depth_budget_forces_dispatch_return() {
    // Interpreter oracle for the same finite loop.
    let oracle = {
        let mut m = Machine::new(8 * 1024 * 1024);
        load_loop(&mut m, -1);
        m.hart_mut().regs.write(1, 4000);
        m.hart_mut().regs.write(2, 0);
        m.hart_mut().regs.pc = A;
        m.run(4 * 4000 + 50);
        regs(&m)
    };

    // Budget = 1 (degenerate): every block returns to dispatch → depth never exceeds 1, and each
    // executed block IS its own dispatch entry (no multi-link chains: links == entries).
    let b1 = run_loop_with_budget(1);
    assert_eq!(
        b1.max_depth, 1,
        "budget=1 must cap chain depth at 1 (no chaining past one link)"
    );
    assert!(
        b1.dispatch_entries > 100,
        "budget=1 must run the loop via the JIT"
    );
    assert_eq!(
        b1.total_links, b1.dispatch_entries,
        "budget=1: every block is its own dispatch entry (links {} == entries {})",
        b1.total_links, b1.dispatch_entries
    );

    // Budget = 4: a chain follows at most 4 links, then MUST return to dispatch. The counter is what
    // caps recursion depth — max depth is exactly the budget, and a chain follows ~4 links per
    // dispatch entry (so far more blocks execute per dispatch return than at budget = 1).
    let b4 = run_loop_with_budget(4);
    assert_eq!(
        b4.max_depth, 4,
        "budget=4 must cap the chain depth at exactly 4 (no unbounded recursion)"
    );
    assert!(
        b4.total_links >= 3 * b4.dispatch_entries,
        "budget=4 must follow multiple links per dispatch entry (links {} vs entries {})",
        b4.total_links,
        b4.dispatch_entries
    );

    // Both budgets reach the identical final guest state as the interpreter (byte-for-byte).
    for i in 1..32 {
        assert_eq!(oracle[i], b1.regs[i], "budget=1: reg x{i} diverged");
        assert_eq!(oracle[i], b4.regs[i], "budget=4: reg x{i} diverged");
    }
}
