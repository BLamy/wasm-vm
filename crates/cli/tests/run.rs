//! E0-T18 integration tests: drive the built `wasm-vm` binary over real and forged ELFs
//! and pin the stdout-purity / exit-status / trace / dump / bad-input contracts.

mod common;

use std::io::Write;

use assert_cmd::Command;
use common::*;
use predicates::prelude::*;

const HELLO_ELF: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../guest/prebuilt/hello.elf"
);
const LOOPS_ELF: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../guest/prebuilt/loops.elf"
);
const LOOPS_GOLDEN: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../docs/golden/loops.trace.txt"
);

/// Write `bytes` to a fresh temp file and return the (kept-alive) handle.
fn elf_file(bytes: &[u8]) -> tempfile::NamedTempFile {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    f.write_all(bytes).unwrap();
    f.flush().unwrap();
    f
}

fn wasm_vm() -> Command {
    Command::cargo_bin("wasm-vm").unwrap()
}

#[test]
fn hello_prints_exactly_and_exits_zero() {
    // Acceptance: byte-exact stdout, exit 0, using only the prebuilt ELF.
    wasm_vm()
        .args(["run", HELLO_ELF])
        .assert()
        .success()
        .stdout(predicate::eq("Hello from RV64\n"));
}

#[test]
fn retired_count_reported_on_stderr() {
    wasm_vm()
        .args(["run", HELLO_ELF])
        .assert()
        .success()
        .stderr(predicate::str::contains("retired=83"));
}

#[test]
fn guest_exit_code_becomes_process_exit_code() {
    let f = elf_file(&guest_exit(42));
    wasm_vm().arg("run").arg(f.path()).assert().code(42);
}

#[test]
fn guest_exit_256_wraps_mod_256_to_zero() {
    // Documented contract: exit code is guest_code & 0xff, so 256 → 0 (not a hang).
    let f = elf_file(&guest_exit(256));
    wasm_vm().arg("run").arg(f.path()).assert().code(0);
}

#[test]
fn ebreak_traps_101_with_cause_on_stderr() {
    let f = elf_file(&guest_ebreak());
    wasm_vm()
        .arg("run")
        .arg(f.path())
        .assert()
        .code(101)
        .stderr(predicate::str::contains("Breakpoint"));
}

#[test]
fn max_instrs_on_infinite_loop_exits_102_with_retired_count() {
    let f = elf_file(&guest_spin());
    wasm_vm()
        .arg("run")
        .arg(f.path())
        .args(["--max-instrs", "10"])
        .assert()
        .code(102)
        .stderr(predicate::str::contains("retired=10"));
}

#[test]
fn max_instrs_zero_still_dumps_state() {
    // Angle 3: --max-instrs 0 executes nothing but must still emit a valid state dump.
    let f = elf_file(&guest_spin());
    wasm_vm()
        .arg("run")
        .arg(f.path())
        .args(["--max-instrs", "0", "--dump-state"])
        .assert()
        .code(102)
        .stdout(predicate::str::contains("pc        = 0x0000000080000000"))
        .stdout(predicate::str::contains("state sha256="))
        .stderr(predicate::str::contains("retired=0"));
}

#[test]
fn trace_matches_the_e0_t16_golden_prefix() {
    // --trace to stderr; the first 40 canonical lines must equal the committed golden.
    let golden = std::fs::read_to_string(LOOPS_GOLDEN).unwrap();
    let out = wasm_vm()
        .args(["run", LOOPS_ELF, "--trace", "-"])
        .assert()
        .success();
    let stderr = String::from_utf8(out.get_output().stderr.clone()).unwrap();
    let trace_prefix: String = stderr.lines().take(40).map(|l| format!("{l}\n")).collect();
    assert_eq!(
        trace_prefix, golden,
        "canonical trace prefix drifted from golden"
    );
}

#[test]
fn stdout_purity_all_256_byte_values_unmodified() {
    // Angle 1: a guest printing every byte 0..=255 must yield exactly those 256 bytes on
    // stdout — no logging leakage, BOM, or newline translation.
    let f = elf_file(&guest_print_all_bytes());
    let out = wasm_vm().arg("run").arg(f.path()).assert().success();
    let stdout = &out.get_output().stdout;
    let expected: Vec<u8> = (0..=255u8).collect();
    assert_eq!(
        stdout.as_slice(),
        expected.as_slice(),
        "stdout not byte-clean"
    );
}

#[test]
fn dump_state_final_line_matches_e0_t17_format() {
    let out = wasm_vm()
        .args(["run", LOOPS_ELF, "--dump-state"])
        .assert()
        .success();
    let stdout = String::from_utf8(out.get_output().stdout.clone()).unwrap();
    let last = stdout.lines().last().unwrap();
    assert!(
        predicate::str::is_match(r"^state sha256=[0-9a-f]{64}$")
            .unwrap()
            .eval(last),
        "final line must be 'state sha256=<64 hex>', got: {last}"
    );
}

// ── bad inputs: distinct nonzero exits ───────────────────────────────────────

#[test]
fn missing_file_exits_2() {
    wasm_vm()
        .args(["run", "/no/such/guest.elf"])
        .assert()
        .code(2)
        .stderr(predicate::str::contains("cannot read"));
}

#[test]
fn non_elf_file_is_rejected() {
    let f = elf_file(b"not an elf at all, just text");
    wasm_vm().arg("run").arg(f.path()).assert().code(65); // BadMagic
}

#[test]
fn rv32_elf_is_rejected_distinctly() {
    // Forge a valid rv64 guest, then flip EI_CLASS to ELFCLASS32 → WrongClass.
    let mut bytes = guest_exit(0);
    bytes[4] = 1; // ELFCLASS32
    let f = elf_file(&bytes);
    wasm_vm().arg("run").arg(f.path()).assert().code(66);
}

#[test]
fn elf_larger_than_ram_is_rejected_distinctly() {
    // 1 MiB of RAM, but the segment loads at DRAM_BASE with room for the code far past it:
    // shrink RAM so the tohost-bearing guest's segment still fits but a big one won't.
    // Simpler: a guest whose load segment exceeds a 0-MiB RAM.
    let f = elf_file(&guest_exit(0));
    wasm_vm()
        .arg("run")
        .arg(f.path())
        .args(["--ram-mib", "0"])
        .assert()
        .code(68); // SegmentOutOfRam
}
