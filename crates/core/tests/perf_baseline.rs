//! E1-T23: the Level-1 interpreter performance baseline. Measures steady-state MIPS (millions of
//! retired instructions per second) for microbenchmarks that isolate subsystem costs —
//! decode/dispatch (ALU), branch, memory, and softfloat (FP) — using `minstret ÷ wall time`, the
//! ARCHITECTURAL retire count, never a loop estimate. Each workload is an infinite in-RAM loop run
//! for a fixed instruction budget, so the retire count is EXACTLY the budget (asserted against the
//! machine's own `minstret`, the metric cross-check acceptance #4 asks for).
//!
//! `#[ignore]` (perf, not correctness) — run in release: `cargo test -p wasm-vm-core --release
//! --test perf_baseline -- --ignored --nocapture`. The `perf_smoke_*` test is the CI floor
//! (order-of-magnitude regression guard); `report` prints the JSON + markdown for the baseline doc.
//!
//! Scope (this environment): native aarch64 only. x86_64, Chrome/Firefox, Dhrystone/CoreMark (need
//! a newlib bare-metal toolchain — the E1-T16 block), and the flamegraph are documented deferrals
//! in `docs/perf/level1-baseline.md`.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use std::time::Instant;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::{Machine, RunOutcome};

const MINSTRET: u16 = 0xB02;
/// Retire budget per measured run. An infinite loop retires exactly this many, so it is also the
/// MIPS numerator. 20M ≈ sub-second per run at the expected tens-of-MIPS, enough to amortize the
/// build+reset overhead to noise.
const BUDGET: u64 = 20_000_000;
/// Runs per workload for the median + spread (acceptance #1).
const RUNS: usize = 5;

