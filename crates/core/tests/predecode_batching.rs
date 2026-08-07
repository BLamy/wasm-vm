//! E4-T05 Phase C — interrupt/device-sync BATCHING at block boundaries.
//!
//! Phase C is NOT byte-identical to the legacy path by design (it changes WHEN interrupts are
//! sampled: once per DecodedBlock ≤128 ops instead of once per instruction). So the gates here are
//! CORRECTNESS + DETERMINISM, not trace-equality-vs-legacy:
//!   * `riscv_tests_pass_or_fail_unchanged_with_batching` — every vendored riscv-tests ELF
//!     (incl. the interrupt-sensitive `rv64mi-p-*` and CLINT/timer tests) reaches the SAME
//!     pass/fail verdict with cache+batching ON as the legacy path. Interrupt delivery is still
//!     architecturally correct despite the ≤128-instr sampling defer.
//!   * `native_batched_runs_are_deterministic` — two identical native runs with batching ON
//!     produce byte-identical retire fingerprints (the core project invariant). Block boundaries
//!     are a pure function of the code (terminators / 128-op cap / page edges), so sampling points
//!     are deterministic.
//!   * `mtimecmp_midblock_latency_is_bounded` (AC #4) — a timer that crosses `mtimecmp` in the
//!     MIDDLE of a straight-line 128-op block is delivered within ≤128 retirements of expiry, and
//!     never BEFORE the deadline. `mtime` still advances per-retire, so the interrupt becomes
//!     pending at the identical retire index as the legacy path; only its sampling defers.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use std::path::PathBuf;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::{DRAM_BASE, UART0_BASE, UART0_LEN};
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink};
use wasm_vm_core::hart::Exception;
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome};

const SYS_EXIT: u64 = 93;

/// Coarse pass/fail classification of a riscv-tests run — enough to prove batching does not flip
/// any verdict. Mirrors `riscv_tests_suite`'s HTIF/`ecall`-exit convention.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Verdict {
    Pass,
    Fail(u64),
    Timeout,
    Escaped(String),
}

/// Run one ELF to completion. `batch = false` ⇒ legacy path (cache+batching off); `true` ⇒
/// block cache + interrupt batching ON.
fn classify(elf: &[u8], batch: bool) -> Verdict {
    let mut m = Machine::new(64 * 1024 * 1024);
    m.load_elf(elf).unwrap();
    if batch {
        m.set_block_cache(true);
        m.set_interrupt_batching(true);
        assert!(m.interrupt_batching(), "batching must be effective");
    }
    let outcome = m.run(5_000_000);
    match outcome {
        RunOutcome::Exited(0) => Verdict::Pass,
        RunOutcome::Exited(n) => Verdict::Fail(n >> 1),
        RunOutcome::Trapped(t) if t.cause == Exception::EcallFromM => {
            let a7 = m.hart().regs.read(17);
            let a0 = m.hart().regs.read(10);
            if a7 == SYS_EXIT {
                if a0 == 0 {
                    Verdict::Pass
                } else {
                    Verdict::Fail(a0 >> 1)
                }
            } else {
                Verdict::Escaped(format!("ecall a7={a7}"))
            }
        }
        RunOutcome::Trapped(t) => Verdict::Escaped(format!("trap {:?}", t.cause)),
        RunOutcome::MaxInstrs => Verdict::Timeout,
        RunOutcome::Reset(r) => Verdict::Escaped(format!("reset {r:?}")),
    }
}

/// The interrupt-correctness gate: every riscv-tests ELF reaches the SAME verdict with
/// cache+batching ON as the legacy path. Includes `rv64mi-p-*` (machine-mode interrupt/CSR tests)
/// and the timer/CLINT microtests — the ones that would break if the ≤128-instr sampling defer
/// mis-delivered an interrupt.
#[test]
fn riscv_tests_pass_or_fail_unchanged_with_batching() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-bin");
    let mut n = 0u32;
    let mut n_mi = 0u32;
    for entry in std::fs::read_dir(&dir).expect("riscv-tests-bin dir") {
        let path = entry.unwrap().path();
        if path.extension().is_some() || !path.is_file() {
            continue;
        }
        let elf = std::fs::read(&path).unwrap();
        if elf.get(..4) != Some(b"\x7fELF") {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let legacy = classify(&elf, false);
        let batched = classify(&elf, true);
        assert_eq!(
            legacy, batched,
            "{name}: batching changed the verdict (legacy={legacy:?} batched={batched:?})"
        );
        if name.contains("rv64mi") {
            n_mi += 1;
        }
        n += 1;
    }
    assert!(n > 50, "expected the full riscv-tests corpus, saw {n}");
    assert!(
        n_mi > 0,
        "expected at least one rv64mi interrupt test, saw {n_mi}"
    );
    eprintln!("batching verdict-identical across {n} riscv-tests ELFs ({n_mi} rv64mi)");
}

const HELLO: &[u8] = include_bytes!("../../../guest/prebuilt/hello.elf");
const LOOPS: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");
const MEMOPS: &[u8] = include_bytes!("../../../guest/prebuilt/memops.elf");

