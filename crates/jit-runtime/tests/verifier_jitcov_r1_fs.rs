//! Verifier (jitcov round 1, fresh session) novel attack: FS / frm state transitions driven by
//! INTERPRETED CSR continuations of partial blocks, precise FS=Off and reserved-dynamic-rm traps in
//! compiled code, and the native FPR-image / FP-control elision, all inside the REAL run loop with
//! a machine-timer deadline swept across every instruction position and with the run split into
//! small host chunks (so partial exits and short-tail refusals land on chunk boundaries).
//!
//! The JIT machine must equal the batched interpreter (block cache + interrupt batching) bit for
//! bit: x/f registers, fflags, frm, mstatus (FS/SD), the handler's trap/interrupt accumulators,
//! the timer-interrupt count, retirement and mtime.
//!
//! Sabotage-checked: never resuming the block cursor after a `CallInterp` exit fails it (the timer
//! interrupt's mepc moves onto the interpreted CSR op), and so does skipping the per-entry FP
//! control-word refresh in `prepare_module_state` (compiled FP ops stop trapping on FS=Off).

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};

const HANDLER: u64 = DRAM_BASE + 0x2000;

fn r(funct7: u32, rs2: u32, rs1: u32, funct3: u32, rd: u32, opcode: u32) -> u32 {
    (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode
}
fn i(imm: i32, rs1: u32, funct3: u32, rd: u32, opcode: u32) -> u32 {
    (((imm as u32) & 0xfff) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode
}
fn b(imm: i32, rs2: u32, rs1: u32, funct3: u32) -> u32 {
    let o = imm as u32;
    (((o >> 12) & 1) << 31)
        | (((o >> 5) & 0x3f) << 25)
        | (rs2 << 20)
        | (rs1 << 15)
        | (funct3 << 12)
        | (((o >> 1) & 0xf) << 8)
        | (((o >> 11) & 1) << 7)
        | 0x63
}
fn fr(funct7: u32, rs2: u32, rs1: u32, rm: u32, rd: u32) -> u32 {
    r(funct7, rs2, rs1, rm, rd, 0x53)
}
fn csr(funct3: u32, addr: u32, rs1: u32, rd: u32) -> u32 {
    (addr << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | 0x73
}
fn addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    i(imm, rs1, 0, rd, 0x13)
}
fn andi(rd: u32, rs1: u32, imm: i32) -> u32 {
    i(imm, rs1, 7, rd, 0x13)
}
fn add(rd: u32, rs1: u32, rs2: u32) -> u32 {
    r(0, rs2, rs1, 0, rd, 0x33)
}
const MRET: u32 = 0x3020_0073;
const JAL_SELF: u32 = 0x0000_006f;

fn program() -> Vec<u32> {
    vec![
        andi(21, 1, 7),          // 0: x21 = x1 & 7 (frm 5..7 are reserved -> dyn ops trap)
        fr(0x01, 2, 1, 7, 1),    // 4: fadd.d f1, f1, f2, dyn
        fr(0x09, 2, 1, 0, 3),    // 8: fmul.d f3, f1, f2, rne
        csr(3, 0x300, 20, 0),    // 12: csrc mstatus, x20 (FS=Off): INTERPRETED continuation
        fr(0x05, 1, 3, 1, 4),    // 16: fsub.d f4, f3, f1, rtz  (FS=Off -> illegal, precise)
        fr(0x61, 2, 4, 7, 5),    // 20: fcvt.l.d x5, f4, dyn
        add(6, 6, 5),            // 24
        csr(1, 0x002, 21, 0),    // 28: fsrm x21 (inline FP CSR, ends the block)
        csr(2, 0x001, 0, 7),     // 32: frflags x7 (lone inline FP CSR block)
        add(8, 8, 7),            // 36
        csr(1, 0x001, 0, 0),     // 40: fsflags x0 (clear)
        fr(0x2d, 0, 4, 7, 5),    // 44: fsqrt.d f5, f4, dyn
        fr(0x71, 0, 5, 1, 9),    // 48: fclass.d x9, f5
        add(22, 22, 9),          // 52
        fr(0x20, 1, 5, 7, 23),   // 56: fcvt.s.d f23, f5, dyn
        fr(0x04, 23, 23, 7, 24), // 60: fsub.s f24, f23, f23, dyn
        csr(2, 0x340, 0, 25),    // 64: csrr x25, mscratch: INTERPRETED continuation
        addi(1, 1, -1),          // 68
        b(-72, 0, 1, 1),         // 72: bne x1, x0, loop
        JAL_SELF,                // 76
    ]
}

fn handler() -> Vec<u32> {
    vec![
        csr(2, 0x342, 0, 11), // 0: csrr x11, mcause
        b(36, 0, 11, 4),      // 4: blt x11, x0, +36 (interrupt)
        csr(2, 0x300, 20, 0), // 8: csrs mstatus, x20 (FS=Dirty)
        csr(5, 0x002, 0, 0),  // 12: fsrmi 0 (repair a reserved dynamic frm)
        csr(2, 0x341, 0, 12), // 16: csrr x12, mepc
        add(13, 13, 12),      // 20
        csr(2, 0x343, 0, 14), // 24: csrr x14, mtval
        add(15, 15, 14),      // 28
        addi(16, 16, 1),      // 32
        MRET,                 // 36
        0x0200_4E37,          // 40: lui x28, 0x2004 (mtimecmp)
        0xFFF0_0E93,          // 44: addi x29, x0, -1
        0x01DE_3023,          // 48: sd x29, 0(x28): disarm
        csr(2, 0x341, 0, 12), // 52: csrr x12, mepc
        add(17, 17, 12),      // 56
        addi(10, 10, 1),      // 60
        MRET,                 // 64
    ]
}

fn poke(m: &mut Machine, base: u64, words: &[u32]) {
    for (k, w) in words.iter().enumerate() {
        m.bus_mut().store32(base + 4 * k as u64, *w).unwrap();
    }
}

fn build(iterations: u64, mtimecmp: u64) -> Machine {
    let mut m = Machine::new(16 * 1024 * 1024);
    poke(&mut m, DRAM_BASE, &program());
    poke(&mut m, HANDLER, &handler());
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = mtimecmp;
    let h = m.hart_mut();
    h.csr
        .access(MTVEC, CsrOp::Write, HANDLER, false, false, 0)
        .unwrap();
    h.csr
        .access(MIE, CsrOp::Write, 1 << 7, false, false, 0)
        .unwrap();
    h.csr
        .access(MSTATUS, CsrOp::Write, (1 << 3) | (1 << 13), false, false, 0)
        .unwrap();
    h.regs.write(1, iterations);
    h.regs.write(20, 0x6000);
    h.fregs.write_raw(1, 0x3ff0_0000_0000_0001);
    h.fregs.write_raw(2, 0x3fb9_9999_9999_999a);
    h.regs.pc = DRAM_BASE;
    m
}

fn run_chunked(m: &mut Machine, budget: u64, chunk: u64) {
    let mut left = budget;
    while left > 0 {
        let n = chunk.min(left);
        m.run(n);
        left -= n;
    }
}

fn reference(mut m: Machine, budget: u64, chunk: u64) -> Machine {
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    run_chunked(&mut m, budget, chunk);
    m
}

fn jit(mut m: Machine, budget: u64, chunk: u64) -> Machine {
    m.set_executor(Box::new(jit_runtime::WasmtimeExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
    run_chunked(&mut m, budget, chunk);
    m
}

fn assert_same(label: &str, a: &mut Machine, b: &mut Machine) {
    for reg in 0..32u8 {
        assert_eq!(
            a.hart().regs.read(reg),
            b.hart().regs.read(reg),
            "{label}: x{reg}"
        );
        assert_eq!(
            a.hart().fregs.read_raw(reg),
            b.hart().fregs.read_raw(reg),
            "{label}: f{reg}"
        );
    }
    assert_eq!(a.hart().regs.pc, b.hart().regs.pc, "{label}: pc");
    assert_eq!(a.hart().csr.fflags, b.hart().csr.fflags, "{label}: fflags");
    assert_eq!(a.hart().csr.frm, b.hart().csr.frm, "{label}: frm");
    assert_eq!(
        a.hart_mut().csr.read(MSTATUS),
        b.hart_mut().csr.read(MSTATUS),
        "{label}: mstatus"
    );
    assert_eq!(
        a.irq_stats().int[7],
        b.irq_stats().int[7],
        "{label}: timer ints"
    );
    assert_eq!(
        a.irq_stats().retired,
        b.irq_stats().retired,
        "{label}: retired"
    );
    assert_eq!(a.clint_mtime(), b.clint_mtime(), "{label}: mtime");
}

#[test]
fn verifier_fs_frm_transitions_through_partial_blocks_match_the_batched_interpreter() {
    let budget = 30_000;
    let mut jit_retired = 0;
    let mut partial_exits = 0;
    let mut traps = 0;
    for chunk in [budget, 7, 64] {
        for mtimecmp in (20_000..20_090).step_by(if chunk == budget { 1 } else { 3 }) {
            let mut want = reference(build(5_000, mtimecmp), budget, chunk);
            let mut got = jit(build(5_000, mtimecmp), budget, chunk);
            assert_eq!(
                want.irq_stats().int[7],
                1,
                "timer fires once (mtimecmp={mtimecmp})"
            );
            assert!(want.hart().regs.read(16) > 100, "FS/rm traps are taken");
            traps = want.hart().regs.read(16);
            assert_same(
                &format!("chunk={chunk} mtimecmp={mtimecmp}"),
                &mut want,
                &mut got,
            );
            let e = got.executor().unwrap();
            jit_retired += e.retired_via_jit();
            partial_exits += e.translation_coverage().partial_exits;
        }
    }
    assert!(jit_retired > 0);
    assert!(partial_exits > 0);
    eprintln!(
        "VERIFIER fs/frm sweep jit_retired={jit_retired} partial_exits={partial_exits} traps_per_run={traps}"
    );
}
