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
#![allow(clippy::identity_op)] // the RV64 field-encoders keep every field term for legibility

use std::cell::Cell;
use std::rc::Rc;

use js_sys::{Function, Object, WebAssembly};
use wasm_bindgen::{JsCast, closure::Closure, externref_heap_live_count};
use wasm_bindgen_test::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::csr::{
    CsrOp, MCAUSE, MEPC, MIE, MSTATUS, MTVEC, SCAUSE, SEPC, SIE, SSTATUS, STVEC,
};
use wasm_vm_core::decode::{AmoOp, Instr};
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, EvictPolicy, ExitCode, JitCacheBudget};
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::platform::virt;
use wasm_vm_core::ram::Ram;
use wasm_vm_wasm::{BROWSER_MAX_BATCHES, BrowserExecutor};

#[wasm_bindgen::prelude::wasm_bindgen(inline_js = r#"
let originalUint8Subarray;
let uint8SubarrayCalls = 0;
let originalUint8ArrayConstructor;
let uint8ArrayConstructorCalls = 0;

export function beginUint8SubarrayAudit() {
    if (originalUint8Subarray !== undefined) {
        throw new Error("Uint8Array.subarray audit is already active");
    }
    originalUint8Subarray = Uint8Array.prototype.subarray;
    uint8SubarrayCalls = 0;
    Uint8Array.prototype.subarray = function(...args) {
        uint8SubarrayCalls += 1;
        return originalUint8Subarray.apply(this, args);
    };
}

export function finishUint8SubarrayAudit() {
    const calls = uint8SubarrayCalls;
    Uint8Array.prototype.subarray = originalUint8Subarray;
    originalUint8Subarray = undefined;
    uint8SubarrayCalls = 0;
    return calls;
}

export function beginUint8ArrayConstructorAudit() {
    if (originalUint8ArrayConstructor !== undefined) {
        throw new Error("Uint8Array constructor audit is already active");
    }
    originalUint8ArrayConstructor = globalThis.Uint8Array;
    uint8ArrayConstructorCalls = 0;
    globalThis.Uint8Array = new Proxy(originalUint8ArrayConstructor, {
        construct(target, args, newTarget) {
            uint8ArrayConstructorCalls += 1;
            return Reflect.construct(target, args, newTarget);
        },
    });
}

export function finishUint8ArrayConstructorAudit() {
    const calls = uint8ArrayConstructorCalls;
    globalThis.Uint8Array = originalUint8ArrayConstructor;
    originalUint8ArrayConstructor = undefined;
    uint8ArrayConstructorCalls = 0;
    return calls;
}

export function catchesJsException(callback) {
    try {
        callback();
        return false;
    } catch {
        return true;
    }
}

