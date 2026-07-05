//! E0-T14 payoff: load the committed golden ELFs into OUR emulator and verify it runs
//! real cross-compiled rv64i programs — same binaries the Spike differential (E0-T20)
//! uses. "The binary in the repo is the binary we tested," end to end through
//! loader → hart → console + HTIF.

use wasm_vm_core::bus::mmap::{UART0_BASE, UART0_LEN};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink};
use wasm_vm_core::{Machine, RunOutcome};

const HELLO: &[u8] = include_bytes!("../../../guest/prebuilt/hello.elf");
const LOOPS: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");
const MEMOPS: &[u8] = include_bytes!("../../../guest/prebuilt/memops.elf");

/// Build a machine with a console attached at UART0, load `elf`, run to completion.
/// Returns (outcome, captured console bytes).
fn run_golden(elf: &[u8], budget: u64) -> (RunOutcome, Vec<u8>) {
    let mut m = Machine::new(128 * 1024 * 1024); // 128 MiB, matches the guest stack region
    let sink = VecSink::new();
    m.bus_mut()
        .attach(
            UART0_BASE,
            UART0_LEN,
            Box::new(Uart0Stub::new(sink.clone())),
        )
        .unwrap();
    m.load_elf(elf).unwrap();
    let outcome = m.run(budget);
    (outcome, sink.captured())
}

#[test]
fn hello_prints_and_exits_zero() {
    let (outcome, out) = run_golden(HELLO, 100_000);
    assert_eq!(outcome, RunOutcome::Exited(0), "hello must exit 0");
    assert_eq!(out, b"Hello from RV64\n", "exact console output");
}

#[test]
fn loops_exits_zero_no_output() {
    let (outcome, out) = run_golden(LOOPS, 100_000);
    assert_eq!(outcome, RunOutcome::Exited(0));
    assert!(out.is_empty(), "loops emits nothing");
}

#[test]
fn memops_prints_done_and_exits_zero() {
    let (outcome, out) = run_golden(MEMOPS, 100_000);
    assert_eq!(outcome, RunOutcome::Exited(0));
    assert_eq!(out, b"memops done\n");
}

#[test]
fn all_goldens_terminate_within_budget() {
    // None of these should hit MaxInstrs at a generous budget — a regression that made
    // an instruction mis-execute could loop forever, and this catches it.
    for (name, elf) in [("hello", HELLO), ("loops", LOOPS), ("memops", MEMOPS)] {
        let (outcome, _) = run_golden(elf, 1_000_000);
        assert!(
            matches!(outcome, RunOutcome::Exited(0)),
            "{name} did not cleanly exit: {outcome:?}"
        );
    }
}
