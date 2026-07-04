//! E1-T10: the official riscv-tests **rv64mi-p** (Machine-mode trap) suite, run under the
//! REAL CSR file. These are the end-to-end proof of precise trap DELIVERY: each test installs
//! `mtvec`, provokes a synchronous exception, and its M-mode handler reads mcause/mepc/mtval
//! and `mret`s — so a pass means our delivery machinery matches what real trap-handler code
//! expects, byte for byte.
//!
//! SCOPE: the rv64mi-p ELFs covered by the machine trap + counter machinery landed so far
//! (E1-T10 trap delivery, E1-T14 Zicntr counters). Three ELFs the upstream suite ships still
//! reach past what's implemented and are EXCLUDED:
//!
//! - `illegal` — a kitchen-sink M-mode test. With E1-T11 landed it now clears the
//!   illegal-instruction case (bad2), the vectored-interrupt sub-test, S-mode entry and WFI, then
//!   fails on the `sfence.vma` at 0x80000200 (encoding 0x1200_0073): we don't decode SFENCE.VMA
//!   yet — it lands in E1-T17 (TLB/SFENCE.VMA) — so it raises a spurious illegal-instruction trap
//!   the test's handler doesn't expect. (The test keeps TESTNUM=2 across all these stages, so its
//!   exit code doesn't pinpoint the stage; a PC trace does — the divergence is the SFENCE.VMA, an
//!   E1-T17 instruction, NOT an interrupt/delegation bug.) Its illegal-instruction *mtval* checks
//!   are covered in `precise_exceptions.rs`; the vectored M-interrupt path in `interrupts.rs`.
//! - `breakpoint` — exercises the debug-spec trigger CSRs (tdata1/tdata2), not implemented.
//! - `instret_overflow` — needs the Sscofpmf counter-OVERFLOW local interrupt (LCOFI), a
//!   separate extension beyond the basic Zicntr counters E1-T14 lands.
//!
//! (`zicntr` — cycle/time/instret + mcounteren/scounteren — now PASSES and is run below, E1-T14.)
//! All three excluded ELFs are built by `tools/riscv-tests/build-rv64mi.sh`; they light up as
//! their owning tasks land.
#![cfg(not(feature = "zicsr-stub"))]

use std::path::PathBuf;

use wasm_vm_core::hart::Exception;
use wasm_vm_core::{Machine, RunOutcome};

const SYS_EXIT: u64 = 93;

/// The rv64mi-p ELFs covered by the machine trap + counter machinery landed so far (E1-T10
/// trap delivery, E1-T14 Zicntr counters). `zicntr` needs the `time` counter, so run_one enables
/// the CLINT (inert for the others: mtimecmp resets to u64::MAX, so no timer interrupt fires).
const MI_SUBSET: &[&str] = &[
    "scall",
    "sbreak",
    "ma_addr",
    "ma_fetch",
    "ld-misaligned",
    "lh-misaligned",
    "lw-misaligned",
    "sd-misaligned",
    "sh-misaligned",
    "sw-misaligned",
    "csr",
    "mcsr",
    "zicntr",  // E1-T14: cycle/time/instret + mcounteren/scounteren
    "pmpaddr", // E1-T15: PMP pmpaddr/pmpcfg WARL + region behavior
];

fn bin_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-bin")
}

enum Verdict {
    Pass,
    Fail(u64),
    Other(String),
}

fn run_one(path: &std::path::Path) -> Verdict {
    let elf = std::fs::read(path).unwrap();
    let mut m = Machine::new(64 * 1024 * 1024);
    m.enable_clint(1); // for the `time` counter (rv64mi-p-zicntr); inert for the rest
    m.load_elf(&elf).unwrap();
    match m.run(5_000_000) {
        RunOutcome::Exited(0) => Verdict::Pass,
        RunOutcome::Exited(n) => Verdict::Fail(n),
        // The p-env handler writes tohost on pass/fail, so a real-CSR mi run terminates via
        // Exited. The escape branch is only reachable if delivery were disabled; keep it for
        // diagnostics.
        RunOutcome::Trapped(t)
            if matches!(
                t.cause,
                Exception::EcallFromU | Exception::EcallFromS | Exception::EcallFromM
            ) =>
        {
            let a7 = m.hart().regs.read(17);
            let a0 = m.hart().regs.read(10);
            if a7 == SYS_EXIT {
                if a0 == 0 {
                    Verdict::Pass
                } else {
                    Verdict::Fail(a0 >> 1)
                }
            } else {
                Verdict::Other(format!("ecall a7={a7} (not exit)"))
            }
        }
        other => Verdict::Other(format!("{other:?}")),
    }
}

#[test]
fn rv64mi_p_trap_delivery_subset_all_pass() {
    let dir = bin_dir();
    assert!(
        dir.is_dir(),
        "run tools/riscv-tests/build-rv64mi.sh: {dir:?}"
    );
    let mut failures = Vec::new();
    let mut ran = 0;
    for name in MI_SUBSET {
        let path = dir.join(format!("rv64mi-p-{name}"));
        assert!(path.is_file(), "missing ELF {path:?} — run build-rv64mi.sh");
        ran += 1;
        match run_one(&path) {
            Verdict::Pass => {}
            Verdict::Fail(n) => failures.push(format!("rv64mi-p-{name}: FAIL case #{n}")),
            Verdict::Other(why) => failures.push(format!("rv64mi-p-{name}: {why}")),
        }
    }
    assert_eq!(ran, MI_SUBSET.len(), "ran the full MI subset");
    assert!(
        failures.is_empty(),
        "{} rv64mi-p test(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
