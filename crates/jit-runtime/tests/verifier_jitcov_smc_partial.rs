//! Verifier (jitcov) novel attack: self-modifying code inside a PARTIAL block.
//!
//! The compiled prefix of a partial block stores a new encoding over the block's own untranslated
//! CSR terminator, alternating each iteration between `csrrw x0, mscratch, x1` and
//! `csrrs x15, mscratch, x0`. The batched interpreter drains the code write before the next op,
//! so the next op is a fresh block boundary fetched from the NEW bytes. The JIT's `CallInterp`
//! continuation must do exactly the same (no stale cursor resume into the old decoded op, and no
//! divergence in interrupt sampling). A machine-timer deadline is swept across every instruction
//! position of several iterations and the JIT machine must equal the batched interpreter.

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};

const HANDLER: u64 = DRAM_BASE + 0x2000;
const MSCRATCH: u32 = 0x340;
const MEPC: u32 = 0x341;
const MRET: u32 = 0x3020_0073;
const JAL_SELF: u32 = 0x0000_006f;

fn enc_i(opcode: u32, funct3: u32, rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode
}
fn addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    enc_i(0x13, 0, rd, rs1, imm)
}
fn andi(rd: u32, rs1: u32, imm: i32) -> u32 {
    enc_i(0x13, 7, rd, rs1, imm)
}
fn add(rd: u32, rs1: u32, rs2: u32) -> u32 {
    (rs2 << 20) | (rs1 << 15) | (rd << 7) | 0x33
}
fn mul(rd: u32, rs1: u32, rs2: u32) -> u32 {
    (1 << 25) | (rs2 << 20) | (rs1 << 15) | (rd << 7) | 0x33
}
fn sw(rs2: u32, rs1: u32, imm: i32) -> u32 {
    let i = imm as u32;
    ((i >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | (2 << 12) | ((i & 0x1f) << 7) | 0x23
}
fn csrrs(rd: u32, csr: u32, rs1: u32) -> u32 {
    (csr << 20) | (rs1 << 15) | (2 << 12) | (rd << 7) | 0x73
}
fn csrrw(rd: u32, csr: u32, rs1: u32) -> u32 {
    (csr << 20) | (rs1 << 15) | (1 << 12) | (rd << 7) | 0x73
}
fn bne_back(rs1: u32, bytes: i32) -> u32 {
    let o = (-bytes) as u32;
    (((o >> 12) & 1) << 31)
        | (((o >> 5) & 0x3f) << 25)
        | (rs1 << 15)
        | (1 << 12)
        | (((o >> 1) & 0xf) << 8)
        | (((o >> 11) & 1) << 7)
        | 0x63
}

fn poke(m: &mut Machine, base: u64, words: &[u32]) {
    for (i, w) in words.iter().enumerate() {
        m.bus_mut().store32(base + 4 * i as u64, *w).unwrap();
    }
}
fn set_csr(m: &mut Machine, addr: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, CsrOp::Write, v, false, false, 0)
        .unwrap();
}

const DATA_OFF: u64 = 0x1_0000;
const W_A: u32 = 0x3400_9073; // csrrw x0, mscratch, x1
const W_B: u32 = 0x3400_27f3; // csrrs x15, mscratch, x0

fn build(iterations: u64, mtimecmp: u64) -> Machine {
    assert_eq!(csrrw(0, MSCRATCH, 1), W_A);
    assert_eq!(csrrs(15, MSCRATCH, 0), W_B);
    let mut m = Machine::new(16 * 1024 * 1024);
    let body = [
        addi(1, 1, -1),          // 0
        andi(7, 1, 63),          // 4
        enc_i(0x13, 3, 5, 7, 1), // 8   sltiu x5, x7, 1: SMC this iteration?
        mul(8, 25, 5),           // 12
        add(8, 8, 26),           // 16  x8 = SMC ? code word : scratch data (other page)
        enc_i(0x13, 5, 9, 1, 6), // 20 srli x9, x1, 6
        andi(9, 9, 1),           // 24
        mul(6, 23, 9),           // 28  x6 = (W_A - W_B) * bit6(x1)
        add(6, 6, 22),           // 32  x6 = bit6 ? W_A : W_B
        add(16, 16, 15),         // 36  accumulate the last mscratch read
        sw(6, 8, 0),             // 40  store (sometimes over the CSR op at +44, same block)
        W_B,                     // 44  untranslated CSR terminator (partial-block exit)
        bne_back(1, 48),         // 48
        JAL_SELF,                // 52
    ];
    poke(&mut m, DRAM_BASE, &body);
    poke(
        &mut m,
        HANDLER,
        &[
            0x0200_4E37, // lui  x28, 0x2004 (mtimecmp)
            0xFFF0_0E93, // addi x29, x0, -1
            0x01DE_3023, // sd   x29, 0(x28): disarm
            csrrs(11, MSCRATCH, 0),
            csrrs(12, MEPC, 0),
            addi(10, 10, 1),
            MRET,
        ],
    );
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = mtimecmp;
    set_csr(&mut m, MTVEC, HANDLER);
    set_csr(&mut m, MIE, 1 << 7);
    set_csr(&mut m, MSTATUS, (1 << 3) | (1 << 13));
    let r = &mut m.hart_mut().regs;
    r.write(1, iterations);
    r.write(21, u64::from(W_A));
    r.write(22, u64::from(W_B));
    r.write(23, u64::from(W_A).wrapping_sub(u64::from(W_B)));
    r.write(25, 44u64.wrapping_sub(DATA_OFF));
    r.write(26, DRAM_BASE + DATA_OFF);
    m.hart_mut().regs.pc = DRAM_BASE;
    m
}

fn reference(mut m: Machine, budget: u64) -> Machine {
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.run(budget);
    m
}

fn jit(mut m: Machine, budget: u64) -> Machine {
    m.set_executor(Box::new(jit_runtime::WasmtimeExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
    m.run(budget);
    m
}

fn assert_same(label: &str, a: &mut Machine, b: &mut Machine) {
    for r in 0..32u8 {
        assert_eq!(
            a.hart().regs.read(r),
            b.hart().regs.read(r),
            "{label}: x{r}"
        );
    }
    assert_eq!(a.hart().regs.pc, b.hart().regs.pc, "{label}: pc");
    assert_eq!(
        a.hart_mut().csr.read(MSTATUS),
        b.hart_mut().csr.read(MSTATUS),
        "{label}: mstatus"
    );
    assert_eq!(
        a.hart_mut().csr.read(MSCRATCH as u16),
        b.hart_mut().csr.read(MSCRATCH as u16),
        "{label}: mscratch"
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
    let mut wa = [0u8; 4];
    let mut wb = [0u8; 4];
    for i in 0..4 {
        wa[i] = a.bus_mut().load8(DRAM_BASE + 44 + i as u64).unwrap();
        wb[i] = b.bus_mut().load8(DRAM_BASE + 44 + i as u64).unwrap();
    }
    assert_eq!(wa, wb, "{label}: code word");
}

#[test]
fn smc_into_a_partial_blocks_own_csr_terminator_matches_the_batched_interpreter() {
    let iterations = 2000;
    let budget = 20_000;
    let mut jit_retired = 0;
    let mut partial_exits = 0;
    // Sanity: without an interrupt the two encodings really alternate (x16 sums the odd x1
    // values written to mscratch and read back by W_B).
    {
        let mut want = reference(build(iterations, u64::MAX), budget);
        let mut got = jit(build(iterations, u64::MAX), budget);
        assert_ne!(
            want.hart().regs.read(16),
            0,
            "the alternation is observable"
        );
        assert_same("no-irq", &mut want, &mut got);
        let exec = got.executor().unwrap();
        jit_retired += exec.retired_via_jit();
        partial_exits += exec.translation_coverage().partial_exits;
        assert_eq!(got.jit_partial_resume_failures(), 0);
    }
    for mtimecmp in 9300..9420 {
        let mut want = reference(build(iterations, mtimecmp), budget);
        let mut got = jit(build(iterations, mtimecmp), budget);
        assert_eq!(want.irq_stats().int[7], 1, "the timer fires once");
        assert_same(&format!("mtimecmp={mtimecmp}"), &mut want, &mut got);
        let exec = got.executor().unwrap();
        jit_retired += exec.retired_via_jit();
        partial_exits += exec.translation_coverage().partial_exits;
        assert_eq!(got.jit_partial_resume_failures(), 0);
    }
    eprintln!("SMC_PARTIAL jit_retired={jit_retired} partial_exits={partial_exits}");
    assert!(jit_retired > 0, "compiled code must run");
    assert!(partial_exits > 0, "the partial-block exit must be taken");
}