// ── tiny RV64 assembler (only what the loops need) ──────────────────────────────────────────
fn r(funct7: u32, rs2: u32, rs1: u32, funct3: u32, rd: u32, op: u32) -> u32 {
    (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | op
}
fn i_type(imm: i32, rs1: u32, funct3: u32, rd: u32, op: u32) -> u32 {
    ((imm as u32 & 0xFFF) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | op
}
fn s_type(imm: i32, rs2: u32, rs1: u32, funct3: u32, op: u32) -> u32 {
    let u = imm as u32;
    ((u >> 5 & 0x7F) << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | ((u & 0x1F) << 7) | op
}
fn jal(rd: u32, off: i32) -> u32 {
    let o = off as u32;
    ((o >> 20 & 1) << 31)
        | ((o >> 1 & 0x3FF) << 21)
        | ((o >> 11 & 1) << 20)
        | ((o >> 12 & 0xFF) << 12)
        | (rd << 7)
        | 0x6F
}
fn branch(funct3: u32, rs1: u32, rs2: u32, off: i32) -> u32 {
    let o = off as u32;
    ((o >> 12 & 1) << 31)
        | ((o >> 5 & 0x3F) << 25)
        | (rs2 << 20)
        | (rs1 << 15)
        | (funct3 << 12)
        | ((o >> 1 & 0xF) << 8)
        | ((o >> 11 & 1) << 7)
        | 0x63
}

/// Build a machine with `code` at the entry, pc set, and (if `fp`) mstatus.FS enabled.
fn build(code: &[u32], fp: bool) -> Machine {
    let mut m = Machine::new(8 * 1024 * 1024);
    for (i, w) in code.iter().enumerate() {
        m.bus_mut().store32(DRAM_BASE + (i as u64) * 4, *w).unwrap();
    }
    m.hart_mut().regs.pc = DRAM_BASE;
    // A scratch data address for the memory workload; x10 = a valid, aligned RAM slot.
    m.hart_mut().regs.write(10, DRAM_BASE + 0x10_0000);
    // x6 = huge, so the branch workload's `bltu x5,x6` never falls through within the budget.
    m.hart_mut().regs.write(6, u64::MAX);
    if fp {
        // mstatus.FS = Dirty (0b11 << 13) so D-ops don't trap as FS=Off.
        m.hart_mut()
            .csr
            .access(MSTATUS, CsrOp::Set, 0b11 << 13, false, false, 0)
            .unwrap();
    }
    m
}

/// The four microbenchmarks. Each is an infinite loop; `fp` marks the softfloat one.
fn workloads() -> Vec<(&'static str, Vec<u32>, bool)> {
    // register file: x5/x6/x7 scratch; x10 data ptr (set in build).
    let add = |rd, rs1, rs2| r(0, rs2, rs1, 0, rd, 0x33);
    vec![
        (
            // ALU / decode-dispatch: 3 adds + backward jump.
            "alu",
            vec![add(5, 6, 7), add(6, 7, 5), add(7, 5, 6), jal(0, -12)],
            false,
        ),
        (
            // Branch-heavy: increment + taken conditional branch (x6 = u64::MAX).
            "branch",
            vec![i_type(1, 5, 0, 5, 0x13), branch(0b110, 5, 6, -4)],
            false,
        ),
        (
            // Memory path: store then load to a fixed slot + jump.
            "memory",
            vec![
                s_type(0, 5, 10, 0b011, 0x23), // sd x5, 0(x10)
                i_type(0, 10, 0b011, 6, 0x03), // ld x6, 0(x10)
                jal(0, -8),
            ],
            false,
        ),
        (
            // Softfloat: fadd.d + fmul.d + jump (rm=RNE; f-regs start +0.0).
            "fp",
            vec![
                r(0b0000001, 2, 1, 0, 1, 0x53), // fadd.d f1, f1, f2
                r(0b0001001, 3, 1, 0, 2, 0x53), // fmul.d f2, f1, f3
                jal(0, -8),
            ],
            true,
        ),
    ]
}

/// Run one workload once for `BUDGET` retires; return (MIPS, retired). Asserts the run neither
/// trapped nor exited (an infinite loop must hit the budget) and that `minstret == BUDGET`.
fn measure(code: &[u32], fp: bool) -> (f64, u64) {
    let mut m = build(code, fp);
    let t = Instant::now();
    let outcome = m.run(BUDGET);
    let secs = t.elapsed().as_secs_f64();
    assert_eq!(
        outcome,
        RunOutcome::MaxInstrs,
        "workload must be an infinite loop"
    );
    let retired = m.hart_mut().csr.read(MINSTRET);
    assert_eq!(
        retired, BUDGET,
        "minstret {retired} != budget {BUDGET} — MIPS denominator wrong"
    );
    ((BUDGET as f64) / secs / 1e6, retired)
}

fn median_spread(mut v: Vec<f64>) -> (f64, f64) {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = v[v.len() / 2];
    let spread = (v[v.len() - 1] - v[0]) / median * 100.0;
    (median, spread)
}

/// Print the JSON + markdown baseline rows (native leg) for `docs/perf/level1-baseline.md`.
#[test]
#[ignore = "perf; run --release --nocapture to regenerate the baseline doc"]
fn report() {
    println!("=== E1-T23 native perf baseline (MIPS = minstret / wall) ===");
    println!("| workload | median MIPS | spread % | retired |");
    println!("|---|---:|---:|---:|");
    let mut json = String::from("[\n");
    for (name, code, fp) in workloads() {
        let _ = measure(&code, fp); // warmup: heat the host code cache so run 1 isn't an outlier
        let mut mips = Vec::new();
        let mut retired = 0;
        for _ in 0..RUNS {
            let (m, r) = measure(&code, fp);
            mips.push(m);
            retired = r;
        }
        let (med, spread) = median_spread(mips);
        println!("| {name} | {med:.1} | {spread:.1} | {retired} |");
        json.push_str(&format!(
            "  {{ \"workload\": \"{name}\", \"mips_median\": {med:.2}, \"spread_pct\": {spread:.1}, \"retired\": {retired} }},\n"
        ));
    }
    json.push(']');
    println!("\nJSON:\n{json}");
}

/// CI perf-smoke (acceptance #5): the ALU workload's median MIPS must clear a conservative floor.
/// The floor is an ORDER-OF-MAGNITUDE guard — set well below the recorded aarch64 baseline so
/// normal cross-machine/CI noise stays green, but high enough that a ≥3× regression trips it.
/// Documented in docs/perf/level1-baseline.md; the critic verifies a 3× slowdown turns it red.
#[test]
#[ignore = "perf smoke; run --release --ignored in the CI perf job"]
fn perf_smoke_alu_above_floor() {
    const FLOOR_MIPS: f64 = 15.0;
    let (_, code, fp) = workloads().into_iter().next().unwrap();
    let _ = measure(&code, fp); // warmup
    let mut mips: Vec<f64> = (0..3).map(|_| measure(&code, fp).0).collect();
    mips.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = mips[1];
    assert!(
        median >= FLOOR_MIPS,
        "ALU MIPS {median:.1} < floor {FLOOR_MIPS} — an order-of-magnitude perf regression \
         (or genuinely slow CI hardware; re-examine the floor + record the host)"
    );
    println!("perf-smoke: alu median {median:.1} MIPS ≥ floor {FLOOR_MIPS}");
}
