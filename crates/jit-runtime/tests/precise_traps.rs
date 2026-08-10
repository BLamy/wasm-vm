#![allow(clippy::identity_op)]
//! E4-T12 correctness gates — precise trap side-exits from compiled blocks.
//!
//! The invariant: a trap raised inside a JIT-executed block must yield EXACTLY the interpreter's
//! precise architectural state — the faulting instruction's PC (→ `mepc`), the register file as of
//! the instruction BEFORE it, and the correct `mcause`/`mtval` produced by the ONE trusted
//! interpreter trap machinery (`Hart::jit_load`/`jit_store` reuse the interpreter's `cload*`/
//! `cstore*` path, so cause/tval are byte-identical). These tests lockstep-diff JIT vs interpreter.
//!
//! * `mem_fault_precise_matches_interpreter` — a load/store access fault at the first, middle, and
//!   last instruction of a block: mepc, mcause, mtval, and the full x1..x31 register file must match
//!   the interpreter exactly (regs 0..k−1 committed, the faulting op's rd untouched, later ops never
//!   run).
//! * `overwritten_base_register_fault` — adversarial #2: the faulting store's base register is
//!   rewritten earlier in the SAME block; mtval must reflect the address from the OLD dataflow and
//!   the register file must show the overwrite.
//! * `mmio_store_then_fault_commits_once` — THE headline corner (E4-T10 flagged): a block does an
//!   observable MMIO store (a UART byte) and THEN faults; the MMIO store must happen EXACTLY ONCE
//!   (one byte emitted, not two) AND the trap state must be precise. Under the old re-interpret-from-
//!   entry deopt this replayed the MMIO store (two bytes); the precise side-exit fixes it.

use jit_runtime::WasmtimeExecutor;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::{DRAM_BASE, UART0_BASE};
use wasm_vm_core::csr::{CsrOp, MCYCLE, MINSTRET};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::{Machine, RunOutcome};