fn hashed_run(elf: &[u8], batch: bool) -> (u64, u64, RunOutcome) {
    let mut m = Machine::new(128 * 1024 * 1024);
    m.bus_mut()
        .attach(
            UART0_BASE,
            UART0_LEN,
            Box::new(Uart0Stub::new(VecSink::new())),
        )
        .unwrap();
    m.load_elf(elf).unwrap();
    if batch {
        m.set_block_cache(true);
        m.set_interrupt_batching(true);
    }
    let mut sink = HashSink::new();
    let outcome = m.run_traced(5_000_000, &mut sink);
    (sink.hash(), sink.retired(), outcome)
}

/// Determinism (the core invariant): two identical native runs with batching ON must produce
/// byte-identical retire fingerprints. (The wasm leg — native-batched == wasm-batched — is
/// deferred where wasm-pack/node are unavailable; block boundaries are deterministic across
/// engines by construction: same terminators, same 128-cap, same physical PCs.)
#[test]
fn native_batched_runs_are_deterministic() {
    for (name, elf) in [("hello", HELLO), ("loops", LOOPS), ("memops", MEMOPS)] {
        let a = hashed_run(elf, true);
        let b = hashed_run(elf, true);
        assert!(a.1 > 20, "{name}: suspiciously short run ({} retires)", a.1);
        assert_eq!(a, b, "{name}: two identical batched runs diverged");
        eprintln!(
            "{name}: batched deterministic — {} retires, hash {:#018x}",
            a.1, a.0
        );
    }
}

/// AC #4 — mid-block `mtimecmp` latency bound. A straight-line block of 128 nops (no terminator
/// until the trailing self-loop) means the machine is mid-block for ~128 retirements at a stretch;
/// arming `mtimecmp` so the timer crosses in the MIDDLE of that block, the delivered interrupt must
/// land within ≤128 retirements of expiry and NEVER before the deadline.
#[test]
fn mtimecmp_midblock_latency_is_bounded() {
    // clock_div = 1 ⇒ mtime advances exactly one tick per retired instruction, so `mtime` equals
    // the retire index; the timer's architectural expiry is retire == DEADLINE.
    const DEADLINE: u64 = 40; // crosses mid-block (well inside the first 128-op block)
    const HANDLER: u64 = DRAM_BASE + 0x8000;
    const NOP: u32 = 0x0000_0013; // addi x0, x0, 0 — NOT a block terminator
    const NNOPS: u64 = 300; // > 2 blocks of straight-line code before the self-loop

    let mut m = Machine::new(1024 * 1024);
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = DEADLINE;
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MIE, CsrOp::Write, 1 << 7); // MTIE
    set_csr(&mut m, MSTATUS, CsrOp::Set, 1 << 3); // global MIE

    // Lay down NNOPS nops then a self-looping `jal x0, 0` so execution never leaves the region.
    for i in 0..NNOPS {
        m.bus_mut().store32(DRAM_BASE + 4 * i, NOP).unwrap();
    }
    m.bus_mut()
        .store32(DRAM_BASE + 4 * NNOPS, 0x0000_006F)
        .unwrap();
    m.hart_mut().regs.pc = DRAM_BASE;

    // Cache + batching ON: the whole nop run is one (or few) 128-op blocks; interrupts are sampled
    // only at block boundaries.
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    assert!(m.interrupt_batching());

    // Step one retirement at a time and note the retire index at which the handler is entered.
    let mut fired_at = None;
    for i in 0..(DEADLINE + 256) {
        if m.hart().regs.pc == HANDLER {
            fired_at = Some(i);
            break;
        }
        m.run(1);
    }
    let fired = fired_at.expect("timer interrupt must be delivered under batching");
    // Never delivered before the deadline (mtime must actually have crossed mtimecmp)...
    assert!(
        fired >= DEADLINE,
        "interrupt fired at retire {fired} BEFORE the deadline {DEADLINE}"
    );
    // ...and within one block (≤128 instructions) of expiry.
    assert!(
        fired - DEADLINE <= 128,
        "interrupt latency {} exceeds the one-block (128) bound",
        fired - DEADLINE
    );
    // Sanity: it really is deferred past the exact-expiry point a per-op sampler would hit, i.e.
    // batching is genuinely batching here (the block is straight-line, not one-op-per-block).
    assert!(
        fired > DEADLINE,
        "expected the batched sampler to defer past the exact deadline (got {fired})"
    );
    assert_eq!(
        rd_csr(&mut m, 0x342),
        (1u64 << 63) | 7,
        "mcause = machine timer interrupt"
    );
    eprintln!(
        "mtimecmp latency: pending@{DEADLINE}, delivered@{fired} (latency {})",
        fired - DEADLINE
    );
}

fn set_csr(m: &mut Machine, addr: u16, op: CsrOp, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, op, v, false, false, 0)
        .unwrap();
}
fn rd_csr(m: &mut Machine, addr: u16) -> u64 {
    m.hart_mut().csr.read(addr)
}