export function throwUnexpectedJitException() {
    throw 1;
}
"#)]
extern "C" {
    #[wasm_bindgen(js_name = beginUint8SubarrayAudit)]
    fn begin_uint8_subarray_audit();
    #[wasm_bindgen(js_name = finishUint8SubarrayAudit)]
    fn finish_uint8_subarray_audit() -> u32;
    #[wasm_bindgen(js_name = beginUint8ArrayConstructorAudit)]
    fn begin_uint8_array_constructor_audit();
    #[wasm_bindgen(js_name = finishUint8ArrayConstructorAudit)]
    fn finish_uint8_array_constructor_audit() -> u32;
    #[wasm_bindgen(js_name = catchesJsException)]
    fn catches_js_exception(callback: &Function) -> bool;
    #[wasm_bindgen(js_name = throwUnexpectedJitException)]
    fn throw_unexpected_jit_exception();
}

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
fn enc_lw(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (0b010 << 12) | (rd << 7) | 0b0000011
}
fn enc_sw(rs1: u32, rs2: u32, imm: i32) -> u32 {
    let imm = imm as u32;
    ((imm >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | (0b010 << 12) | ((imm & 0x1f) << 7) | 0b0100011
}
fn enc_csrrs(rd: u32, csr: u32, rs1: u32) -> u32 {
    (csr << 20) | (rs1 << 15) | (0b010 << 12) | (rd << 7) | 0b1110011
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

#[derive(Debug, PartialEq, Eq)]
struct InterruptSnapshot {
    pc: u64,
    epc: u64,
    cause: u64,
    mstatus: u64,
    target_side_effect: u64,
}

fn read_csr(machine: &mut Machine, addr: u16) -> u64 {
    machine
        .hart_mut()
        .csr
        .access(addr, CsrOp::Set, 0, true, false, 0)
        .expect("test CSR read succeeds")
}

fn run_machine_xie_enable_case(supervisor: bool, with_browser_jit: bool) -> InterruptSnapshot {
    const HANDLER_OFFSET: u64 = 0x100;
    let code = if supervisor {
        virt::KERNEL_BASE
    } else {
        DRAM_BASE
    };
    let handler = code + HANDLER_OFFSET;
    let successor = code + 8;
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.enable_clint(1);

    if supervisor {
        machine.boot_supervisor(0, 0);
        machine
            .hart_mut()
            .csr
            .access(SIE, CsrOp::Write, 1 << 5, false, false, 0)
            .expect("S-mode STIE setup succeeds");
        machine.hart_mut().csr.set_mip_bit(5, true);
        machine
            .hart_mut()
            .csr
            .access(STVEC, CsrOp::Write, handler, false, false, 0)
            .expect("stvec setup succeeds");
    } else {
        machine
            .bus_mut()
            .store64(virt::CLINT_BASE + 0x4000, 0)
            .expect("mtimecmp setup succeeds");
        machine
            .hart_mut()
            .csr
            .access(MIE, CsrOp::Write, 1 << 7, false, false, 0)
            .expect("M-mode MTIE setup succeeds");
        machine
            .hart_mut()
            .csr
            .access(MTVEC, CsrOp::Write, handler, false, false, 0)
            .expect("mtvec setup succeeds");
    }

    let enable = if supervisor { 1 << 1 } else { 1 << 3 };
    let csr = if supervisor {
        SSTATUS as u32
    } else {
        MSTATUS as u32
    };
    poke(
        &mut machine,
        code,
        &[
            enc_addi(5, 0, enable),
            enc_csrrs(0, csr, 5),
            enc_addi(6, 6, 1),
            enc_jal(0, 4),
        ],
    );
    poke(&mut machine, handler, &[enc_addi(7, 7, 1), enc_jal(0, 4)]);
    machine.hart_mut().regs.pc = code;

    if with_browser_jit {
        machine.set_block_cache(true);
        machine.set_interrupt_batching(true);
        machine.set_hotness_threshold(1);
        machine.set_jit(true);
        let mut executor =
            BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
        executor.install(&block(
            successor,
            &[
                Instr::Addi {
                    rd: 6,
                    rs1: 6,
                    imm: 1,
                },
                Instr::Jal { rd: 0, imm: 4 },
            ],
        ));
        machine.set_executor(Box::new(executor));
        assert!(
            machine
                .executor()
                .is_some_and(|executor| executor.is_compiled(successor)),
            "interrupt test successor must be precompiled before guest execution"
        );
    }

    machine.run(3);
    let epc_addr = if supervisor { SEPC } else { MEPC };
    let cause_addr = if supervisor { SCAUSE } else { MCAUSE };
    InterruptSnapshot {
        pc: machine.hart().regs.pc,
        epc: read_csr(&mut machine, epc_addr),
        cause: read_csr(&mut machine, cause_addr),
        mstatus: machine.hart().csr.mstatus,
        target_side_effect: machine.hart().regs.read(6),
    }
}

#[wasm_bindgen_test]
fn browser_machine_xie_enable_preempts_reused_inline_target() {
    let cases = [(false, (1u64 << 63) | 7), (true, (1u64 << 63) | 5)];
    for (supervisor, cause) in cases {
        let oracle = run_machine_xie_enable_case(supervisor, false);
        let browser = run_machine_xie_enable_case(supervisor, true);
        assert_eq!(browser, oracle, "browser interrupt state diverged");
        assert_eq!(browser.cause, cause);
        assert_eq!(
            browser.epc,
            if supervisor {
                virt::KERNEL_BASE + 8
            } else {
                DRAM_BASE + 8
            }
        );
        assert_eq!(
            browser.target_side_effect, 0,
            "compiled successor must not run"
        );
        if supervisor {
            assert_eq!(browser.pc, virt::KERNEL_BASE + 0x100);
            assert_eq!(browser.mstatus & ((1 << 1) | (1 << 5)), 1 << 5);
        } else {
            assert_eq!(browser.pc, DRAM_BASE + 0x100);
            assert_eq!(browser.mstatus & ((1 << 3) | (1 << 7)), 1 << 7);
        }
    }
}

#[wasm_bindgen_test]
fn browser_inline_tlb_matches_interpreter_for_ram_loop() {
    // The first load and store miss and refill separate read/write TLB entries; later iterations
    // must take the generated raw-memory hit path while preserving the interpreter's result.
    let scratch = DRAM_BASE + 0x1000;
    let prog = [
        enc_lw(2, 10, 0),
        enc_addi(2, 2, 1),
        enc_sw(10, 2, 0),
        enc_addi(1, 1, -1),
        enc_bne(1, 0, -16),
        ECALL,
    ];

    let mut oracle = Machine::new(8 * 1024 * 1024);
    poke(&mut oracle, DRAM_BASE, &prog);
    oracle.hart_mut().regs.write(1, 64);
    oracle.hart_mut().regs.write(10, scratch);
    oracle.hart_mut().regs.pc = DRAM_BASE;
    oracle.bus_mut().store32(scratch, 0).unwrap();
    oracle.run(500);

    let mut inline = Machine::new(8 * 1024 * 1024);
    poke(&mut inline, DRAM_BASE, &prog);
    inline.hart_mut().regs.write(1, 64);
    inline.hart_mut().regs.write(10, scratch);
    inline.hart_mut().regs.pc = DRAM_BASE;
    inline.bus_mut().store32(scratch, 0).unwrap();
    let executor = BrowserExecutor::new_inline(&inline).expect("inline TLB fits wasm memory");
    inline.set_executor(Box::new(executor));
    inline.set_block_cache(true);
    inline.set_interrupt_batching(true);
    inline.set_hotness_threshold(1);
    inline.set_jit(true);
    inline.run(500);

    assert_eq!(state(&inline), state(&oracle));
    assert_eq!(
        ram_window(&mut inline, scratch, 1),
        ram_window(&mut oracle, scratch, 1)
    );
    assert!(inline.executor().unwrap().executed_blocks() > 0);
}

#[wasm_bindgen_test]
fn production_browser_budget_stays_below_measured_instance_cliff() {
    let machine = Machine::new(8 * 1024 * 1024);
    let executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    let budget = executor.jit_cache_stats().budget;

    assert_eq!(budget.max_batches, BROWSER_MAX_BATCHES);
    assert_eq!(BROWSER_MAX_BATCHES, 24);
}

#[wasm_bindgen_test]
fn browser_inline_raw_store_commits_reservation_and_code_log() {
    const CODE: u64 = DRAM_BASE;
    const DATA: u64 = DRAM_BASE + 0x4000;
    const VALUE: u64 = 0x0123_4567_89AB_CDEF;
    let mut machine = Machine::new(8 * 1024 * 1024);
    let decoded = block(
        CODE,
        &[Instr::Sd {
            rs1: 6,
            rs2: 5,
            imm: 0,
        }],
    );
    machine.hart_mut().regs.write(5, VALUE);
    machine.hart_mut().regs.write(6, DATA);
    machine.hart_mut().regs.pc = CODE;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install(&decoded);
    let machine_ptr: *mut Machine = &mut machine;

    // The first store is an imported miss and fills the write TLB. The second is the raw inline
    // path, whose deferred host commit must preserve the ordinary store side effects.
    unsafe {
        executor
            .execute(CODE, (*machine_ptr).hart_mut(), (*machine_ptr).bus_mut())
            .expect("cold inline store returns cleanly");
    }
    machine.bus_mut().code_write_log_mut().clear();
    machine.hart_mut().resv = Some((DATA, 8));
    let exit = unsafe {
        executor
            .execute(CODE, (*machine_ptr).hart_mut(), (*machine_ptr).bus_mut())
            .expect("warm inline store returns cleanly")
    };

    assert_eq!(exit.code, ExitCode::Fallthrough);
    assert_eq!(exit.next_pc, CODE + 4);
    assert_eq!(machine.bus_mut().load64(DATA), Ok(VALUE));
    assert_eq!(
        machine.hart().resv,
        None,
        "raw store clears an overlapping reservation"
    );
    assert_eq!(
        machine.bus_mut().code_write_log_mut().as_slice(),
        &[DATA >> 12],
        "raw store publishes the physical page for JIT invalidation"
    );
}

#[wasm_bindgen_test]
fn browser_inline_data_store_stays_chained_but_atomic_successor_waits_for_commit() {
    const CODE: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    const DATA: u64 = DRAM_BASE + 0x4000;
    const VALUE: u64 = 10;

    let caller = block(
        CODE,
        &[
            Instr::Sd {
                rs1: 6,
                rs2: 5,
                imm: 0,
            },
            Instr::Jal {
                rd: 0,
                imm: (TARGET - (CODE + 4)) as i64,
            },
        ],
    );
    let data_target = block(
        TARGET,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.write(5, VALUE);
    machine.hart_mut().regs.write(6, DATA);
    machine.hart_mut().regs.pc = CODE;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install_batch(
        &[caller.clone(), data_target],
        &[[Some(1), None], [None, None]],
    );
    let machine_ptr: *mut Machine = &mut machine;

    // The cold store uses the imported path to fill the write TLB. It already has the correct
    // host-side commit semantics and therefore reaches the same-batch successor.
    unsafe {
        let first = executor
            .execute_with_budget(
                CODE,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("cold store chain returns cleanly");
        assert_eq!(first.retired, 4);
    }
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CODE;
    let warm = unsafe {
        executor
            .execute_with_budget(
                CODE,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("warm data store chain returns cleanly")
    };
    assert_eq!(warm.code, ExitCode::BranchTaken);
    assert_eq!(
        warm.retired, 4,
        "raw data store must not abort its clean successor"
    );
    assert_eq!(machine.hart().regs.read(2), 1);
    assert_eq!(machine.bus_mut().load64(DATA), Ok(VALUE));

    let atomic_target = block(
        TARGET,
        &[
            Instr::AmoW {
                op: AmoOp::Add,
                rd: 2,
                rs1: 6,
                rs2: 5,
                aq: false,
                rl: false,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut atomic_machine = Machine::new(8 * 1024 * 1024);
    atomic_machine.hart_mut().regs.write(5, 7);
    atomic_machine.hart_mut().regs.write(6, DATA);
    atomic_machine.hart_mut().regs.pc = CODE;
    let mut atomic_executor =
        BrowserExecutor::new_inline(&atomic_machine).expect("inline TLB fits wasm memory");
    atomic_executor.install_batch(&[caller, atomic_target], &[[Some(1), None], [None, None]]);
    let atomic_machine_ptr: *mut Machine = &mut atomic_machine;

    // Warm the write TLB and let the cold imported store reach the atomic successor. The AMO's
    // import aborts the chain itself, so this call also establishes the baseline for the warm hit.
    unsafe {
        atomic_executor
            .execute_with_budget(
                CODE,
                (*atomic_machine_ptr).hart_mut(),
                (*atomic_machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("cold store plus atomic successor returns cleanly");
    }
    atomic_machine.bus_mut().store32(DATA, 0).unwrap();
    atomic_machine.hart_mut().regs.write(2, 0);
    atomic_machine.hart_mut().regs.pc = CODE;
    let stopped = unsafe {
        atomic_executor
            .execute_with_budget(
                CODE,
                (*atomic_machine_ptr).hart_mut(),
                (*atomic_machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("pending raw store stops before atomic successor")
    };
    assert_eq!(stopped.code, ExitCode::Budget);
    assert_eq!(
        stopped.retired, 2,
        "caller prefix commits before the atomic barrier"
    );
    assert_eq!(stopped.next_pc, TARGET);
    assert_eq!(atomic_machine.bus_mut().load32(DATA), Ok(7));
    assert_eq!(
        atomic_machine.hart().regs.read(2),
        0,
        "AMO must not run before host commit"
    );
}

#[wasm_bindgen_test]
fn browser_inline_raw_store_to_compiled_page_aborts_before_successor() {
    const CODE: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    const CODE_DATA: u64 = CODE + 0x200;

    let caller = block(
        CODE,
        &[
            Instr::Sd {
                rs1: 6,
                rs2: 5,
                imm: 0,
            },
            Instr::Jal {
                rd: 0,
                imm: (TARGET - (CODE + 4)) as i64,
            },
        ],
    );
    let target = block(
        TARGET,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.write(5, 0x55);
    machine.hart_mut().regs.write(6, CODE_DATA);
    machine.hart_mut().regs.pc = CODE;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install_batch(&[caller, target], &[[Some(1), None], [None, None]]);
    let machine_ptr: *mut Machine = &mut machine;

    // The imported cold store sees the compiled page through the host authority check and must
    // return before the target. This also warms the write-TLB slot for the raw-store assertion.
    unsafe {
        let cold = executor
            .execute_with_budget(
                CODE,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("cold code-page store returns through the host barrier");
        assert_eq!(cold.retired, 2);
    }
    machine.bus_mut().code_write_log_mut().clear();
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CODE;
    let warm = unsafe {
        executor
            .execute_with_budget(
                CODE,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("raw code-page store returns before stale successor")
    };
    assert_eq!(warm.code, ExitCode::BranchTaken);
    assert_eq!(
        warm.retired, 2,
        "compiled-page bitmap must abort the raw-store chain"
    );
    assert_eq!(warm.next_pc, TARGET);
    assert_eq!(
        machine.hart().regs.read(2),
        0,
        "successor code must not run before invalidation"
    );
    assert_eq!(
        machine.bus_mut().code_write_log_mut().as_slice(),
        &[CODE >> 12],
        "raw store records the page that the core must invalidate"
    );
}

#[wasm_bindgen_test]
fn browser_run_chunk_scope_caps_all_internal_subruns_to_eight_installs() {
    const BLOCKS: usize = 40;
    const INTERNAL_RUNS: usize = 31;
    const WORK: u64 = 16_384;
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

    let mut browser = Machine::new(8 * 1024 * 1024);
    poke(&mut browser, DRAM_BASE, &program);
    browser.hart_mut().regs.pc = DRAM_BASE;
    browser.set_executor(Box::new(BrowserExecutor::new()));
    browser.set_block_cache(true);
    browser.set_interrupt_batching(true);
    browser.set_hotness_threshold(1);
    browser.set_jit(true);

    // WasmLinux::runChunk uses this exact outer scope around its UART/persistence sub-runs. Four
    // internal calls must share the BrowserExecutor's eight-block budget instead of resetting it.
    browser.begin_cooperative_run();
    for _ in 0..INTERNAL_RUNS {
        oracle.run(WORK);
        browser.run(WORK);
    }
    browser.end_cooperative_run(wasm_vm_core::RunOutcome::MaxInstrs);
    let first = browser.prof_report(0, 0).jit_pause;
    assert_eq!(first.last_run_attempted_blocks, 8);
    assert_eq!(first.last_run_submitted_blocks, 8);
    assert_eq!(first.max_run_attempted_blocks, 8);
    assert_eq!(first.max_run_submitted_blocks, 8);
    assert!(first.last_run_staged_nominations <= 64);
    assert!(first.max_run_staged_nominations <= 64);
    assert!(first.last_final_pumps <= 1);
    assert_eq!(browser.executor().unwrap().compiled_count(), 8);
    assert_eq!(state(&oracle), state(&browser));

    // The remaining thirty-two blocks are not dropped: later JS-visible chunks install them under
    // the same eight-at-a-time ceiling, and compiled execution preserves architectural parity.
    for _ in 0..4 {
        browser.begin_cooperative_run();
        for _ in 0..INTERNAL_RUNS {
            oracle.run(WORK);
            browser.run(WORK);
        }
        browser.end_cooperative_run(wasm_vm_core::RunOutcome::MaxInstrs);
        let stats = browser.prof_report(0, 0).jit_pause;
        assert!(stats.last_run_attempted_blocks <= 8);
        assert!(stats.last_run_submitted_blocks <= 8);
        assert!(stats.last_run_staged_nominations <= 64);
        assert!(stats.max_final_pumps <= 1);
    }
    assert_eq!(browser.executor().unwrap().compiled_count(), BLOCKS);
    assert_eq!(state(&oracle), state(&browser));
    assert!(browser.executor().unwrap().executed_blocks() > 0);
}

#[wasm_bindgen_test]
fn browser_jit_six_op_loop_is_exactly_budgeted() {
    // Five ALU ops plus a backward branch. Before E4-T31 one `run(1000)` dispatch could execute
    // roughly 32 whole blocks per host slot; now the compiled tier may consume only the exact tail.
    let prog = [
        enc_addi(1, 1, 1),
        enc_addi(2, 2, 1),
        enc_addi(3, 3, 1),
        enc_addi(4, 4, 1),
        enc_addi(5, 5, 1),
        enc_bne(31, 0, -20),
    ];
    let mut m = Machine::new(8 * 1024 * 1024);
    poke(&mut m, DRAM_BASE, &prog);
    m.hart_mut().regs.write(31, 1);
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_executor(Box::new(BrowserExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
    m.run(192); // warm + end-of-run compile flush
    assert!(m.executor().unwrap().is_compiled(DRAM_BASE));

    m.hart_mut().regs.pc = DRAM_BASE;
    let executed_before = m.executor().unwrap().executed_blocks();
    let jit_before = m.executor().unwrap().retired_via_jit();
    let retired_before = m.irq_stats().retired;
    assert_eq!(m.run(5), wasm_vm_core::RunOutcome::MaxInstrs);
    assert_eq!(m.irq_stats().retired - retired_before, 5);
    assert_eq!(m.executor().unwrap().executed_blocks(), executed_before);
    assert_eq!(m.executor().unwrap().retired_via_jit(), jit_before);

    m.hart_mut().regs.pc = DRAM_BASE;
    let executed_before = m.executor().unwrap().executed_blocks();
    let jit_before = m.executor().unwrap().retired_via_jit();
    let retired_before = m.irq_stats().retired;
    assert_eq!(m.run(1_000), wasm_vm_core::RunOutcome::MaxInstrs);
    assert_eq!(m.irq_stats().retired - retired_before, 1_000);
    assert!(m.executor().unwrap().executed_blocks() > executed_before);
    assert_eq!(m.executor().unwrap().retired_via_jit() - jit_before, 996);
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
fn browser_inline_direct_chain_reports_bounded_retirement() {
    let mut machine = Machine::new(8 * 1024 * 1024);
    let loop_block = block(
        DRAM_BASE,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: -4 },
        ],
    );
    machine.hart_mut().regs.pc = DRAM_BASE;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install_batch(&[loop_block], &[[Some(0), None]]);

    let machine_ptr: *mut Machine = &mut machine;
    // The public test-only executor API accepts the two disjoint machine components separately;
    // use the raw machine pointer to express that split to the borrow checker.
    let exit = unsafe {
        executor
            .execute_with_budget(
                DRAM_BASE,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                64,
                16,
                true,
            )
            .expect("compiled direct chain returns a bounded exit")
    };

    assert_eq!(exit.code, ExitCode::Budget);
    assert_eq!(exit.retired, 16);
    assert_eq!(machine.hart().regs.read(1), 8);
    assert_eq!(machine.hart().regs.pc, DRAM_BASE);
    assert_eq!(executor.direct_chain_entries(), 8);
    assert_eq!(executor.direct_chain_links(), 7);
}

#[wasm_bindgen_test]
fn browser_inline_direct_chain_honors_depth_budget() {
    const FIRST: u64 = DRAM_BASE;
    const SECOND: u64 = DRAM_BASE + 0x1000;
    let first = block(
        FIRST,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal {
                rd: 0,
                imm: (SECOND - (FIRST + 4)) as i64,
            },
        ],
    );
    let second = block(
        SECOND,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal {
                rd: 0,
                imm: FIRST as i64 - (SECOND as i64 + 4),
            },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.pc = FIRST;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install_batch(&[first, second], &[[Some(1), None], [Some(0), None]]);
    executor.set_chain_depth_budget(2);

    let machine_ptr: *mut Machine = &mut machine;
    let exit = unsafe {
        executor
            .execute_with_budget(
                FIRST,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                64,
                64,
                true,
            )
            .expect("depth-bounded direct chain returns cleanly")
    };

    assert_eq!(exit.code, ExitCode::BranchTaken);
    assert_eq!(exit.retired, 4);
    assert_eq!(exit.next_pc, FIRST);
    assert_eq!(machine.hart().regs.read(1), 1);
    assert_eq!(machine.hart().regs.read(2), 1);
    assert_eq!(executor.direct_chain_entries(), 2);
    assert_eq!(executor.direct_chain_links(), 1);
}

#[wasm_bindgen_test]
fn browser_batch_skips_unsupported_members_without_fragmenting_valid_blocks() {
    let first = block(
        DRAM_BASE,
        &[Instr::Addi {
            rd: 5,
            rs1: 5,
            imm: 1,
        }],
    );
    let unsupported = block(
        DRAM_BASE + 0x100,
        &[Instr::Csrrw {
            rd: 1,
            rs1: 2,
            csr: 0x300,
        }],
    );
    let last = block(
        DRAM_BASE + 0x200,
        &[Instr::Addi {
            rd: 6,
            rs1: 6,
            imm: 1,
        }],
    );
    let mut executor = BrowserExecutor::new();
    executor.install_batch(
        &[first, unsupported.clone(), last],
        &[[None, None], [None, None], [None, None]],
    );

    assert_eq!(executor.compiled_count(), 2);
    assert_eq!(executor.module_count(), 1);
    assert_eq!(executor.jit_cache_stats().installs, 2);
    assert!(!executor.is_compiled(unsupported.phys_start));
}

#[wasm_bindgen_test]
fn browser_inline_static_cross_batch_link_executes_and_misses_safely() {
    // A static JAL target in a separate batch exercises E4-T35's edge-local path. The first call is
    // an unlinked miss; linking the resolved physical target must make the second call enter it
    // directly without using the E4-T34 virtual-target cache.
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    let caller = block(
        CALLER,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal {
                rd: 0,
                imm: (TARGET - (CALLER + 4)) as i64,
            },
        ],
    );
    let target = block(
        TARGET,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install(&caller);
    executor.install(&target);
    assert!(executor.is_compiled(CALLER));
    assert!(executor.is_compiled(TARGET));
    assert_eq!(executor.module_count(), 2);

    machine.hart_mut().regs.pc = CALLER;
    let machine_ptr: *mut Machine = &mut machine;
    let miss = unsafe {
        executor.execute_with_budget(
            CALLER,
            (*machine_ptr).hart_mut(),
            (*machine_ptr).bus_mut(),
            16,
            16,
            false,
        )
    };
    assert!(
        miss.is_some(),
        "static target miss returned no executor exit"
    );
    let miss = miss.unwrap();
    assert_eq!(miss.code, ExitCode::BranchTaken);
    assert_eq!(miss.retired, 2);
    assert_eq!(miss.next_pc, TARGET);
    assert_eq!(machine.hart().regs.read(1), 1);
    assert_eq!(machine.hart().regs.read(2), 0);

    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    executor.link_edge(CALLER, 0, TARGET);
    let hit = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("published static target executes through the guarded table")
    };
    assert_eq!(hit.code, ExitCode::BranchTaken);
    assert_eq!(hit.retired, 4, "caller and static target must both retire");
    assert_eq!(hit.next_pc, TARGET + 8);
    assert_eq!(machine.hart().regs.read(1), 1);
    assert_eq!(machine.hart().regs.read(2), 1);
}

#[wasm_bindgen_test]
fn browser_inline_static_link_retains_across_interrupt_stack_bits() {
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;

    for bit in [1u32, 3, 5, 7] {
        let caller = block(
            CALLER,
            &[
                Instr::Addi {
                    rd: 1,
                    rs1: 1,
                    imm: 1,
                },
                Instr::Jal {
                    rd: 0,
                    imm: (TARGET - (CALLER + 4)) as i64,
                },
            ],
        );
        let target = block(
            TARGET,
            &[
                Instr::Addi {
                    rd: 2,
                    rs1: 2,
                    imm: 1,
                },
                Instr::Jal { rd: 0, imm: 4 },
            ],
        );
        let mut machine = Machine::new(8 * 1024 * 1024);
        let mut executor =
            BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
        executor.install(&caller);
        executor.install(&target);
        let machine_ptr: *mut Machine = &mut machine;

        let cold = unsafe {
            executor
                .execute_with_budget(
                    CALLER,
                    (*machine_ptr).hart_mut(),
                    (*machine_ptr).bus_mut(),
                    16,
                    16,
                    false,
                )
                .expect("cold static caller establishes context")
        };
        assert_eq!(cold.retired, 2);
        executor.link_edge(CALLER, 0, TARGET);
        assert_eq!(executor.linked_target(CALLER, 0), Some(TARGET));

        let baseline = machine.hart().csr.mstatus;
        machine.hart_mut().csr.mstatus = baseline ^ (1u64 << bit);
        machine.hart_mut().regs.write(1, 0);
        machine.hart_mut().regs.write(2, 0);
        machine.hart_mut().regs.pc = CALLER;
        let hit = unsafe {
            executor
                .execute_with_budget(
                    CALLER,
                    (*machine_ptr).hart_mut(),
                    (*machine_ptr).bus_mut(),
                    16,
                    16,
                    true,
                )
                .expect("static target survives interrupt-stack bit change")
        };
        assert_eq!(
            hit.retired, 4,
            "static edge must enter target for bit {bit}"
        );
        assert_eq!(machine.hart().regs.read(2), 1);
        assert_eq!(executor.linked_target(CALLER, 0), Some(TARGET));
        assert_eq!(machine.hart().csr.mstatus, baseline ^ (1u64 << bit));
    }
}

#[wasm_bindgen_test]
fn browser_inline_static_guard_rejects_remapped_target_page() {
    // Keep the caller's published edge pointed at TARGET, then publish a second observed
    // VA=TARGET mapping to a different physical page through another source edge. The generated
    // tag still matches, but its EXEC-TLB addend now resolves to the wrong host page, so the caller
    // must return once to the host instead of entering TARGET.
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    const REMAP_SOURCE: u64 = DRAM_BASE + 0x2000;
    const REMAPPED: u64 = DRAM_BASE + 0x3000;
    let caller = block(
        CALLER,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal {
                rd: 0,
                imm: (TARGET - (CALLER + 4)) as i64,
            },
        ],
    );
    let target = block(
        TARGET,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let remap_source = block(
        REMAP_SOURCE,
        &[
            Instr::Addi {
                rd: 3,
                rs1: 3,
                imm: 1,
            },
            Instr::Jal {
                rd: 0,
                imm: (REMAPPED - (REMAP_SOURCE + 4)) as i64,
            },
        ],
    );
    let remapped = block(
        REMAPPED,
        &[
            Instr::Addi {
                rd: 4,
                rs1: 4,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.pc = CALLER;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    for decoded in [&caller, &target, &remap_source, &remapped] {
        executor.install(decoded);
    }
    let machine_ptr: *mut Machine = &mut machine;
    unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                false,
            )
            .expect("cold caller establishes the inline context");
    }
    executor.link_edge_authorized(CALLER, 0, TARGET, TARGET);
    executor.link_edge_authorized(REMAP_SOURCE, 0, TARGET, REMAPPED);

    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    let entries_before = executor.direct_chain_entries();
    let links_before = executor.direct_chain_links();
    let refused = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("a stale target mapping returns a clean host-visible exit")
    };
    assert_eq!(refused.code, ExitCode::BranchTaken);
    assert_eq!(refused.retired, 2);
    assert_eq!(refused.next_pc, TARGET);
    assert_eq!(machine.hart().regs.read(2), 0);
    assert_eq!(executor.direct_chain_entries() - entries_before, 1);
    assert_eq!(executor.direct_chain_links() - links_before, 0);

    executor.link_edge_authorized(CALLER, 0, TARGET, TARGET);
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    let rearmed = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("the authoritative mapping can re-arm the static edge")
    };
    assert_eq!(rearmed.retired, 4);
    assert_eq!(rearmed.next_pc, TARGET + 8);
    assert_eq!(machine.hart().regs.read(2), 1);
}

#[wasm_bindgen_test]
fn browser_inline_static_chain_reaches_five_blocks_in_one_engine_call() {
    // Eight separately-installed blocks make seven cross-module static edges. The first call only
    // establishes the inline-TLB context; the second is the measured warm call and must traverse
    // all eight logical blocks without returning to the host between them (>=7.3 blocks/entry).
    const BLOCKS: usize = 8;
    const PAGE: u64 = 0x1000;
    let blocks: Vec<DecodedBlock> = (0..BLOCKS)
        .map(|index| {
            let phys = DRAM_BASE + index as u64 * PAGE;
            let jump = if index + 1 < BLOCKS {
                Instr::Jal {
                    rd: 0,
                    imm: (phys + PAGE - (phys + 4)) as i64,
                }
            } else {
                // Leave the final edge unarmed so the chain returns with a normal BranchTaken.
                Instr::Jal { rd: 0, imm: 4 }
            };
            block(
                phys,
                &[
                    Instr::Addi {
                        rd: 1,
                        rs1: 1,
                        imm: 1,
                    },
                    jump,
                ],
            )
        })
        .collect();

    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.pc = DRAM_BASE;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    for decoded in &blocks {
        executor.install(decoded);
    }

    let machine_ptr: *mut Machine = &mut machine;
    let cold = unsafe {
        executor
            .execute_with_budget(
                DRAM_BASE,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                64,
                64,
                false,
            )
            .expect("unlinked first block returns a clean exit")
    };
    assert_eq!(cold.retired, 2);
    assert_eq!(cold.next_pc, DRAM_BASE + PAGE);

    for index in 0..BLOCKS - 1 {
        let from = DRAM_BASE + index as u64 * PAGE;
        let to = from + PAGE;
        executor.link_edge(from, 0, to);
        assert_eq!(executor.linked_target(from, 0), Some(to));
    }
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.pc = DRAM_BASE;
    let warm = unsafe {
        executor
            .execute_with_budget(
                DRAM_BASE,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                64,
                64,
                true,
            )
            .expect("warm edge-local chain returns a clean exit")
    };

    assert_eq!(warm.code, ExitCode::BranchTaken);
    assert_eq!(warm.retired, (BLOCKS * 2) as u64);
    assert_eq!(warm.next_pc, DRAM_BASE + (BLOCKS as u64 - 1) * PAGE + 8);
    assert_eq!(machine.hart().regs.read(1), BLOCKS as u64);
    assert!(
        executor.direct_chain_entries() >= 8,
        "warm call must enter at least 7.3 logical blocks"
    );
    assert!(executor.direct_chain_links() >= 7);
}

#[wasm_bindgen_test]
fn browser_inline_static_cross_page_tail_refuses_before_target_entry() {
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    let caller = block(
        CALLER,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal {
                rd: 0,
                imm: (TARGET - (CALLER + 4)) as i64,
            },
        ],
    );
    let target = block(
        TARGET,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.pc = CALLER;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install(&caller);
    executor.install(&target);
    let machine_ptr: *mut Machine = &mut machine;
    unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                false,
            )
            .expect("cold caller establishes the inline context");
    }
    executor.link_edge_authorized(CALLER, 0, TARGET, TARGET);
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    let links_before = executor.direct_chain_links();
    let tail = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                3,
                3,
                true,
            )
            .expect("the caller prefix fits and the target tail is refused")
    };
    assert_eq!(tail.code, ExitCode::Budget);
    assert_eq!(tail.retired, 2);
    assert_eq!(tail.next_pc, TARGET);
    assert_eq!(machine.hart().regs.read(1), 1);
    assert_eq!(machine.hart().regs.read(2), 0);
    assert_eq!(executor.direct_chain_links(), links_before);

    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    let full = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("the same edge executes once the target fits")
    };
    assert_eq!(full.retired, 4);
    assert_eq!(full.next_pc, TARGET + 8);
    assert_eq!(machine.hart().regs.read(2), 1);
}

#[wasm_bindgen_test]
fn browser_inline_static_link_refuses_after_execute_permission_change() {
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    let caller = block(
        CALLER,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal {
                rd: 0,
                imm: (TARGET - (CALLER + 4)) as i64,
            },
        ],
    );
    let target = block(
        TARGET,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.pc = CALLER;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install(&caller);
    executor.install(&target);
    let machine_ptr: *mut Machine = &mut machine;
    unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                false,
            )
            .expect("cold caller establishes the inline context");
    }
    executor.link_edge_authorized(CALLER, 0, TARGET, TARGET);

    // Locked TOR entry 0 grants the caller page R/W/X; entry 1 covers TARGET and removes X. The
    // PMP revision is part of the inline-TLB context, so the executor must clear the speculative
    // static edge before the next generated call and let the architectural fetch reject TARGET.
    let pmp = &mut machine.hart_mut().csr.pmp;
    pmp.write_addr(0, TARGET >> 2);
    pmp.write_addr(1, (TARGET + 0x1000) >> 2);
    pmp.write_cfg(0, 0x8f | (0x8b_u64 << 8));
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    let refused = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("execute-permission change falls back before the target call")
    };
    assert_eq!(refused.code, ExitCode::BranchTaken);
    assert_eq!(refused.retired, 2);
    assert_eq!(refused.next_pc, TARGET);
    assert_eq!(machine.hart().regs.read(2), 0);
}

#[wasm_bindgen_test]
fn browser_inline_static_cross_batch_load_store_matches_interpreter() {
    // The static edge is only useful if it preserves the same RAM effects as the interpreter. A
    // cold pass fills both inline TLB directions; the warm pass links caller -> target and compares
    // the complete register file plus the shared data word after eight retired instructions.
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    const DATA: u64 = DRAM_BASE + 0x4000;
    const INITIAL: u32 = 5;
    let caller_ops = [
        Instr::Lw {
            rd: 2,
            rs1: 6,
            imm: 0,
        },
        Instr::Addi {
            rd: 2,
            rs1: 2,
            imm: 1,
        },
        Instr::Sw {
            rs1: 6,
            rs2: 2,
            imm: 0,
        },
        Instr::Jal {
            rd: 0,
            imm: (TARGET - (CALLER + 12)) as i64,
        },
    ];
    let target_ops = [
        Instr::Lw {
            rd: 3,
            rs1: 6,
            imm: 0,
        },
        Instr::Addi {
            rd: 3,
            rs1: 3,
            imm: 2,
        },
        Instr::Sw {
            rs1: 6,
            rs2: 3,
            imm: 0,
        },
        Instr::Jal {
            rd: 0,
            imm: CALLER as i64 - (TARGET as i64 + 12),
        },
    ];
    let caller = block(CALLER, &caller_ops);
    let target = block(TARGET, &target_ops);
    let caller_words = [
        enc_lw(2, 6, 0),
        enc_addi(2, 2, 1),
        enc_sw(6, 2, 0),
        enc_jal(0, (TARGET - (CALLER + 12)) as i32),
    ];
    let target_words = [
        enc_lw(3, 6, 0),
        enc_addi(3, 3, 2),
        enc_sw(6, 3, 0),
        enc_jal(0, (CALLER as i64 - (TARGET as i64 + 12)) as i32),
    ];

    let mut oracle = Machine::new(8 * 1024 * 1024);
    poke(&mut oracle, CALLER, &caller_words);
    poke(&mut oracle, TARGET, &target_words);
    oracle.hart_mut().regs.write(6, DATA);
    oracle.hart_mut().regs.pc = CALLER;
    oracle.bus_mut().store32(DATA, INITIAL).unwrap();
    assert_eq!(oracle.run(8), wasm_vm_core::RunOutcome::MaxInstrs);

    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.write(6, DATA);
    machine.hart_mut().regs.pc = CALLER;
    machine.bus_mut().store32(DATA, INITIAL).unwrap();
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install(&caller);
    executor.install(&target);
    let machine_ptr: *mut Machine = &mut machine;

    let cold = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                false,
            )
            .expect("cold load/store prefix returns before an unlinked target")
    };
    assert_eq!(cold.retired, 4);
    assert_eq!(cold.next_pc, TARGET);

    machine.bus_mut().store32(DATA, INITIAL).unwrap();
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.write(3, 0);
    machine.hart_mut().regs.pc = CALLER;
    executor.link_edge(CALLER, 0, TARGET);
    let warm = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("warm static load/store chain returns a clean exit")
    };

    assert_eq!(warm.code, ExitCode::BranchTaken);
    assert_eq!(warm.retired, 8);
    assert_eq!(warm.next_pc, CALLER);
    assert_eq!(state(&machine).0, state(&oracle).0);
    assert_eq!(
        machine.bus_mut().load32(DATA),
        oracle.bus_mut().load32(DATA)
    );
    assert_eq!(machine.bus_mut().load32(DATA), Ok(8));
    assert!(executor.direct_chain_entries() >= 2);
}

#[wasm_bindgen_test]
fn browser_inline_static_code_store_cuts_link_before_target_reuse() {
    // A raw store to a page containing a linked target must stop before the stale target and leave
    // the same page-granular invalidation record the core drains into `invalidate_page`.
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    const CODE_DATA: u64 = TARGET + 0x20;
    let caller = block(
        CALLER,
        &[
            Instr::Sw {
                rs1: 6,
                rs2: 5,
                imm: 0,
            },
            Instr::Jal {
                rd: 0,
                imm: (TARGET - (CALLER + 4)) as i64,
            },
        ],
    );
    let target = block(
        TARGET,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.write(5, 0x55);
    machine.hart_mut().regs.write(6, CODE_DATA);
    machine.hart_mut().regs.pc = CALLER;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install(&caller);
    executor.install(&target);
    let machine_ptr: *mut Machine = &mut machine;

    unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                false,
            )
            .expect("cold code-page store returns before the unlinked target");
    }
    machine.bus_mut().code_write_log_mut().clear();
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    executor.link_edge(CALLER, 0, TARGET);
    let stopped = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("compiled-page raw store returns before the stale target")
    };
    assert_eq!(stopped.retired, 2);
    assert_eq!(stopped.next_pc, TARGET);
    assert_eq!(machine.hart().regs.read(2), 0);
    assert_eq!(
        machine.bus_mut().code_write_log_mut().as_slice(),
        &[TARGET >> 12]
    );

    let dirty_frames = machine.bus_mut().code_write_log_mut().to_vec();
    machine.bus_mut().code_write_log_mut().clear();
    for frame in dirty_frames {
        executor.invalidate_page(frame);
    }
    assert!(!executor.is_compiled(TARGET));
    assert_eq!(executor.linked_target(CALLER, 0), None);
}

#[wasm_bindgen_test]
fn browser_inline_static_cross_batch_target_fault_is_precise() {
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    const FAULT_ADDR: u64 = 0x5000_0000;
    let caller = block(
        CALLER,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal {
                rd: 0,
                imm: (TARGET - (CALLER + 4)) as i64,
            },
        ],
    );
    let target = block(
        TARGET,
        &[Instr::Lw {
            rd: 2,
            rs1: 6,
            imm: 0,
        }],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.write(6, FAULT_ADDR);
    machine.hart_mut().regs.pc = CALLER;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install(&caller);
    executor.install(&target);
    let machine_ptr: *mut Machine = &mut machine;

    unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                false,
            )
            .expect("cold caller returns the unresolved target precisely");
    }
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.pc = CALLER;
    executor.link_edge(CALLER, 0, TARGET);
    let fault = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("static target fault is recorded as a precise exit")
    };

    assert_eq!(fault.code, ExitCode::Trap);
    assert_eq!(fault.next_pc, TARGET);
    assert_eq!(
        fault.retired, 2,
        "the caller retires before the target fault"
    );
    assert!(fault.trap.is_some());
    assert_eq!(machine.hart().regs.read(1), 1);
    assert_eq!(machine.hart().regs.read(2), 0);
}

