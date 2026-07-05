//! E0-T19: run the official riscv-tests **rv64ui-p** suite as a smoke gate (native side).
//! Gated on `zicsr-stub` — the p-env startup needs the quarantined CSR scaffolding.
//! `cargo test -p wasm-vm-core --features zicsr-stub`.
#![cfg(feature = "zicsr-stub")]

use std::path::PathBuf;

use wasm_vm_core::hart::Exception;
use wasm_vm_core::{Machine, RunOutcome};

/// The riscv-tests p-env exit syscall number (`li a7, 93; ecall`).
const SYS_EXIT: u64 = 93;

/// ELFs that legitimately cannot pass at Level 0, each with a justification. The verifier
/// diffs the observed failure set against THIS list — an undocumented failure refutes.
const SKIP: &[(&str, &str)] = &[
    (
        "rv64ui-p-fence_i",
        "Zifencei (fence.i) — out of the rv64i base, arrives in a later epic",
    ),
    // rv64ui-p-ma_data REMOVED (E1-T26): misaligned loads/stores now succeed for RAM, so this
    // test runs below and must PASS — no longer skipped.
];

fn bin_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-bin")
}

/// Outcome of one p-env test, normalized to pass / failing-case-number / other.
enum Verdict {
    Pass,
    Fail(u64),
    Other(String),
}

/// Run one p-env ELF to completion. The env signals completion with the HTIF exit
/// syscall `li a7,93; ecall` (a Level-0 `EcallFromM` trap): `a0 = 0` passes, `a0 =
/// (n<<1)|1` fails test case `n`. (A direct `tohost` write — `Exited` — is also honored,
/// in case an env variant uses it.)
fn run_one(path: &std::path::Path) -> Verdict {
    let elf = std::fs::read(path).unwrap();
    let mut m = Machine::new(16 * 1024 * 1024);
    m.load_elf(&elf).unwrap();
    match m.run(1_000_000) {
        RunOutcome::Exited(0) => Verdict::Pass,
        RunOutcome::Exited(n) => Verdict::Fail(n),
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
                Verdict::Other(format!("ecall with a7={a7} (not the exit syscall)"))
            }
        }
        other => Verdict::Other(format!("{other:?}")),
    }
}

#[test]
fn rv64ui_p_suite_passes_except_documented_skips() {
    let dir = bin_dir();
    assert!(
        dir.is_dir(),
        "run tools/riscv-tests/build.sh first: {dir:?}"
    );
    let mut ran = 0;
    let mut failures = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("rv64ui-p-")
        })
        .collect();
    entries.sort();

    for path in &entries {
        let name = path.file_name().unwrap().to_str().unwrap();
        if SKIP.iter().any(|(s, _)| *s == name) {
            continue;
        }
        ran += 1;
        match run_one(path) {
            Verdict::Pass => {}
            Verdict::Fail(n) => {
                failures.push(format!("{name}: FAIL riscv-tests case #{n}"));
            }
            Verdict::Other(why) => failures.push(format!("{name}: {why}")),
        }
    }

    assert!(ran >= 40, "expected the full rv64ui-p set, only ran {ran}");
    assert!(
        failures.is_empty(),
        "{} rv64ui-p test(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// E1-T03: the full rv64um-p (M-extension) suite. Every one of the 13 ELFs must pass —
/// there is no documented-skip list, because the M ops are fully implemented (unlike the
/// Zifencei/misaligned skips of the base suite). The M ops decode in every build; the
/// p-env CSR startup runs via the same `zicsr-stub` scaffolding as rv64ui-p.
#[test]
fn rv64um_p_suite_all_pass() {
    let dir = bin_dir();
    assert!(
        dir.is_dir(),
        "run tools/riscv-tests/build-rv64um.sh: {dir:?}"
    );
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("rv64um-p-")
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

    assert_eq!(
        entries.len(),
        13,
        "expected all 13 rv64um-p ELFs (mul/mulh/mulhsu/mulhu/div/divu/rem/remu + 5 W forms)"
    );
    assert!(
        failures.is_empty(),
        "{} rv64um-p test(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// E1-T04: the full rv64ua-p (A-extension) suite — all 18 AMO tests plus `lrsc`. No
/// documented skips: LR/SC and every AMO are implemented. Atomics decode in every build;
/// the p-env CSR startup runs via the same `zicsr-stub` scaffolding.
#[test]
fn rv64ua_p_suite_all_pass() {
    let dir = bin_dir();
    assert!(
        dir.is_dir(),
        "run tools/riscv-tests/build-rv64ua.sh: {dir:?}"
    );
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("rv64ua-p-")
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

    assert_eq!(
        entries.len(),
        19,
        "expected all 19 rv64ua-p ELFs (18 AMO*_w/_d + lrsc)"
    );
    assert!(
        failures.is_empty(),
        "{} rv64ua-p test(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
