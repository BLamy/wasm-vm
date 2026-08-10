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
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, EvictPolicy, ExitCode, JitCacheBudget};
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::ram::Ram;
use wasm_vm_wasm::BrowserExecutor;

#[wasm_bindgen::prelude::wasm_bindgen(inline_js = r#"
let originalUint8Subarray;
let uint8SubarrayCalls = 0;

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

export function catchesJsException(callback) {
    try {
        callback();
        return false;
    } catch {
        return true;
    }
}
"#)]
extern "C" {
    #[wasm_bindgen(js_name = beginUint8SubarrayAudit)]
    fn begin_uint8_subarray_audit();
    #[wasm_bindgen(js_name = finishUint8SubarrayAudit)]
    fn finish_uint8_subarray_audit() -> u32;
    #[wasm_bindgen(js_name = catchesJsException)]
    fn catches_js_exception(callback: &Function) -> bool;
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
    let exit = executor
        .execute(DRAM_BASE, &mut hart, &mut bus)
        .expect("compiled block exits cleanly");
    let subarray_calls = finish_uint8_subarray_audit();

    assert_eq!(exit.code, ExitCode::Fallthrough);
    assert_eq!(hart.regs.read(5), 42);
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
    let mut hart = Hart::default();
    hart.regs.write(5, 41);
    hart.regs.write(6, MMIO_BASE);
    hart.regs.pc = DRAM_BASE;
    let live_before = externref_heap_live_count();

    begin_uint8_subarray_audit();
    let exit = executor
        .execute(DRAM_BASE, &mut hart, &mut bus)
        .expect("compiled MMIO store exits cleanly after growing outer memory");
    let subarray_calls = finish_uint8_subarray_audit();

    assert_eq!(subarray_calls, 0);
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
    let mut hart = Hart::default();
    hart.regs.write(5, 41);
    hart.regs.write(6, MMIO_BASE);
    hart.regs.pc = VIRTUAL_PC;
    let live_before = externref_heap_live_count();

    begin_uint8_subarray_audit();
    let exit = executor
        .execute(DRAM_BASE, &mut hart, &mut bus)
        .expect("recorded MMIO fault remains precise after growing outer memory");
    let subarray_calls = finish_uint8_subarray_audit();

    assert_eq!(subarray_calls, 0);
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
        wasm_bindgen::throw_str("unexpected-jit-engine-trap")
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
    hart.regs.pc = VIRTUAL_PC;
    let mut bus = Box::new(bus);
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

    assert!(
        catches_js_exception(callback.as_ref().unchecked_ref()),
        "an unrecorded exception must propagate instead of returning None for replay"
    );
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