// ── tiny RV64 encoders ───────────────────────────────────────────────────────
fn enc_addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (0b000 << 12) | (rd << 7) | 0b0010011
}
fn enc_sw(rs2: u32, rs1: u32, imm: i32) -> u32 {
    let o = imm as u32;
    ((o >> 5) & 0x7f) << 25
        | (rs2 << 20)
        | (rs1 << 15)
        | (0b010 << 12)
        | (o & 0x1f) << 7
        | 0b0100011
}
fn enc_sb(rs2: u32, rs1: u32, imm: i32) -> u32 {
    let o = imm as u32;
    ((o >> 5) & 0x7f) << 25
        | (rs2 << 20)
        | (rs1 << 15)
        | (0b000 << 12)
        | (o & 0x1f) << 7
        | 0b0100011
}
fn enc_lw(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (0b010 << 12) | (rd << 7) | 0b0000011
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

/// An address that is unmapped in bare mode (below DRAM at 0x8000_0000, not a device window) — a
/// load/store here access-faults exactly as the interpreter.
const FAULT_ADDR: u64 = 0x5000_0000;

fn poke(m: &mut Machine, base: u64, words: &[u32]) {
    for (i, w) in words.iter().enumerate() {
        m.bus_mut().store32(base + 4 * i as u64, *w).unwrap();
    }
}

fn regs(m: &Machine) -> [u64; 32] {
    let mut r = [0u64; 32];
    for i in 0..32u8 {
        r[i as usize] = m.hart().regs.read(i);
    }
    r
}

fn jit_cfg(m: &mut Machine) {
    m.set_executor(Box::new(WasmtimeExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
}

fn set_csr(m: &mut Machine, addr: u16, value: u64) {
    m.hart_mut()
        .csr
        .access(addr, CsrOp::Write, value, false, false, 0)
        .unwrap();
}

fn read_csr(m: &mut Machine, addr: u16) -> u64 {
    m.hart_mut().csr.read(addr)
}

/// The precise architectural state captured at a trap: the trap (cause + `mtval`), the full
/// x0..x31 register file, and the faulting PC (`mepc`).
type TrapState = (Trap, [u64; 32], u64);

/// Run `prog` under interpreter and under JIT (two-run compile-then-execute pattern), returning
/// `(trap, regs, pc)` for each. `setup` seeds the initial architectural state; it is applied fresh
/// before every run. The faulting block must always fault (both interpreter and the JIT execution),
/// so the mtvec-0 host convention surfaces it as `RunOutcome::Trapped`.
fn run_both(prog: &[u32], setup: impl Fn(&mut Machine)) -> (TrapState, TrapState) {
    // Interpreter reference: single run faults immediately.
    let interp = {
        let mut m = Machine::new(8 * 1024 * 1024);
        poke(&mut m, DRAM_BASE, prog);
        setup(&mut m);
        m.hart_mut().regs.pc = DRAM_BASE;
        let oc = m.run(50);
        let t = match oc {
            RunOutcome::Trapped(t) => t,
            other => panic!("interpreter expected a trap, got {other:?}"),
        };
        (t, regs(&m), m.hart().regs.pc)
    };

    // JIT: first run nominates the block; the second run installs it at the entry boundary and
    // JIT-executes it (the block then faults through the compiled path).
    let jit = {
        let mut m = Machine::new(8 * 1024 * 1024);
        poke(&mut m, DRAM_BASE, prog);
        jit_cfg(&mut m);
        setup(&mut m);
        m.hart_mut().regs.pc = DRAM_BASE;
        let _ = m.run(50); // compile pass (faults out, but the block is now nominated)
        // Re-arm and run again: the compiled block executes and faults precisely.
        setup(&mut m);
        m.hart_mut().regs.pc = DRAM_BASE;
        let oc = m.run(50);
        assert!(
            m.executor().unwrap().is_compiled(DRAM_BASE),
            "the faulting block must have compiled"
        );
        let t = match oc {
            RunOutcome::Trapped(t) => t,
            other => panic!("JIT expected a trap, got {other:?}"),
        };
        (t, regs(&m), m.hart().regs.pc)
    };
    (interp, jit)
}

fn assert_precise(interp: TrapState, jit: TrapState) {
    assert_eq!(interp.0.cause, jit.0.cause, "mcause diverged");
    assert_eq!(interp.0.tval, jit.0.tval, "mtval diverged");
    assert_eq!(interp.2, jit.2, "mepc (faulting PC) diverged");
    assert_eq!(interp.1, jit.1, "register file diverged at the trap");
}

#[test]
fn mem_fault_precise_matches_interpreter() {
    // Preceding ALU ops write x5/x6 (must be committed); the fault is a load or store to FAULT_ADDR
    // held in x8; trailing ops (x9) must NOT have run.
    let spin = enc_jal(0, 0);

    // Fault at the FIRST instruction (no prior committed ALU).
    {
        let prog = [enc_lw(7, 8, 0), enc_addi(9, 0, 333), spin];
        let (i, j) = run_both(&prog, |m| {
            m.hart_mut().regs.write(8, FAULT_ADDR);
        });
        assert_eq!(i.0.cause, Exception::LoadAccessFault);
        assert_eq!(i.0.tval, FAULT_ADDR);
        assert_eq!(i.2, DRAM_BASE, "mepc must be the faulting load's PC");
        assert_eq!(i.1[7], 0, "faulting load's rd must be untouched");
        assert_eq!(i.1[9], 0, "instruction after the fault must not run");
        assert_precise(i, j);
    }

    // Fault at a MIDDLE instruction: two ALU ops must be committed first.
    {
        let prog = [
            enc_addi(5, 0, 111),
            enc_addi(6, 0, 222),
            enc_lw(7, 8, 0),
            enc_addi(9, 0, 333),
            spin,
        ];
        let (i, j) = run_both(&prog, |m| {
            m.hart_mut().regs.write(8, FAULT_ADDR);
        });
        assert_eq!(i.0.cause, Exception::LoadAccessFault);
        assert_eq!(i.1[5], 111, "prior ALU op must be committed");
        assert_eq!(i.1[6], 222, "prior ALU op must be committed");
        assert_eq!(i.1[9], 0, "later op must not run");
        assert_eq!(i.2, DRAM_BASE + 8, "mepc = the load's PC (3rd instr)");
        assert_precise(i, j);
    }

    // STORE fault at the LAST pre-terminator instruction.
    {
        let prog = [
            enc_addi(5, 0, 111),
            enc_addi(6, 0, 222),
            enc_sw(6, 8, 0), // mem[x8] = x6 → StoreAccessFault
            spin,
        ];
        let (i, j) = run_both(&prog, |m| {
            m.hart_mut().regs.write(8, FAULT_ADDR);
        });
        assert_eq!(i.0.cause, Exception::StoreAccessFault);
        assert_eq!(i.0.tval, FAULT_ADDR);
        assert_eq!(i.1[5], 111);
        assert_eq!(i.1[6], 222);
        assert_eq!(i.2, DRAM_BASE + 8, "mepc = the store's PC");
        assert_precise(i, j);
    }
}

#[test]
fn overwritten_base_register_fault() {
    // Adversarial #2: the faulting store's base register x8 is OVERWRITTEN earlier in the same
    // block, and the store uses the new value. mtval must be the address computed from the new x8
    // (dataflow-correct), and the committed register file must show the overwrite.
    //   x8 = FAULT_ADDR (via add of two halves is awkward; instead set x8=0 then addi to FAULT_ADDR
    //   fits in imm? FAULT_ADDR is large — build it from a preset reg + addi). Simplify: preset x2 =
    //   FAULT_ADDR - 4; block does `addi x8, x2, 4` (overwrite x8) then `sw x6, 0(x8)`.
    let spin = enc_jal(0, 0);
    let prog = [
        enc_addi(6, 0, 55), // x6 = 55 (committed)
        enc_addi(8, 2, 4),  // x8 = x2 + 4 = FAULT_ADDR (OVERWRITES x8)
        enc_sw(6, 8, 0),    // mem[x8] = x6 → StoreAccessFault at FAULT_ADDR
        spin,
    ];
    let (i, j) = run_both(&prog, |m| {
        m.hart_mut().regs.write(2, FAULT_ADDR - 4);
        m.hart_mut().regs.write(8, 0xDEAD); // stale value, must be overwritten before the store
    });
    assert_eq!(i.0.cause, Exception::StoreAccessFault);
    assert_eq!(i.0.tval, FAULT_ADDR, "mtval must use the NEW x8 dataflow");
    assert_eq!(i.1[8], FAULT_ADDR, "x8 must show the overwrite, not 0xDEAD");
    assert_eq!(i.1[6], 55);
    assert_precise(i, j);
}

#[test]
fn mmio_store_then_fault_commits_once() {
    // THE headline corner. Block: sb x10,0(x11) [x11=UART THR → emits one byte] ; sw x12,0(x13)
    // [x13 = fault addr → StoreAccessFault] ; jal spin. The UART byte must be emitted EXACTLY ONCE
    // by the JIT execution, and the trap state must be precise.
    const CH: u32 = 0x5A; // 'Z'
    let prog = [
        enc_sb(10, 11, 0), // UART store (observable side effect)
        enc_sw(12, 13, 0), // faulting store
        enc_jal(0, 0),     // terminator (never reached)
    ];

    // Interpreter reference: one byte, precise trap.
    let (itrap, ibyte) = {
        let mut m = Machine::new(8 * 1024 * 1024);
        m.enable_plic();
        let uart = m.enable_uart16550();
        poke(&mut m, DRAM_BASE, &prog);
        m.hart_mut().regs.write(10, CH as u64);
        m.hart_mut().regs.write(11, UART0_BASE);
        m.hart_mut().regs.write(13, FAULT_ADDR);
        m.hart_mut().regs.pc = DRAM_BASE;
        let oc = m.run(50);
        let t = match oc {
            RunOutcome::Trapped(t) => t,
            other => panic!("interpreter expected a trap, got {other:?}"),
        };
        (t, uart.borrow_mut().take_output())
    };
    assert_eq!(itrap.cause, Exception::StoreAccessFault);
    assert_eq!(itrap.tval, FAULT_ADDR);
    assert_eq!(
        ibyte,
        vec![CH as u8],
        "interpreter must emit the UART byte once"
    );

    // JIT: compile pass with a VALID store target (no fault, no UART replay concern), then execute
    // the compiled block with the faulting target and count UART bytes from THAT run only.
    let mut m = Machine::new(8 * 1024 * 1024);
    m.enable_plic();
    let uart = m.enable_uart16550();
    poke(&mut m, DRAM_BASE, &prog);
    jit_cfg(&mut m);
    // Compile pass: x13 → valid RAM so the block completes and compiles.
    m.hart_mut().regs.write(10, CH as u64);
    m.hart_mut().regs.write(11, UART0_BASE);
    m.hart_mut().regs.write(12, 0);
    m.hart_mut().regs.write(13, DRAM_BASE + 0x2000);
    m.hart_mut().regs.pc = DRAM_BASE;
    let _ = m.run(50);
    assert!(
        m.executor().unwrap().is_compiled(DRAM_BASE),
        "the MMIO block must compile"
    );
    let _ = uart.borrow_mut().take_output(); // discard the compile-pass byte(s)

    // Execute pass: fault target. The compiled block runs, emits the UART byte, then faults.
    m.hart_mut().regs.write(10, CH as u64);
    m.hart_mut().regs.write(11, UART0_BASE);
    m.hart_mut().regs.write(13, FAULT_ADDR);
    m.hart_mut().regs.pc = DRAM_BASE;
    m.enable_clint(1);
    set_csr(&mut m, MCYCLE, 100);
    set_csr(&mut m, MINSTRET, 200);
    let executed_before = m.executor().unwrap().executed_blocks();
    let jit_retired_before = m.executor().unwrap().retired_via_jit();
    let retired_before = m.irq_stats().retired;
    let oc = m.run(50);
    let jtrap = match oc {
        RunOutcome::Trapped(t) => t,
        other => panic!("JIT expected a trap, got {other:?}"),
    };
    let jbyte = uart.borrow_mut().take_output();

    assert!(
        m.executor().unwrap().executed_blocks() > executed_before,
        "the block must have actually run via the JIT (not just interpreted)"
    );
    assert_eq!(
        m.executor().unwrap().retired_via_jit() - jit_retired_before,
        1,
        "only the MMIO store before the fault retired via JIT"
    );
    assert_eq!(m.irq_stats().retired - retired_before, 1);
    assert_eq!(read_csr(&mut m, MCYCLE), 101);
    assert_eq!(read_csr(&mut m, MINSTRET), 201);
    assert_eq!(m.clint_mtime(), 1);
    // THE assertion: the observable MMIO side effect happened EXACTLY ONCE, not twice.
    assert_eq!(
        jbyte,
        vec![CH as u8],
        "MMIO store must commit EXACTLY once — a second byte means the block was replayed"
    );
    // …and the trap is precise and identical to the interpreter.
    assert_eq!(jtrap.cause, itrap.cause, "mcause diverged");
    assert_eq!(jtrap.tval, itrap.tval, "mtval diverged");
    assert_eq!(
        m.hart().regs.pc,
        DRAM_BASE + 4,
        "mepc must be the faulting store's PC"
    );
}
