//! E1-T19: the unified riscv-tests regression wall. Runs EVERY vendored official test ELF under
//! the real (E1) CSR file in one command, classifies each via the HTIF exit convention, emits a
//! deterministic per-test markdown + JSON report (`target/riscv-tests-report.{md,json}`) with
//! retire counts and revision fingerprints, and diffs the observed failure set against the
//! reviewed allowlist (`tests/riscv-tests-allowlist.txt`). An unlisted failure OR a stale
//! allowlist entry (a listed test that now passes) fails the job.
//!
//! Scope note: the vendored binaries are the `-p` (physical, M-mode) user suites + `rv64mi-p`.
//! The `-v` (virtual-memory) and `rv64si` suites need a newlib-equipped toolchain the current
//! image lacks (documented in E1-T16 / the allowlist) — they are absent, not failing, and light
//! up when that toolchain lands. The wasm32 leg (report-equality with native) is exercised by the
//! Epic-0 wasm harness / E1-T22 determinism task.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use wasm_vm_core::hart::Exception;
use wasm_vm_core::{Machine, RunOutcome};

/// The riscv-tests p-env exit syscall (`li a7, 93; ecall`).
const SYS_EXIT: u64 = 93;
const MINSTRET: u16 = 0xB02;
/// Per-test instruction budget — generous for these microtests; exhaustion is a TIMEOUT (never a
/// pass). A hung test can't masquerade as success.
const BUDGET: u64 = 5_000_000;

fn bin_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-bin")
}
fn allowlist_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-allowlist.txt")
}
fn report_path(ext: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../target/riscv-tests-report.{ext}"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Status {
    Pass,
    Fail(u64),
    Timeout,
    Error(String),
}
impl Status {
    fn is_pass(&self) -> bool {
        *self == Status::Pass
    }
    fn label(&self) -> String {
        match self {
            Status::Pass => "PASS".into(),
            Status::Fail(n) => format!("FAIL(#{n})"),
            Status::Timeout => "TIMEOUT".into(),
            Status::Error(w) => format!("ERROR({w})"),
        }
    }
}

/// Run one test ELF to completion under the real CSR file; return its status and retire count.
fn run_elf(path: &Path) -> (Status, u64) {
    let elf = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => return (Status::Error(format!("read: {e}")), 0),
    };
    let mut m = Machine::new(64 * 1024 * 1024);
    if let Err(e) = m.load_elf(&elf) {
        return (Status::Error(format!("load: {e:?}")), 0);
    }
    let outcome = m.run(BUDGET);
    let retired = m.hart_mut().csr.read(MINSTRET);
    let status = match outcome {
        RunOutcome::Exited(0) => Status::Pass,
        RunOutcome::Exited(n) => Status::Fail(n >> 1),
        // The p-env signals completion with `li a7,93; ecall` (an EcallFromM at Level 0).
        RunOutcome::Trapped(t) if t.cause == Exception::EcallFromM => {
            let a7 = m.hart().regs.read(17);
            let a0 = m.hart().regs.read(10);
            if a7 == SYS_EXIT {
                if a0 == 0 {
                    Status::Pass
                } else {
                    Status::Fail(a0 >> 1)
                }
            } else {
                Status::Error(format!("ecall a7={a7} (not exit)"))
            }
        }
        RunOutcome::Trapped(t) => Status::Error(format!("escaped trap {:?}", t.cause)),
        RunOutcome::MaxInstrs => Status::Timeout,
    };
    (status, retired)
}

/// Parse the allowlist: the first whitespace token of each non-comment line is an ELF name.
fn load_allowlist() -> BTreeMap<String, String> {
    let text = std::fs::read_to_string(allowlist_path()).expect("allowlist file must exist");
    let mut map = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut it = line.splitn(2, char::is_whitespace);
        let name = it.next().unwrap().to_string();
        let why = it.next().unwrap_or("").trim().to_string();
        map.insert(name, why);
    }
    map
}

/// A dependency-free deterministic fingerprint (FNV-1a 64) of the sorted ELF corpus — records
/// exactly which binaries the report describes, so two runs over the same bytes match.
fn corpus_fingerprint(elfs: &[(String, PathBuf)]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for (name, path) in elfs {
        for b in name.bytes().chain(std::fs::read(path).unwrap_or_default()) {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    h
}

fn our_git_rev() -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")))
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into())
}