#[wasm_bindgen_test]
fn browser_inline_static_link_unlinks_and_rearms_after_target_reinstall() {
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;
    let caller = block(
        CALLER,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal {
                rd: 0,
                imm: (TARGET - (CALLER + 4)) as i64,
            },
        ],
    );
    let target = block(
        TARGET,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.hart_mut().regs.pc = CALLER;
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    executor.install(&caller);
    executor.install(&target);
    let machine_ptr: *mut Machine = &mut machine;

    unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                false,
            )
            .expect("cold caller establishes the inline context");
    }
    executor.link_edge(CALLER, 0, TARGET);
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    let first = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("published target runs before invalidation")
    };
    assert_eq!(first.retired, 4);
    assert_eq!(machine.hart().regs.read(2), 1);
    assert_eq!(executor.linked_target(CALLER, 0), Some(TARGET));

    executor.invalidate_page(TARGET >> 12);
    assert!(!executor.is_compiled(TARGET));
    assert_eq!(executor.linked_target(CALLER, 0), None);
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    let miss = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("cleared static slot returns without calling the retired target")
    };
    assert_eq!(miss.retired, 2);
    assert_eq!(miss.next_pc, TARGET);
    assert_eq!(machine.hart().regs.read(2), 0);

    executor.install(&target);
    executor.link_edge(CALLER, 0, TARGET);
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    machine.hart_mut().regs.pc = CALLER;
    let rearmed = unsafe {
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                16,
                true,
            )
            .expect("reinstalled target is rearmed through its edge-local slot")
    };
    assert_eq!(rearmed.retired, 4);
    assert_eq!(rearmed.next_pc, TARGET + 8);
    assert_eq!(machine.hart().regs.read(2), 1);
}

