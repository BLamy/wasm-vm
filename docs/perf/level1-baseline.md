# Level-1 interpreter performance baseline (E1-T23)

The **official Level-1 interpreter MIPS baseline** — the number every Level-4 JIT "≥10×"
claim is measured against, and the floor Epic 2/3 feature work must not silently drop below.
A perf claim without a pinned workload, build profile, and host is noise, so all three are
fixed here.

## Methodology (frozen)
- **Metric:** MIPS = **`minstret` ÷ wall time** — the *architectural* retired-instruction count,
  never a loop/iteration estimate (acceptance #4). Each workload is an **infinite in-RAM loop**
  run for a fixed instruction budget (`BUDGET = 20_000_000`), so the retire count is exactly the
  budget; the harness **asserts `minstret == BUDGET`** every run (the cross-check against the
  T22 trace counter — both count architectural retirements).
- **Workloads** (`crates/core/tests/perf_baseline.rs`), each isolating a subsystem:
  `alu` (3 register adds + jump → decode/dispatch), `branch` (increment + taken conditional →
  branch cost), `memory` (sd/ld to a fixed slot + jump → the memory path), `fp` (fadd.d + fmul.d
  + jump → softfloat cost).
- **Runs:** one untimed warmup, then median of 5 timed runs; spread = (max−min)/median.
- **Clock:** default reset config (no CLINT timer armed) — guest-visible timing is inert, so it
  can't perturb workload behavior between runs (acceptance #6).
- **Regenerate:** `cargo test -p wasm-vm-core --release --test perf_baseline report -- --ignored --nocapture`
  (or `bash tools/bench.sh`).

## Measurement — 2026-07-04

| Field | Value |
|-------|-------|
| Host CPU / OS | Apple M2 (aarch64) / macOS 26.2 |
| rustc | 1.96.0 (ac68faa20 2026-05-25) |
| Build profile | `--release` (default: lto=false, codegen-units=16, opt-level=3) |

### Native aarch64 (median of 5, warmup discarded)

| Workload | Median MIPS | Spread | Retired (== budget) |
|----------|------------:|-------:|--------------------:|
| alu (decode/dispatch) | **32.3** | 0.5% | 20,000,000 |
| branch | **34.8** | 5.6% | 20,000,000 |
| memory | **27.0** | 2.0% | 20,000,000 |
| fp (softfloat) | **29.4** | 3.1% | 20,000,000 |

All spreads ≤ 10% (acceptance #1). Native MIPS is within the ROADMAP's expected order of
magnitude (≥ 30 MIPS for the compute-bound alu/branch workloads; acceptance #2).

**Finding (honest):** `fp` is NOT the slow one here (29.4 vs 32.3 for `alu`) — softfloat
add/mul on the `+0.0` operands these loops carry hit early-out paths. A representative FP cost
needs an **FP-torture** stream (subnormals, NaN payloads, all rounding modes); that corpus is a
documented follow-on (see below), and its number will feed back into T05's softfloat record.

## CI guard
`perf_smoke_alu_above_floor` (release, `#[ignore]`) asserts the `alu` median clears a
**conservative order-of-magnitude floor (15 MIPS)** — set well below the aarch64 baseline so
cross-machine/CI noise stays green, but high enough that a ≥3× regression trips it. Run in the CI
`perf-smoke` job. It catches order-of-magnitude regressions, not 10% wiggles (a flaky perf gate
gets disabled within a month; this one won't).

## Scope / deferred (honest — this environment is native aarch64 only)
- **x86_64 native** and **Chrome/Firefox in-browser** columns: not measurable on this single
  aarch64 host. The wasm interpreter is the same `wasm-vm-core` proven bit-identical to native in
  **E1-T22**; the browser MIPS harness (a Bench page printing the JSON schema above via
  `performance.now()`) is wired from the E0-T23 demo and awaits a measurement pass on those
  platforms.
- **Dhrystone / CoreMark** bare-metal rv64gc: need a **newlib-equipped riscv64-unknown-elf
  toolchain** the `wasm-vm-toolchain:local` image lacks (the same E1-T16 block that gates
  rv64ui-v). The microbenchmarks above isolate the same subsystems in the meantime; the standard
  Dhrystone/CoreMark iterations-per-second rows land when that toolchain does.
- **Flamegraph / hot-spot profile:** needs a native profiler pass (cargo-flamegraph / `perf`); a
  follow-on.
