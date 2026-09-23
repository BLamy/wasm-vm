//! Shared fixture: partial-block translation, FP/fcsr coverage and device-access chain breaks stay
//! timing-transparent in the real run loop (native wasmtime and browser executors).
//!
//! A block that ends in an untranslatable system op (here: non-FP CSR accesses) compiles its
//! prefix and exits (`ExitCode::CallInterp`) precisely at that op, which the interpreter then runs
//! as the continuation of the SAME decoded block: no device sync or interrupt sample may happen in
//! between. These tests sweep a machine-timer deadline across every instruction position of hot
//! loops and require the JIT machine to match the batched interpreter (block cache + interrupt
//! batching, the JIT's reference) bit for bit: every x/f register, fcsr, PC, the interrupt's
//! `mepc` and the CSR values the handler observes, the timer-interrupt count, the retire count and
//! `mtime`. A missing cursor resume would sample at the untranslated op and move `mepc`.

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};

/// Builds the executor under test for a machine (the inline browser executor needs its RAM).
pub type Factory = fn(&Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor>;

const HANDLER: u64 = DRAM_BASE + 0x2000;

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
fn fr(funct7: u32, rs2: u32, rs1: u32, rm: u32, rd: u32) -> u32 {
    (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (rm << 12) | (rd << 7) | 0x53
}
const MRET: u32 = 0x3020_0073;
const MSCRATCH: u32 = 0x340;
const MEPC: u32 = 0x341;
const JAL_SELF: u32 = 0x0000_006f;

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

/// `body` is one loop iteration ending with a backward `bne x1` to its start; after the loop the
/// hart spins. The handler disarms the timer, records `mscratch`/`mepc`/`fcsr`, counts, returns.
fn build(body: &[u32], iterations: u64, mtimecmp: u64) -> Machine {
    let mut m = Machine::new(16 * 1024 * 1024);
    let mut words = body.to_vec();
    words.push(bne_back(1, 4 * body.len() as i32));
    words.push(JAL_SELF);
    poke(&mut m, DRAM_BASE, &words);
    poke(
        &mut m,
        HANDLER,
        &[
            0x0200_4E37, // lui  x28, 0x2004 (mtimecmp)
            0xFFF0_0E93, // addi x29, x0, -1
            0x01DE_3023, // sd   x29, 0(x28): disarm
            csrrs(11, MSCRATCH, 0),
            csrrs(12, MEPC, 0),
            csrrs(14, 0x003, 0), // frcsr
            addi(10, 10, 1),
            MRET,
        ],
    );
    let clint = m.enable_clint(1); // mtime == retired
    clint.borrow_mut().mtimecmp = mtimecmp;
    set_csr(&mut m, MTVEC, HANDLER);
    set_csr(&mut m, MIE, 1 << 7);
    set_csr(&mut m, MSTATUS, (1 << 3) | (1 << 13)); // MIE, FS=Initial
    m.hart_mut().regs.write(1, iterations);
    m.hart_mut().regs.pc = DRAM_BASE;
    m
}

fn reference(mut m: Machine, budget: u64) -> Machine {
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.run(budget);
    m
}

fn jit(make: Factory, mut m: Machine, budget: u64) -> Machine {
    let executor = make(&m);
    m.set_executor(executor);
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
        assert_eq!(
            a.hart().fregs.read_raw(r),
            b.hart().fregs.read_raw(r),
            "{label}: f{r}"
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
}

fn sweep(
    make: Factory,
    ledger: bool,
    label: &str,
    body: &[u32],
    iterations: u64,
    budget: u64,
    deadlines: std::ops::Range<u64>,
) {
    let mut partial_exits = 0;
    let mut jit_retired = 0;
    for mtimecmp in deadlines {
        let mut want = reference(build(body, iterations, mtimecmp), budget);
        let mut got = jit(make, build(body, iterations, mtimecmp), budget);
        assert_eq!(
            want.irq_stats().int[7],
            1,
            "{label}: the timer must fire once"
        );
        assert_same(&format!("{label} mtimecmp={mtimecmp}"), &mut want, &mut got);
        let exec = got.executor().unwrap();
        partial_exits += exec.translation_coverage().partial_exits;
        jit_retired += exec.retired_via_jit();
    }
    assert!(
        jit_retired > 0,
        "{label}: the JIT must execute compiled code"
    );
    eprintln!("{label}: partial_exits={partial_exits} jit_retired={jit_retired}");
    assert!(
        !ledger || partial_exits > 0 || !label.starts_with("partial"),
        "{label}: partial exits taken"
    );
}

/// `ledger`: the executor reports a translation-coverage ledger (partial exits must be observed).
pub fn partial_csr_loop(make: Factory, ledger: bool) {
    // Three blocks per iteration: [addi, add | csrr mscratch] and [addi | csrw mscratch] are
    // partial (prefix compiled, CSR interpreted); [bne] is fully compiled.
    let body = [
        addi(1, 1, -1),
        add(2, 2, 1),
        csrrs(3, MSCRATCH, 0),
        addi(4, 4, 1),
        csrrw(0, MSCRATCH, 4),
    ];
    // The loop is hot (and compiled) well before these deadlines; the sweep covers every
    // position of several consecutive iterations.
    sweep(
        make,
        ledger,
        "partial CSR loop",
        &body,
        3000,
        14_000,
        9000..9030,
    );
}

pub fn fp_fcsr_loop(make: Factory, ledger: bool) {
    let body = [
        andi(13, 1, 3),
        csrrw(0, 0x002, 13),  // fsrm x13 (FP CSR: inline, ends the block)
        fr(0x69, 2, 1, 7, 1), // fcvt.d.l f1, x1, dyn
        fr(0x09, 1, 1, 0, 2), // fmul.d f2, f1, f1, rne
        fr(0x01, 2, 3, 7, 3), // fadd.d f3, f3, f2, dyn
        fr(0x0d, 1, 3, 1, 4), // fdiv.d f4, f3, f1, rtz
        fr(0x2d, 0, 4, 7, 5), // fsqrt.d f5, f4, dyn
        fr(0x61, 2, 5, 1, 5), // fcvt.l.d x5, f5, rtz
        add(6, 6, 5),
        fr(0x51, 3, 4, 2, 7),  // feq.d x7, f4, f3
        fr(0x71, 0, 4, 1, 8),  // fclass.d x8, f4
        fr(0x20, 1, 4, 7, 9),  // fcvt.s.d f9, f4, dyn
        fr(0x21, 0, 9, 0, 10), // fcvt.d.s f10, f9
        fr(0x69, 0, 6, 0, 11), // fcvt.d.w f11, x6
        csrrs(9, 0x001, 0),    // frflags x9 (FP CSR: inline, ends the block)
        csrrw(0, 0x001, 0),    // fsflags x0 (clear)
        addi(1, 1, -1),
    ];
    sweep(
        make,
        ledger,
        "fp fcsr loop",
        &body,
        800,
        16_000,
        11_000..11_020,
    );
}

pub fn fp_prefix_loop(make: Factory, ledger: bool) {
    // FP work in the compiled prefix of a block that ends in a non-FP CSR access.
    let body = [
        fr(0x69, 2, 1, 0, 1), // fcvt.d.l f1, x1
        fr(0x01, 1, 1, 7, 2), // fadd.d f2, f1, f1, dyn
        fr(0x61, 0, 2, 0, 3), // fcvt.w.d x3, f2
        csrrw(0, MSCRATCH, 3),
        addi(1, 1, -1),
    ];
    sweep(
        make,
        ledger,
        "partial fp prefix loop",
        &body,
        3000,
        14_000,
        9000..9012,
    );
}

fn sb(rs2: u32, rs1: u32, imm: i32) -> u32 {
    let i = imm as u32;
    ((i >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | ((i & 0x1f) << 7) | 0x23
}
fn lw(rd: u32, rs1: u32, imm: i32) -> u32 {
    enc_i(0x03, 2, rd, rs1, imm)
}
fn sw(rs2: u32, rs1: u32, imm: i32) -> u32 {
    let i = imm as u32;
    ((i >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | (2 << 12) | ((i & 0x1f) << 7) | 0x23
}
fn jal_fwd(bytes: i32) -> u32 {
    let o = bytes as u32;
    (((o >> 20) & 1) << 31)
        | (((o >> 1) & 0x3ff) << 21)
        | (((o >> 11) & 1) << 20)
        | (((o >> 12) & 0xff) << 12)
        | 0x6f
}

/// Loop whose first block enables the UART THRE interrupt by MMIO; the UART's level reaches the
/// PLIC only in the run loop's full boundary pass. The handler disables it again (MMIO), claims
/// and completes at the PLIC, and accumulates `mepc`, so every interrupt position is recorded.
fn build_uart_irq_loop(iterations: u64) -> Machine {
    use wasm_vm_core::bus::mmap::{PLIC_BASE, UART0_BASE};
    const CLAIM: u64 = PLIC_BASE + 0x0020_0004;
    let mut m = Machine::new(16 * 1024 * 1024);
    // B0: addi x1,-1 ; sb x7,1(x6) (IER=ETBEI) ; addi x2,+1 ; jal B1
    // B1: addi x3,+1 ; jal B2
    // B2: addi x4,+1 ; bne x1,x0,B0 ; spin
    poke(
        &mut m,
        DRAM_BASE,
        &[
            addi(1, 1, -1),
            sb(7, 6, 1),
            addi(2, 2, 1),
            jal_fwd(4),
            addi(3, 3, 1),
            jal_fwd(4),
            addi(4, 4, 1),
            bne_back(1, 24),
            JAL_SELF,
        ],
    );
    poke(
        &mut m,
        HANDLER,
        &[
            sb(0, 6, 1), // IER = 0: drops the THRE level
            lw(9, 8, 0), // claim
            sw(9, 8, 0), // complete
            addi(10, 10, 1),
            csrrs(11, MEPC, 0),
            add(12, 12, 11),
            MRET,
        ],
    );
    let _plic = m.enable_plic();
    m.enable_uart16550();
    let uart_irq = u64::from(wasm_vm_core::platform::virt::UART0_IRQ);
    m.bus_mut().store32(PLIC_BASE + 4 * uart_irq, 1).unwrap(); // priority
    m.bus_mut()
        .store32(PLIC_BASE + 0x2000, 1 << uart_irq)
        .unwrap(); // enable, M context 0
    m.bus_mut().store32(PLIC_BASE + 0x0020_0000, 0).unwrap(); // threshold
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = u64::MAX;
    set_csr(&mut m, MTVEC, HANDLER);
    set_csr(&mut m, MIE, 1 << 11); // MEIE
    set_csr(&mut m, MSTATUS, 1 << 3);
    let h = m.hart_mut();
    h.regs.write(1, iterations);
    h.regs.write(6, UART0_BASE);
    h.regs.write(7, 2);
    h.regs.write(8, CLAIM);
    h.regs.pc = DRAM_BASE;
    m
}

pub fn device_access_chain(make: Factory) {
    // Without the chain break after a device access, the compiled B0 -> B1 -> B2 chain skips the
    // full boundary pass that mirrors the UART level into the PLIC, delaying every interrupt.
    for budget in [3_000, 6_001, 9_999] {
        let mut want = reference(build_uart_irq_loop(400), budget);
        let mut got = jit(make, build_uart_irq_loop(400), budget);
        assert!(
            want.hart().regs.read(10) > 50,
            "the UART interrupt must fire every iteration"
        );
        assert_same(
            &format!("uart irq loop budget={budget}"),
            &mut want,
            &mut got,
        );
        assert!(got.executor().unwrap().retired_via_jit() > 0);
    }
}

fn branch(funct3: u32, rs1: u32, rs2: u32, bytes: i32) -> u32 {
    let o = bytes as u32;
    (((o >> 12) & 1) << 31)
        | (((o >> 5) & 0x3f) << 25)
        | (rs2 << 20)
        | (rs1 << 15)
        | (funct3 << 12)
        | (((o >> 1) & 0xf) << 8)
        | (((o >> 11) & 1) << 7)
        | 0x63
}

/// A two-phase loop that makes a compiled block direct-chain (in module, with no host lookup)
/// into a PARTIAL block whose decoded block the small decoded-block cache has meanwhile evicted.
///
/// ```text
///   P: addi x1,-1 ; add x2,x1 ; csrr x3,mscratch   partial: prefix compiled, CSR interpreted
///   B: bltu x1,x5,T                                 early phase falls through to Q
///   Q: addi x4,+1 ; bne x1,x0,P                     compiled; its taken edge links to P
///      spin
///   T: `thrash` x [csrw mscratch,x4]                lone CSR blocks: never compiled, always
///   J: jal Q                                        (re)inserted, so they evict P's decoded block
/// ```
///
/// The early phase keeps every block resident, so the Q->P edge is linked; the late phase runs
/// the thrash blocks each iteration, so Q (entered compiled from J) chains into a P whose decoded
/// block is gone. The partial exit must still resume P's cursor at the CSR op (no block boundary)
/// exactly like the batched interpreter, which entered P and replays that op from its cursor.
fn build_evicted_partial_chain(lead: u32, thrash: u32, mtimecmp: u64) -> Machine {
    let mut m = Machine::new(16 * 1024 * 1024);
    // `lead` spin slots shift every block's physical address (and so its decoded-cache slot).
    let mut words = vec![jal_fwd(4 * (lead as i32 + 1))];
    words.extend(std::iter::repeat_n(JAL_SELF, lead as usize));
    let p = words.len();
    words.extend([addi(1, 1, -1), add(2, 2, 1), csrrs(3, MSCRATCH, 0)]);
    let b = words.len();
    words.push(0); // patched below
    let q = words.len();
    words.push(addi(4, 4, 1));
    words.push(bne_back(1, 4 * (words.len() - p) as i32));
    words.push(JAL_SELF);
    let t = words.len();
    words.extend(std::iter::repeat_n(csrrw(0, MSCRATCH, 4), thrash as usize));
    let j = words.len();
    let back = -(4 * (j - q) as i32) as u32;
    words.push(
        (((back >> 20) & 1) << 31)
            | (((back >> 1) & 0x3ff) << 21)
            | (((back >> 11) & 1) << 20)
            | (((back >> 12) & 0xff) << 12)
            | 0x6f,
    );
    words[b] = branch(6, 1, 5, 4 * (t - b) as i32); // bltu x1, x5, T
    poke(&mut m, DRAM_BASE, &words);
    poke(
        &mut m,
        HANDLER,
        &[
            0x0200_4E37, // lui  x28, 0x2004 (mtimecmp)
            0xFFF0_0E93, // addi x29, x0, -1
            0x01DE_3023, // sd   x29, 0(x28): disarm
            csrrs(11, MSCRATCH, 0),
            csrrs(12, MEPC, 0),
            add(13, 13, 12),
            addi(10, 10, 1),
            MRET,
        ],
    );
    let clint = m.enable_clint(1); // mtime == retired
    clint.borrow_mut().mtimecmp = mtimecmp;
    set_csr(&mut m, MTVEC, HANDLER);
    set_csr(&mut m, MIE, 1 << 7);
    set_csr(&mut m, MSTATUS, 1 << 3);
    m.hart_mut().regs.write(1, 3000);
    m.hart_mut().regs.write(5, 2000); // late phase once x1 < 2000
    m.hart_mut().regs.pc = DRAM_BASE;
    m
}

/// `expect_rebuilds`: the executor direct-chains in module (the inline browser executor), so the
/// evicted-partial continuation MUST be reached; an executor that runs one block per host call
/// (native wasmtime, the private browser form) must never need it.
pub fn evicted_partial_chain(make: Factory, expect_rebuilds: bool) {
    // (decoded-cache capacity, lead, thrash blocks): layouts whose slot collisions evict P while
    // Q stays resident.
    for (cap, lead, thrash) in [(4usize, 0u32, 1u32), (4, 2, 3), (8, 1, 5)] {
        let iteration = 3 + 1 + u64::from(thrash) + 1 + 2;
        let budget = 16_000;
        let mut rebuilds = 0;
        let mut jit_retired = 0;
        // Deep in the late phase: every instruction position of three consecutive iterations.
        let first = 12_000;
        for mtimecmp in first..first + 3 * iteration {
            let label = format!("evicted partial chain cap={cap} lead={lead} thrash={thrash}");
            let mut want = build_evicted_partial_chain(lead, thrash, mtimecmp);
            want.set_block_cache(true);
            want.set_block_cache_capacity(cap);
            want.set_interrupt_batching(true);
            want.run(budget);
            let mut got = build_evicted_partial_chain(lead, thrash, mtimecmp);
            let executor = make(&got);
            got.set_executor(executor);
            got.set_block_cache(true);
            got.set_block_cache_capacity(cap);
            got.set_interrupt_batching(true);
            got.set_hotness_threshold(1);
            got.set_jit(true);
            got.run(budget);
            assert_eq!(
                want.irq_stats().int[7],
                1,
                "{label}: the timer must fire once"
            );
            assert_same(&format!("{label} mtimecmp={mtimecmp}"), &mut want, &mut got);
            // The handler's accumulated `mepc`: the exact interrupted instruction.
            assert_eq!(
                want.hart().regs.read(13),
                got.hart().regs.read(13),
                "{label} mtimecmp={mtimecmp}: mepc"
            );
            rebuilds += got.jit_partial_resume_rebuilds();
            jit_retired += got.executor().unwrap().retired_via_jit();
        }
        eprintln!("cap={cap} lead={lead} thrash={thrash}: rebuilds={rebuilds} jit={jit_retired}");
        assert!(jit_retired > 0, "the JIT must execute compiled code");
        if expect_rebuilds {
            assert!(
                rebuilds > 0,
                "cap={cap} lead={lead} thrash={thrash}: the layout must chain into an evicted \
                 partial block (adjust the layout if the decoded-cache hash changed)"
            );
        } else {
            assert_eq!(
                rebuilds, 0,
                "one block per host call never loses its entry block"
            );
        }
    }
}
