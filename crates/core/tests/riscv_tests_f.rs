//! E1-T06: the official riscv-tests **rv64uf-p** (F extension) suite, run under the REAL
//! CSR file (default build). Unlike rv64ui/um/ua — which use the quarantined `zicsr-stub`
//! p-env scaffolding — the FP tests need the real `fcsr`/`frm`/`fflags` triad and
//! `mstatus.FS` handling from E1-T02/T06, so this harness is scoped to the NON-stub build.
#![cfg(not(feature = "zicsr-stub"))]

use std::path::PathBuf;

use wasm_vm_core::hart::Exception;
use wasm_vm_core::{Machine, RunOutcome};

const SYS_EXIT: u64 = 93;

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
    let mut m = Machine::new(16 * 1024 * 1024);
    m.load_elf(&elf).unwrap();
    // The FP p-env enables the FPU by setting mstatus.FS before the test body; give it room.
    match m.run(2_000_000) {
        RunOutcome::Exited(0) => Verdict::Pass,
        RunOutcome::Exited(n) => Verdict::Fail(n),
        // The exit ecall may come from ANY mode: with real MRET (E1-T09) the p-env's `mret`
        // (MPP=U) drops the test body to U-mode, so its exit is EcallFromU (cause 8), not M.
        // Trap DELIVERY (jump to mtvec) lands in E1-T10; until then the ecall escapes `run`
        // and we read a7/a0 directly, regardless of originating privilege.
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
fn rv64uf_p_suite_all_pass() {
    let dir = bin_dir();
    assert!(
        dir.is_dir(),
        "run tools/riscv-tests/build-rv64uf.sh: {dir:?}"
    );
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("rv64uf-p-")
        })
        .collect();
    entries.sort();

    let mut failures = Vec::new();
    for path in &entries {
        let name = path.file_name().unwrap().to_str().unwrap();
        match run_one(path) {
            Verdict::Pass => {}
            Verdict::Fail(n) => failures.push(format!("{name}: FAIL riscv-tests case #{n}")),
            Verdict::Other(why) => failures.push(format!("{name}: {why}")),
        }
    }

    assert!(
        entries.len() >= 10,
        "expected the rv64uf-p set, found {}",
        entries.len()
    );
    assert!(
        failures.is_empty(),
        "{} rv64uf-p test(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// E1-T07: the rv64ud-p (D extension) suite, same real-CSR harness.
#[test]
fn rv64ud_p_suite_all_pass() {
    let dir = bin_dir();
    assert!(
        dir.is_dir(),
        "run tools/riscv-tests/build-rv64ud.sh: {dir:?}"
    );
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("rv64ud-p-")
        })
        .collect();
    entries.sort();

    let mut failures = Vec::new();
    for path in &entries {
        let name = path.file_name().unwrap().to_str().unwrap();
        match run_one(path) {
            Verdict::Pass => {}
            Verdict::Fail(n) => failures.push(format!("{name}: FAIL riscv-tests case #{n}")),
            Verdict::Other(why) => failures.push(format!("{name}: {why}")),
        }
    }

    assert!(
        entries.len() >= 11,
        "expected the rv64ud-p set, found {}",
        entries.len()
    );
    assert!(
        failures.is_empty(),
        "{} rv64ud-p test(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// E1-T08: the rv64uc-p (C compressed) suite. Compressed instructions expand to their base
/// form and run through the same path — the official RVC test exercises every quadrant.
#[test]
fn rv64uc_p_suite_all_pass() {
    let dir = bin_dir();
    assert!(
        dir.is_dir(),
        "run tools/riscv-tests/build-rv64uc.sh: {dir:?}"
    );
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("rv64uc-p-")
        })
        .collect();
    entries.sort();

    let mut failures = Vec::new();
    for path in &entries {
        let name = path.file_name().unwrap().to_str().unwrap();
        match run_one(path) {
            Verdict::Pass => {}
            Verdict::Fail(n) => failures.push(format!("{name}: FAIL riscv-tests case #{n}")),
            Verdict::Other(why) => failures.push(format!("{name}: {why}")),
        }
    }

    assert!(!entries.is_empty(), "expected the rv64uc-p test (rvc)");
    assert!(
        failures.is_empty(),
        "{} rv64uc-p test(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
