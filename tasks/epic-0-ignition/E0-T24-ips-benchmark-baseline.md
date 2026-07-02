---
id: E0-T24
epic: 0
title: Instructions-per-second benchmark scaffold and recorded interpreter baseline
priority: 24
status: pending
depends_on: [E0-T18, E0-T14, E0-T15]
estimate: S
capstone: false
---

## Goal
A repeatable MIPS (million instructions per second) measurement for the interpreter on
fixed workloads, in three environments — native (criterion), node-wasm, and browser —
with the numbers recorded as the official Level 0 baseline that Level 4's "≥10x" capstone
is contractually measured against.

## Context
A performance claim without a pinned workload, build profile, and environment is noise.
Workload: `loops.elf`, whose exact retired-instruction count was goldened in E0-T14 —
MIPS = retired / wall time, using the machine's own retired counter cross-checked against
the golden count. Build profile: `--release` with the workspace's committed profile
(document `lto`/`codegen-units`). The same scaffold proves E0-T15's zero-cost claim by
measuring trace-off vs. NullSink-with-trace-feature. Expected magnitudes (sanity rails,
not requirements): interpreters typically land at 50–300 native MIPS, with wasm at 2–6x
slower.

## Deliverables
- `crates/cli/benches/interp.rs` (criterion): `step`-loop over `loops.elf` reset each
  iteration; benches for trace-off, trace-on-NullSink, trace-on-VecSink.
- Browser/node bench: a `bench()` export in `wasm-vm-wasm` (runs N retired instructions,
  returns ms via `performance.now()`), a "Bench" button in the E0-T23 page, and a node
  runner `web/bench-node.mjs`.
- `docs/baselines.md`: recorded table — date, git SHA, host CPU/OS, rustc version,
  browser versions, MIPS for each environment ×3 runs, and the trace-off vs. NullSink
  delta. `make bench` regenerates the native rows.

## Acceptance criteria
- [ ] `cargo bench -p wasm-vm-cli` runs and prints MIPS; three consecutive runs vary by
      < 10% (documented if the host can't achieve this, e.g. thermal throttling).
- [ ] The bench's instruction count is *verified*, not assumed: retired counter equals
      the E0-T14 golden count for `loops.elf` each iteration.
- [ ] Node and browser benches produce numbers; native/wasm ratio falls within a sane
      1.5x–8x band (a wild ratio indicates a measurement bug, not a fast machine).
- [ ] `docs/baselines.md` is populated with real measurements from at least one machine.
- [ ] Trace-off vs. trace-on-NullSink delta ≤ 2% (the E0-T15 zero-cost proof, measured).

## Adversarial verification
(1) Dead-code attack: interpreters benched with unused results get partially optimized
away — verify the bench consumes the final state digest (black_box) and that measured
native MIPS drops when you insert a deliberate 10-instruction slowdown into the loop body
of the guest (recompile loops.elf with more work; MIPS should stay ~constant while wall
time grows — if MIPS *rises*, the counter or timer is lying). (2) Re-run the full bench
on battery/low-power and confirm the docs' variance caveats hold up. (3) Check the wasm
bench isn't timing JS↔wasm boundary chatter: retired count per `bench()` call must be
≥ 10^7. (4) Recompute MIPS by hand from criterion's raw output — arithmetic errors in the
harness refute. (5) Confirm `docs/baselines.md` SHA matches the benched checkout
(`git rev-parse HEAD`).

## Verification log
(empty)