#[wasm_bindgen_test]
fn browser_inline_dynamic_link_retains_across_interrupt_stack_bits_and_sum_invalidates() {
    const CALLER: u64 = DRAM_BASE;
    const TARGET: u64 = DRAM_BASE + 0x1000;

    for bit in [1u32, 3, 5, 7, 18] {
        let caller = block(
            CALLER,
            &[
                Instr::Addi {
                    rd: 1,
                    rs1: 1,
                    imm: 1,
                },
                Instr::Jalr {
                    rd: 0,
                    rs1: 6,
                    imm: 0,
                },
            ],
        );
        let target = block(
            TARGET,
            &[
                Instr::Addi {
                    rd: 2,
                    rs1: 2,
                    imm: 1,
                },
                Instr::Jal { rd: 0, imm: 4 },
            ],
        );
        let mut machine = Machine::new(8 * 1024 * 1024);
        let mut executor =
            BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
        executor.install_batch(&[caller, target], &[[None, None], [None, None]]);
        let machine_ptr: *mut Machine = &mut machine;

        machine.hart_mut().regs.write(6, TARGET);
        let cold = unsafe {
            executor
                .execute_with_budget(
                    CALLER,
                    (*machine_ptr).hart_mut(),
                    (*machine_ptr).bus_mut(),
                    16,
                    16,
                    false,
                )
                .expect("cold dynamic caller establishes context")
        };
        assert_eq!(cold.retired, 2);
        executor.link_dynamic_target(TARGET, TARGET);
        assert_eq!(executor.dynamic_link_stats().live_entries, 1);

        let baseline = machine.hart().csr.mstatus;
        machine.hart_mut().csr.mstatus = baseline ^ (1u64 << bit);
        machine.hart_mut().regs.write(1, 0);
        machine.hart_mut().regs.write(2, 0);
        machine.hart_mut().regs.pc = CALLER;
        let exit = unsafe {
            executor
                .execute_with_budget(
                    CALLER,
                    (*machine_ptr).hart_mut(),
                    (*machine_ptr).bus_mut(),
                    16,
                    16,
                    true,
                )
                .expect("dynamic target returns an executor exit")
        };

        if bit == 18 {
            assert_eq!(exit.retired, 2, "SUM must prevent stale dynamic entry");
            assert_eq!(machine.hart().regs.read(2), 0);
            assert_eq!(executor.dynamic_link_stats().live_entries, 0);
        } else {
            assert_eq!(
                exit.retired, 4,
                "dynamic edge must enter target for bit {bit}"
            );
            assert_eq!(machine.hart().regs.read(2), 1);
            assert_eq!(executor.dynamic_link_stats().hits, 1);
            assert_eq!(executor.dynamic_link_stats().live_entries, 1);
        }
        assert_eq!(machine.hart().csr.mstatus, baseline ^ (1u64 << bit));
    }
}