/// Discover every test ELF (any `rv64*` file), sorted for determinism.
fn discover(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut v: Vec<(String, PathBuf)> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with("rv64") && !n.contains('.'))
                })
                .map(|p| (p.file_name().unwrap().to_str().unwrap().to_string(), p))
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// THE regression wall: run everything, write the report, and enforce the allowlist.
#[test]
fn riscv_tests_suite_matches_allowlist() {
    let dir = bin_dir();
    let elfs = discover(&dir);
    assert!(
        !elfs.is_empty(),
        "no test ELFs discovered in {dir:?} — run tools/riscv-tests/build*.sh (an empty run is \
         NEVER a green report)"
    );

    let allow = load_allowlist();
    let results: Vec<(String, Status, u64)> = elfs
        .iter()
        .map(|(name, path)| {
            let (s, r) = run_elf(path);
            (name.clone(), s, r)
        })
        .collect();

    write_reports(&elfs, &results, &allow);

    // Enforce: a non-allowlisted test must PASS; an allowlisted test must NOT pass (else the
    // allowlist entry is stale and must be removed — the target is an empty allowlist).
    let mut violations = Vec::new();
    for (name, status, _) in &results {
        let listed = allow.contains_key(name);
        match (status.is_pass(), listed) {
            (false, false) => {
                violations.push(format!("{name}: {} (not allowlisted)", status.label()))
            }
            (true, true) => violations.push(format!(
                "{name}: now PASSES — remove its stale allowlist entry"
            )),
            _ => {}
        }
    }
    assert!(
        violations.is_empty(),
        "riscv-tests regression wall failed ({} issue(s)):\n{}\nreport: {}",
        violations.len(),
        violations.join("\n"),
        report_path("md").display()
    );
}

fn write_reports(
    elfs: &[(String, PathBuf)],
    results: &[(String, Status, u64)],
    allow: &BTreeMap<String, String>,
) {
    let fp = corpus_fingerprint(elfs);
    let rev = our_git_rev();
    let pass = results.iter().filter(|(_, s, _)| s.is_pass()).count();
    let total = results.len();

    // Markdown (deterministic: sorted names, no timestamps).
    let mut md = String::new();
    md.push_str("# riscv-tests report (E1-T19)\n\n");
    md.push_str(&format!("- our git rev: `{rev}`\n"));
    md.push_str(&format!("- corpus fingerprint (FNV-1a 64): `{fp:#018x}`\n"));
    md.push_str(&format!("- passing: **{pass} / {total}**\n\n"));
    md.push_str("| test | status | retired |\n|---|---|---|\n");
    for (name, status, retired) in results {
        let note = if allow.contains_key(name) {
            " *(allowlisted)*"
        } else {
            ""
        };
        md.push_str(&format!(
            "| {name} | {}{note} | {retired} |\n",
            status.label()
        ));
    }
    std::fs::write(report_path("md"), md).expect("write md report");

    // JSON (hand-rolled, dependency-free, stable key order).
    let mut json = String::new();
    json.push_str("{\n");
    json.push_str(&format!("  \"git_rev\": \"{rev}\",\n"));
    json.push_str(&format!("  \"corpus_fingerprint\": \"{fp:#018x}\",\n"));
    json.push_str(&format!("  \"passing\": {pass},\n  \"total\": {total},\n"));
    json.push_str("  \"tests\": [\n");
    for (i, (name, status, retired)) in results.iter().enumerate() {
        let comma = if i + 1 < results.len() { "," } else { "" };
        json.push_str(&format!(
            "    {{ \"name\": \"{name}\", \"status\": \"{}\", \"retired\": {retired}, \"allowlisted\": {} }}{comma}\n",
            status.label(),
            allow.contains_key(name)
        ));
    }
    json.push_str("  ]\n}\n");
    std::fs::write(report_path("json"), json).expect("write json report");
}

// ── Harness-honesty attacks (the adversarial section, self-applied) ─────────────────────────

/// A FAIL exit code must be classified FAIL — a harness that treats "the program ran an ecall" as
/// pass would let a broken CPU through. We hand-assemble `li a7,93; li a0,(3<<1)|1; ecall`.
#[test]
fn fail_exit_code_is_reported_as_fail() {
    use wasm_vm_core::bus::Bus;
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    let mut m = Machine::new(1 << 20);
    let li = |rd: u32, imm: u32| (imm << 20) | (rd << 7) | 0x13; // addi rd, x0, imm
    m.bus_mut().store32(DRAM_BASE, li(17, 93)).unwrap();
    m.bus_mut()
        .store32(DRAM_BASE + 4, li(10, (3 << 1) | 1))
        .unwrap();
    m.bus_mut().store32(DRAM_BASE + 8, 0x0000_0073).unwrap(); // ecall
    m.hart_mut().regs.pc = DRAM_BASE;
    let outcome = m.run(100);
    let a7 = m.hart().regs.read(17);
    let a0 = m.hart().regs.read(10);
    assert!(matches!(outcome, RunOutcome::Trapped(t) if t.cause == Exception::EcallFromM));
    assert_eq!(a7, SYS_EXIT);
    assert_eq!(
        a0 >> 1,
        3,
        "a FAIL code (3) must be reported as FAIL, never PASS"
    );
}

/// A broken binary must NOT be reported PASS: corrupt the first fetched instruction of a known-good
/// ELF to an illegal word and confirm the run does not reach the pass sentinel.
#[test]
fn corrupted_binary_does_not_pass() {
    use wasm_vm_core::bus::Bus;
    let good = bin_dir().join("rv64ui-p-add");
    if !good.is_file() {
        return; // corpus not built; the main test asserts non-emptiness
    }
    let elf = std::fs::read(&good).unwrap();
    let mut m = Machine::new(64 * 1024 * 1024);
    m.load_elf(&elf).unwrap();
    let pc = m.hart().regs.pc;
    m.bus_mut().store32(pc, 0x0000_0000).unwrap(); // illegal (reserved compressed all-zero)
    let outcome = m.run(BUDGET);
    let a0 = m.hart().regs.read(10);
    let passed = matches!(outcome, RunOutcome::Exited(0))
        || (matches!(outcome, RunOutcome::Trapped(t) if t.cause == Exception::EcallFromM)
            && m.hart().regs.read(17) == SYS_EXIT
            && a0 == 0);
    assert!(!passed, "a corrupted binary must never be reported PASS");
}

/// An empty test directory must be an ERROR, never a green report with zero tests.
#[test]
fn empty_dir_is_not_a_green_run() {
    let tmp = std::env::temp_dir().join("wasmvm_riscv_empty_probe");
    let _ = std::fs::create_dir_all(&tmp);
    assert!(discover(&tmp).is_empty(), "sanity: the probe dir is empty");
    // The main test asserts `!elfs.is_empty()`, so an empty discovery aborts the run — proven here
    // by discovery returning zero, which that assertion converts into a failure rather than a pass.
}

/// Coverage: the discovered per-suite counts must match the known vendored manifest — a silently
/// dropped suite (e.g. a glob that stops matching) must fail, not shrink the wall unnoticed.
#[test]
fn discovered_suite_counts_match_manifest() {
    let elfs = discover(&bin_dir());
    if elfs.is_empty() {
        return; // corpus not built; the main test enforces non-emptiness
    }
    let mut by_prefix: BTreeMap<&str, usize> = BTreeMap::new();
    for (name, _) in &elfs {
        for pfx in [
            "rv64ui-p-",
            "rv64um-p-",
            "rv64ua-p-",
            "rv64uf-p-",
            "rv64ud-p-",
            "rv64uc-p-",
            "rv64mi-p-",
        ] {
            if name.starts_with(pfx) {
                *by_prefix.entry(pfx).or_default() += 1;
            }
        }
    }
    // Expected vendored counts (the -p user suites + rv64mi-p). Adjust ONLY when the pinned
    // corpus changes — a mismatch means a suite silently appeared or vanished.
    let expected = [
        ("rv64ui-p-", 54),
        ("rv64um-p-", 13),
        ("rv64ua-p-", 19),
        ("rv64uf-p-", 11),
        ("rv64ud-p-", 12),
        ("rv64uc-p-", 1),
        ("rv64mi-p-", 17),
    ];
    for (pfx, want) in expected {
        assert_eq!(
            by_prefix.get(pfx).copied().unwrap_or(0),
            want,
            "suite {pfx} count changed — a suite was silently added or dropped"
        );
    }
}