#[wasm_bindgen_test]
fn browser_inline_dynamic_jalr_links_switch_and_unlinks() {
    // E4-T37: four computed targets deliberately hash to one PIC set. The first four occupy the
    // bounded ways; a fifth target needs two observations before it can replace the LRU entry.
    // Every generated hit still has to pass the EXEC-TLB authority check before call_indirect.
    const CALLER: u64 = DRAM_BASE;
    // These offsets all produce dynamic-set zero for the cache hash and are separated far enough
    // apart that each two-instruction block has its own physical page.
    const TARGET_A: u64 = DRAM_BASE + 0x1554;
    const TARGET_B: u64 = DRAM_BASE + 0x2aa8;
    const TARGET_C: u64 = DRAM_BASE + 0x4550;
    const TARGET_D: u64 = DRAM_BASE + 0x5004;
    const TARGET_E: u64 = DRAM_BASE + 0x6ff8;
    const TARGETS: [u64; 5] = [TARGET_A, TARGET_B, TARGET_C, TARGET_D, TARGET_E];
    let caller = block(
        CALLER,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jalr {
                rd: 0,
                rs1: 6,
                imm: 0,
            },
        ],
    );
    let target_a = block(
        TARGET_A,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let target_b = block(
        TARGET_B,
        &[
            Instr::Addi {
                rd: 3,
                rs1: 3,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let target_c = block(
        TARGET_C,
        &[
            Instr::Addi {
                rd: 4,
                rs1: 4,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let target_d = block(
        TARGET_D,
        &[
            Instr::Addi {
                rd: 5,
                rs1: 5,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let target_e = block(
        TARGET_E,
        &[
            Instr::Addi {
                rd: 7,
                rs1: 7,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 },
        ],
    );
    let mut machine = Machine::new(8 * 1024 * 1024);
    let mut executor = BrowserExecutor::new_inline(&machine).expect("inline TLB fits wasm memory");
    // Put all candidates in one batch. There are no static edges in this group, so the dynamic PIC
    // is the only possible direct successor path and invalidating one target can retain the others.
    let blocks = [caller, target_a, target_b, target_c, target_d, target_e];
    executor.install_batch(&blocks, &[[None, None]; 6]);

    machine.hart_mut().regs.pc = CALLER;
    let machine_ptr: *mut Machine = &mut machine;
    let run_target = |executor: &mut BrowserExecutor, target: u64, budget: u64, chain: bool| unsafe {
        (*machine_ptr).hart_mut().regs.write(6, target);
        (*machine_ptr).hart_mut().regs.pc = CALLER;
        executor
            .execute_with_budget(
                CALLER,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
                16,
                budget,
                chain,
            )
            .expect("compiled dynamic caller returns an exit")
    };

    // The first inline-TLB call establishes the address-translation context and intentionally
    // clears speculative dynamic links. Production publishes the resolved target after this miss,
    // so mirror that ordering before asserting the fast path.
    let warmup = run_target(&mut executor, TARGET_A, 16, false);
    assert_eq!(warmup.retired, 2);
    assert_eq!(executor.dynamic_link_stats().attempts, 1);
    assert_eq!(executor.dynamic_link_stats().hits, 0);
    assert_eq!(executor.dynamic_link_stats().refusals, 1);
    assert_eq!(executor.dynamic_link_stats().live_entries, 0);
    assert_eq!(executor.dynamic_link_stats().installs, 0);

    // A target-side fuel refusal still enters the cached target, but does not execute its first
    // instruction. This exercises the bounded callee prologue without weakening PIC telemetry.
    executor.link_dynamic_target(TARGET_A, TARGET_A);
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    let fuel = run_target(&mut executor, TARGET_A, 3, true);
    assert_eq!(fuel.code, ExitCode::Budget);
    assert_eq!(fuel.retired, 2);
    assert_eq!(machine.hart().regs.read(2), 0);

    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    let exit = run_target(&mut executor, TARGET_A, 16, true);
    assert_eq!(exit.code, ExitCode::BranchTaken);
    assert_eq!(exit.retired, 4, "caller + target A must retire exactly");
    assert_eq!(exit.next_pc, TARGET_A + 8);
    assert_eq!(machine.hart().regs.read(1), 1);
    assert_eq!(machine.hart().regs.read(2), 1);
    assert_eq!(machine.hart().regs.read(3), 0);

    // Fill the other three ways. All four links execute through one compiled module, and no
    // repeated publication is needed to keep a stable target live.
    for (index, target) in TARGETS[..4].iter().copied().enumerate().skip(1) {
        executor.link_dynamic_target(target, target);
        machine.hart_mut().regs.write(1, 0);
        machine.hart_mut().regs.write((2 + index) as u8, 0);
        let exit = run_target(&mut executor, target, 16, true);
        assert_eq!(exit.code, ExitCode::BranchTaken);
        assert_eq!(exit.retired, 4);
        assert_eq!(exit.next_pc, target + 8);
        assert_eq!(machine.hart().regs.read((2 + index) as u8), 1);
    }

    let filled = executor.dynamic_link_stats();
    assert_eq!(filled.attempts, 6, "warmup + fuel + four hot probes");
    assert_eq!(
        filled.hits, 5,
        "fuel refusal still entered the cached target"
    );
    assert_eq!(filled.refusals, 1);
    assert_eq!(
        filled.live_entries, 4,
        "the PIC is bounded at four live targets"
    );
    assert_eq!(filled.installs, 4);
    assert_eq!(filled.retargets, 0);
    let compiled_installs = executor.jit_cache_stats().installs;
    let module_count = executor.module_count();

    // One observation of a fifth same-set target is only a pending retarget. The cache remains
    // live and the dispatcher/module registry does not churn.
    executor.link_dynamic_target(TARGET_E, TARGET_E);
    let pending = executor.dynamic_link_stats();
    assert_eq!(pending.live_entries, 4);
    assert_eq!(pending.installs, 4);
    assert_eq!(pending.retargets, 0);
    assert_eq!(executor.jit_cache_stats().installs, compiled_installs);
    assert_eq!(executor.module_count(), module_count);
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(7, 0);
    let pending_exit = run_target(&mut executor, TARGET_E, 16, true);
    assert_eq!(pending_exit.retired, 2);
    assert_eq!(machine.hart().regs.read(7), 0);

    // The second observation arms exactly one replacement, evicting the oldest target (A).
    executor.link_dynamic_target(TARGET_E, TARGET_E);
    let replaced = executor.dynamic_link_stats();
    assert_eq!(replaced.live_entries, 4);
    assert_eq!(replaced.installs, 5);
    assert_eq!(replaced.retargets, 1);
    assert_eq!(executor.jit_cache_stats().installs, compiled_installs);
    assert_eq!(executor.module_count(), module_count);

    // Target fuel is exhausted before E's first instruction, then a normal call succeeds. This
    // also confirms that replacement does not tear down the containing dispatcher/module.
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(7, 0);
    let fuel = run_target(&mut executor, TARGET_E, 3, true);
    assert_eq!(fuel.code, ExitCode::Budget);
    assert_eq!(fuel.retired, 2);
    assert_eq!(machine.hart().regs.read(7), 0);
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(7, 0);
    let exit = run_target(&mut executor, TARGET_E, 16, true);
    assert_eq!(exit.retired, 4);
    assert_eq!(machine.hart().regs.read(7), 1);

    // Stable re-publication after a retarget burst must not arm more replacements or grow the
    // live set. The counters are the direct proof that the dispatcher stayed bounded.
    for _ in 0..32 {
        executor.link_dynamic_target(TARGET_E, TARGET_E);
    }
    let stable = executor.dynamic_link_stats();
    assert_eq!(stable.live_entries, 4);
    assert_eq!(stable.installs, 5);
    assert_eq!(stable.retargets, 1);
    assert_eq!(executor.jit_cache_stats().installs, compiled_installs);
    assert_eq!(executor.module_count(), module_count);

    // Invalidate B while C remains hot. Removing one physical target clears only its PIC way.
    executor.invalidate_page(TARGET_B >> 12);
    assert!(!executor.is_compiled(TARGET_B));
    assert!(executor.is_compiled(TARGET_C));
    assert_eq!(executor.dynamic_link_stats().live_entries, 3);
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(4, 0);
    let hot = run_target(&mut executor, TARGET_C, 16, true);
    assert_eq!(hot.retired, 4);
    assert_eq!(machine.hart().regs.read(4), 1);

    // Sabotage only C's published authority word. The key and table index remain live, so this is
    // a generated EXEC-TLB/PA mismatch attack rather than a cache miss; no stale target may run.
    assert!(executor.set_dynamic_link_authority_for_test(TARGET_C, u32::MAX));
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(4, 0);
    let refused = run_target(&mut executor, TARGET_C, 16, true);
    assert_eq!(refused.code, ExitCode::BranchTaken);
    assert_eq!(refused.retired, 2);
    assert_eq!(refused.next_pc, TARGET_C);
    assert_eq!(machine.hart().regs.read(4), 0);

    // A was the LRU victim, so its old table index/key cannot be reached indirectly.
    machine.hart_mut().regs.write(1, 0);
    machine.hart_mut().regs.write(2, 0);
    let stale = run_target(&mut executor, TARGET_A, 16, true);
    assert_eq!(stale.code, ExitCode::BranchTaken);
    assert_eq!(stale.retired, 2);
    assert_eq!(stale.next_pc, TARGET_A);
    assert_eq!(machine.hart().regs.read(2), 0);

    executor.invalidate_all();
    assert_eq!(
        executor.dynamic_link_stats().live_entries,
        0,
        "whole-cache reset clears every live PIC entry"
    );
}

#[wasm_bindgen_test]
fn bulk_handoff_preserves_all_registers_and_virtual_pc_on_precise_fault() {
    const FAULT_ADDR: u64 = 0x5000_0000;
    const VIRTUAL_PC: u64 = 0x4000_1000;
    let seed =
        |register: u8| 0x8000_0000_0000_0000 | (u64::from(register) << 32) | u64::from(register);
    let mut ops = Vec::new();
    for register in 1..=29u8 {
        ops.push(MicroOp {
            instr: Instr::Addi {
                rd: register,
                rs1: register,
                imm: 1,
            },
            len: 4,
            raw: 0,
        });
    }
    ops.push(MicroOp {
        instr: Instr::Addi {
            rd: 30,
            rs1: 30,
            imm: 1,
        },
        len: 4,
        raw: 0,
    });
    ops.push(MicroOp {
        instr: Instr::Lw {
            rd: 31,
            rs1: 30,
            imm: 0,
        },
        len: 4,
        raw: 0,
    });
    let decoded = DecodedBlock::new(DRAM_BASE, ops, 31 * 4);

    let mut hart = Hart::default();
    for register in 1..32u8 {
        hart.regs.write(register, seed(register));
    }
    hart.regs.write(30, FAULT_ADDR - 1);
    hart.regs.pc = VIRTUAL_PC;
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut executor = BrowserExecutor::new();
    executor.install(&decoded);
    assert!(
        executor.fixed_state_view_survives_rejected_growth(DRAM_BASE),
        "fixed SoftMMU memory must reject growth without detaching the retained 568-byte view"
    );

    let exit = executor
        .execute(DRAM_BASE, &mut hart, &mut bus)
        .expect("recorded precise fault returns an exit");
    assert_eq!(executor.executed_blocks(), 1);
    assert_eq!(exit.code, ExitCode::Trap);
    assert_eq!(
        exit.trap,
        Some(Trap {
            cause: Exception::LoadAccessFault,
            tval: FAULT_ADDR,
        })
    );
    assert_eq!(exit.next_pc, VIRTUAL_PC + 30 * 4);
    assert_eq!(exit.exit_info, Exception::LoadAccessFault as u64);
    assert_eq!(hart.regs.pc, VIRTUAL_PC, "the caller owns PC commit");
    assert_eq!(hart.regs.read(0), 0);
    for register in 1..=29u8 {
        assert_eq!(hart.regs.read(register), seed(register).wrapping_add(1));
    }
    assert_eq!(hart.regs.read(30), FAULT_ADDR);
    assert_eq!(hart.regs.read(31), seed(31));
}

#[wasm_bindgen_test]
fn browser_clean_dispatch_reuses_cached_outer_view_without_constructor() {
    let decoded = block(
        DRAM_BASE,
        &[Instr::Addi {
            rd: 5,
            rs1: 5,
            imm: 1,
        }],
    );
    let mut executor = BrowserExecutor::new();
    executor.install(&decoded);
    let mut hart = Hart::default();
    hart.regs.write(5, 40);
    hart.regs.pc = DRAM_BASE;
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());

    // Installation may itself grow the outer Wasm memory after the executor created its first
    // view. Allow the first dispatch to perform that required one-time refresh, then prove steady
    // clean dispatches do not construct another view.
    let warm_exit = executor
        .execute(DRAM_BASE, &mut hart, &mut bus)
        .expect("warm compiled block exits cleanly");
    assert_eq!(warm_exit.code, ExitCode::Fallthrough);
    assert_eq!(hart.regs.read(5), 41);

    begin_uint8_array_constructor_audit();
    for expected in [42, 43] {
        let exit = executor
            .execute(DRAM_BASE, &mut hart, &mut bus)
            .expect("compiled block exits cleanly");
        assert_eq!(exit.code, ExitCode::Fallthrough);
        assert_eq!(hart.regs.read(5), expected);
    }
    let constructor_calls = finish_uint8_array_constructor_audit();

    assert_eq!(
        constructor_calls, 0,
        "clean dispatches must reuse the retained outer-Wasm handoff view"
    );
}

#[wasm_bindgen_test]
fn browser_dispatch_reuses_memory_views_without_subarray_allocation() {
    let decoded = block(
        DRAM_BASE,
        &[Instr::Addi {
            rd: 5,
            rs1: 5,
            imm: 1,
        }],
    );
    let mut executor = BrowserExecutor::new();
    executor.install(&decoded);
    let outer_memory = wasm_bindgen::memory().unchecked_into::<WebAssembly::Memory>();
    let old_outer_buffer = outer_memory.buffer();
    outer_memory.grow(1);
    assert!(
        !Object::is(old_outer_buffer.as_ref(), outer_memory.buffer().as_ref()),
        "outer wasm growth must replace the buffer and detach the executor's cached source view"
    );
    let mut hart = Hart::default();
    hart.regs.write(5, 41);
    hart.regs.pc = DRAM_BASE;
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());

    begin_uint8_subarray_audit();
    begin_uint8_array_constructor_audit();
    let exit = executor
        .execute(DRAM_BASE, &mut hart, &mut bus)
        .expect("compiled block exits cleanly");
    let constructor_calls = finish_uint8_array_constructor_audit();
    let subarray_calls = finish_uint8_subarray_audit();

    assert_eq!(exit.code, ExitCode::Fallthrough);
    assert_eq!(hart.regs.read(5), 42);
    assert_eq!(
        constructor_calls, 1,
        "one detached pre-call view must be rebound exactly once"
    );
    assert_eq!(
        subarray_calls, 0,
        "a retained handoff view must not construct Uint8Array subviews per dispatch"
    );
}

struct GrowOuterMemoryOnWrite {
    memory: WebAssembly::Memory,
    writes: Rc<Cell<u32>>,
    fault: bool,
}

impl MmioDevice for GrowOuterMemoryOnWrite {
    fn read(&mut self, _offset: u64, _width: Width) -> Result<u64, BusFault> {
        Ok(0)
    }

    fn write(&mut self, _offset: u64, width: Width, _value: u64) -> Result<(), BusFault> {
        assert_eq!(width, Width::B8);
        self.memory.grow(1);
        self.writes.set(self.writes.get() + 1);
        if self.fault {
            Err(BusFault::Access)
        } else {
            Ok(())
        }
    }
}

#[wasm_bindgen_test]
fn browser_handoff_refreshes_after_outer_growth_during_compiled_call() {
    const MMIO_BASE: u64 = 0x1000_0000;
    const WARM_PHYS: u64 = DRAM_BASE + 0x1000;
    let decoded = block(
        DRAM_BASE,
        &[
            Instr::Addi {
                rd: 5,
                rs1: 5,
                imm: 1,
            },
            Instr::Sd {
                rs1: 6,
                rs2: 5,
                imm: 0,
            },
        ],
    );
    let warm = block(
        WARM_PHYS,
        &[Instr::Addi {
            rd: 7,
            rs1: 7,
            imm: 1,
        }],
    );
    let writes = Rc::new(Cell::new(0));
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    bus.attach(
        MMIO_BASE,
        8,
        Box::new(GrowOuterMemoryOnWrite {
            memory: wasm_bindgen::memory().unchecked_into::<WebAssembly::Memory>(),
            writes: Rc::clone(&writes),
            fault: false,
        }),
    )
    .unwrap();
    let mut executor = BrowserExecutor::new();
    executor.install(&decoded);
    executor.install(&warm);
    let mut hart = Hart::default();
    hart.regs.write(5, 41);
    hart.regs.write(6, MMIO_BASE);
    hart.regs.pc = WARM_PHYS;
    executor
        .execute(WARM_PHYS, &mut hart, &mut bus)
        .expect("warm dispatch refreshes any view detached during installation");
    hart.regs.pc = DRAM_BASE;
    let live_before = externref_heap_live_count();

    begin_uint8_subarray_audit();
    begin_uint8_array_constructor_audit();
    let exit = executor
        .execute(DRAM_BASE, &mut hart, &mut bus)
        .expect("compiled MMIO store exits cleanly after growing outer memory");
    let constructor_calls = finish_uint8_array_constructor_audit();
    let subarray_calls = finish_uint8_subarray_audit();

    assert_eq!(subarray_calls, 0);
    assert_eq!(constructor_calls, 1, "mid-call growth requires one rebind");
    assert_eq!(exit.code, ExitCode::Fallthrough);
    assert_eq!(exit.next_pc, DRAM_BASE + 8);
    assert_eq!(writes.get(), 1);
    assert_eq!(hart.regs.read(5), 42);
    assert_eq!(hart.regs.read(6), MMIO_BASE);
    assert_eq!(
        externref_heap_live_count(),
        live_before,
        "refresh must replace, not accumulate, the detached outer-memory view"
    );
}

#[wasm_bindgen_test]
fn browser_handoff_refreshes_after_outer_growth_on_recorded_precise_fault() {
    const MMIO_BASE: u64 = 0x1000_0000;
    const VIRTUAL_PC: u64 = 0x4000_1000;
    const WARM_PHYS: u64 = DRAM_BASE + 0x1000;
    let decoded = block(
        DRAM_BASE,
        &[
            Instr::Addi {
                rd: 5,
                rs1: 5,
                imm: 1,
            },
            Instr::Sd {
                rs1: 6,
                rs2: 5,
                imm: 0,
            },
        ],
    );
    let warm = block(
        WARM_PHYS,
        &[Instr::Addi {
            rd: 7,
            rs1: 7,
            imm: 1,
        }],
    );
    let writes = Rc::new(Cell::new(0));
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    bus.attach(
        MMIO_BASE,
        8,
        Box::new(GrowOuterMemoryOnWrite {
            memory: wasm_bindgen::memory().unchecked_into::<WebAssembly::Memory>(),
            writes: Rc::clone(&writes),
            fault: true,
        }),
    )
    .unwrap();
    let mut executor = BrowserExecutor::new();
    executor.install(&decoded);
    executor.install(&warm);
    let mut hart = Hart::default();
    hart.regs.write(5, 41);
    hart.regs.write(6, MMIO_BASE);
    hart.regs.pc = WARM_PHYS;
    executor
        .execute(WARM_PHYS, &mut hart, &mut bus)
        .expect("warm dispatch refreshes any view detached during installation");
    hart.regs.pc = VIRTUAL_PC;
    let live_before = externref_heap_live_count();

    begin_uint8_subarray_audit();
    begin_uint8_array_constructor_audit();
    let exit = executor
        .execute(DRAM_BASE, &mut hart, &mut bus)
        .expect("recorded MMIO fault remains precise after growing outer memory");
    let constructor_calls = finish_uint8_array_constructor_audit();
    let subarray_calls = finish_uint8_subarray_audit();

    assert_eq!(subarray_calls, 0);
    assert_eq!(constructor_calls, 1, "faulting growth requires one rebind");
    assert_eq!(exit.code, ExitCode::Trap);
    assert_eq!(
        exit.trap,
        Some(Trap {
            cause: Exception::StoreAccessFault,
            tval: MMIO_BASE,
        })
    );
    assert_eq!(exit.next_pc, VIRTUAL_PC + 4);
    assert_eq!(exit.exit_info, Exception::StoreAccessFault as u64);
    assert_eq!(writes.get(), 1);
    assert_eq!(hart.regs.pc, VIRTUAL_PC, "the caller owns PC commit");
    assert_eq!(hart.regs.read(5), 42);
    assert_eq!(hart.regs.read(6), MMIO_BASE);
    assert_eq!(
        externref_heap_live_count(),
        live_before,
        "fault readback must replace, not accumulate, the detached outer-memory view"
    );
}

struct ThrowJsOnWrite {
    writes: Rc<Cell<u32>>,
}

impl MmioDevice for ThrowJsOnWrite {
    fn read(&mut self, _offset: u64, _width: Width) -> Result<u64, BusFault> {
        Ok(0)
    }

    fn write(&mut self, _offset: u64, width: Width, _value: u64) -> Result<(), BusFault> {
        assert_eq!(width, Width::B8);
        self.writes.set(self.writes.get() + 1);
        throw_unexpected_jit_exception();
        unreachable!("the inline JavaScript helper always throws")
    }
}

#[wasm_bindgen_test]
fn unexpected_js_exception_fails_closed_without_commit_and_cleans_host() {
    const MMIO_BASE: u64 = 0x1000_0000;
    const CLEAN_PHYS: u64 = DRAM_BASE + 0x1000;
    const VIRTUAL_PC: u64 = 0x4000_1000;
    let faulting = block(
        DRAM_BASE,
        &[
            Instr::Addi {
                rd: 5,
                rs1: 5,
                imm: 1,
            },
            Instr::Sd {
                rs1: 6,
                rs2: 5,
                imm: 0,
            },
        ],
    );
    let clean = block(
        CLEAN_PHYS,
        &[Instr::Addi {
            rd: 7,
            rs1: 7,
            imm: 1,
        }],
    );
    let writes = Rc::new(Cell::new(0));
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    bus.attach(
        MMIO_BASE,
        8,
        Box::new(ThrowJsOnWrite {
            writes: Rc::clone(&writes),
        }),
    )
    .unwrap();
    let mut executor = Box::new(BrowserExecutor::new());
    executor.install(&faulting);
    executor.install(&clean);
    let mut hart = Box::new(Hart::default());
    hart.regs.write(5, 41);
    hart.regs.write(6, MMIO_BASE);
    hart.regs.write(7, 9);
    hart.regs.pc = CLEAN_PHYS;
    let mut bus = Box::new(bus);
    executor
        .execute(CLEAN_PHYS, &mut hart, &mut bus)
        .expect("warm dispatch refreshes any view detached during installation");
    hart.regs.write(7, 9);
    hart.regs.pc = VIRTUAL_PC;
    let executor_ptr = executor.as_mut() as *mut BrowserExecutor;
    let hart_ptr = hart.as_mut() as *mut Hart;
    let bus_ptr = bus.as_mut() as *mut SystemBus;
    let callback = Closure::<dyn FnMut()>::new(move || {
        // SAFETY: the three boxes stay alive and unmoved until this one-shot callback is dropped.
        // No other references are used while JS synchronously invokes it. The fatal exception
        // abandons this callback's stack, but BrowserExecutor clears HOST before rethrowing.
        unsafe {
            let _ = (&mut *executor_ptr).execute(DRAM_BASE, &mut *hart_ptr, &mut *bus_ptr);
        }
    });
    let live_before = externref_heap_live_count();

    begin_uint8_subarray_audit();
    begin_uint8_array_constructor_audit();
    assert!(
        catches_js_exception(callback.as_ref().unchecked_ref()),
        "an unrecorded exception must propagate instead of returning None for replay"
    );
    let constructor_calls = finish_uint8_array_constructor_audit();
    let subarray_calls = finish_uint8_subarray_audit();
    assert_eq!(constructor_calls, 0, "exception path rebuilt a live view");
    assert_eq!(subarray_calls, 0, "exception path created a subarray");
    assert_eq!(externref_heap_live_count(), live_before);
    drop(callback);
    assert_eq!(
        writes.get(),
        1,
        "the imported MMIO side effect is not rolled back"
    );
    assert_eq!(hart.regs.pc, VIRTUAL_PC);
    assert_eq!(hart.regs.read(5), 41, "dirty module x5 must not commit");
    assert_eq!(hart.regs.read(6), MMIO_BASE);
    assert_eq!(hart.regs.read(7), 9);

    hart.regs.pc = VIRTUAL_PC + 0x1000;
    let clean_exit = executor
        .execute(CLEAN_PHYS, &mut hart, &mut bus)
        .expect("a later clean dispatch must work after HOST cleanup");
    assert_eq!(clean_exit.code, ExitCode::Fallthrough);
    assert_eq!(clean_exit.next_pc, VIRTUAL_PC + 0x1004);
    assert_eq!(hart.regs.read(5), 41);
    assert_eq!(hart.regs.read(7), 10);
}

#[wasm_bindgen_test]
fn execute_miss_preserves_public_guard_and_guest_state() {
    let decoded = block(
        DRAM_BASE,
        &[Instr::Addi {
            rd: 5,
            rs1: 5,
            imm: 1,
        }],
    );
    let mut executor = BrowserExecutor::new();
    executor.install(&decoded);
    let before_stats = executor.jit_cache_stats();
    let mut hart = Hart::default();
    hart.regs.write(5, 41);
    hart.regs.pc = DRAM_BASE + 0x1000;
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());

    assert!(!executor.is_compiled(DRAM_BASE + 0x1000));
    assert!(
        executor
            .execute(DRAM_BASE + 0x1000, &mut hart, &mut bus)
            .is_none(),
        "execute must preserve the public is_compiled guard on a cache miss"
    );
    assert_eq!(executor.jit_cache_stats(), before_stats);
    assert_eq!(executor.executed_blocks(), 0);
    assert_eq!(hart.regs.read(5), 41);
    assert_eq!(hart.regs.pc, DRAM_BASE + 0x1000);
}

#[wasm_bindgen_test]
#[ignore = "long browser externref/eviction churn; run explicitly for E4-T33 evidence"]
fn browser_handles_remain_bounded_across_retranslation_churn() {
    const BATCH_BLOCKS: usize = 64;
    const ROTATING_BLOCKS: usize = 8;
    const ITERATIONS: usize = 4_096;

    let one_add = |phys| {
        block(
            phys,
            &[Instr::Addi {
                rd: 5,
                rs1: 5,
                imm: 1,
            }],
        )
    };
    let dense: Vec<DecodedBlock> = (0..BATCH_BLOCKS)
        .map(|index| one_add(DRAM_BASE + index as u64 * 4))
        .collect();
    let rotating: Vec<DecodedBlock> = (0..ROTATING_BLOCKS)
        .map(|index| one_add(DRAM_BASE + 0x1_0000 + index as u64 * 0x1000))
        .collect();

    let baseline = externref_heap_live_count();
    let mut executor = BrowserExecutor::new();
    let executor_floor = externref_heap_live_count();

    executor.install_batch(&dense, &vec![[None, None]; BATCH_BLOCKS]);
    assert_eq!(executor.compiled_count(), BATCH_BLOCKS);
    assert_eq!(executor.module_count(), 1);
    assert_eq!(
        externref_heap_live_count(),
        executor_floor + BATCH_BLOCKS as u32 + 2,
        "one K-block batch owns exactly K Functions, one state view, and one Instance"
    );
    executor.invalidate_all();
    assert_eq!(externref_heap_live_count(), executor_floor);

    executor.set_batch_size(1);
    executor.set_evict_policy(EvictPolicy::BatchLru);
    executor.set_jit_budget(JitCacheBudget {
        max_batches: 2,
        ..JitCacheBudget::DEFAULT
    });
    let seed =
        |register: u8| 0x8000_0000_0000_0000 | (u64::from(register) << 32) | u64::from(register);
    let mut hart = Hart::default();
    for register in 1..32u8 {
        hart.regs.write(register, seed(register));
    }
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    for iteration in 0..ITERATIONS {
        let decoded = &rotating[iteration % ROTATING_BLOCKS];
        executor.install(decoded);
        hart.regs.pc = decoded.phys_start;
        let exit = executor
            .execute(decoded.phys_start, &mut hart, &mut bus)
            .expect("one-op ALU block exits cleanly");
        assert_eq!(exit.code, ExitCode::Fallthrough);
        assert_eq!(exit.next_pc, decoded.phys_start + 4);
        let _ = executor.take_evicted();

        assert!(executor.module_count() <= 2);
        assert!(executor.compiled_count() <= 2);
        assert_eq!(
            externref_heap_live_count(),
            executor_floor + executor.compiled_count() as u32 + 2 * executor.module_count() as u32,
            "live browser handles must equal Functions + one view/Instance pair per batch"
        );
    }
    assert_eq!(executor.executed_blocks(), ITERATIONS as u64);
    assert_eq!(hart.regs.read(0), 0);
    for register in 1..32u8 {
        let expected = if register == 5 {
            seed(register).wrapping_add(ITERATIONS as u64)
        } else {
            seed(register)
        };
        assert_eq!(
            hart.regs.read(register),
            expected,
            "register x{register} diverged during browser handoff churn"
        );
    }
    assert_eq!(
        hart.regs.pc,
        rotating[(ITERATIONS - 1) % ROTATING_BLOCKS].phys_start,
        "direct executor leaves caller-owned PC at the final entry"
    );
    let stats = executor.jit_cache_stats();
    assert!(stats.evictions > 0, "tiny budget must actively evict");
    assert!(
        stats.retranslations > 0,
        "rotating evicted blocks must be retranslated"
    );
    assert_eq!(
        stats.installs,
        (BATCH_BLOCKS + ITERATIONS) as u64,
        "install accounting includes the initial ownership batch and every churn translation"
    );

    executor.invalidate_all();
    assert_eq!(externref_heap_live_count(), executor_floor);
    drop(executor);
    assert_eq!(externref_heap_live_count(), baseline);
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
