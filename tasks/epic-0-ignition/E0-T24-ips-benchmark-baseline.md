---
id: E0-T24
epic: 0
title: Instructions-per-second benchmark scaffold and recorded interpreter baseline
priority: 24
status: implemented
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
### 2026-07-03 — worker claim — branch task/e0-t24-benchmark (stacked on e0-t23)
Deliverables: a repeatable MIPS baseline in 3 environments, recorded as the Level 0 baseline.
- crates/cli/benches/interp.rs (criterion, harness=false): workload loops.elf (E0-T14 golden 48
  retired). Each iteration RELOADS the ELF (clean reset: segments+bss-zero+pc=entry+HTIF re-armed)
  and runs to HTIF exit; Throughput::Elements(48) → criterion reports instructions/sec. Three
  benches: trace_off (run), trace_on_nullsink (run_traced+NullSink), trace_on_vecsink (recording).
  verify_retired() asserts the retired counter == golden 48 EACH bench (acceptance 2, verified not
  assumed). black_box(outcome)+black_box(hart.regs.pc) defeats dead-code elision (angle 1) — the
  earlier snapshot().pc consume was SHA-256-ing 1 MiB and measuring the digest, fixed to a cheap
  register read.
- wasm bench(target_instrs:u32)->{retired,ms} in wasm-vm-wasm: runs loops.elf on the trace-off path
  until retired ≥ target (≥10^7 keeps JS↔wasm boundary chatter out, angle 3), timed via Date.now();
  MIPS = retired/ms/1000. web/bench-node.mjs (loads the --target web module by handing init() the
  wasm bytes — node has no file: fetch) and a "Bench" button on the E0-T23 page.
- docs/baselines.md: recorded table — date 2026-07-03, SHA f917b048 (branch base), Apple M2/macOS
  26.2, rustc 1.96.0, release (lto=false codegen-units=16), Chrome 150; MIPS ×3 runs per env +
  the trace-off vs NullSink delta. make bench regenerates native rows.
MEASURED (Apple M2): native trace_off ≈70 MIPS (3-run spread 1.2% <10%, acceptance 1); node-wasm
≈37 MIPS; browser Chrome 150 ≈18 MIPS steady. native÷wasm = 1.9× (node), 3.9× (browser) — both in
the 1.5×–8× band (acceptance 3). Each bench() retires 10,000,032 (≥10^7). trace_off vs
trace_on_nullsink measured back-to-back = 0.4%–1.0% (≤2%, acceptance 5) — they are the SAME
monomorphized code (run==run_traced(NullSink), E0-T18), spread is noise; definitive proof is
tools/check-zero-cost.sh (asm null path has no trace calls). vecsink ≈36 MIPS (recording ~halves it).
Gates: fmt; clippy --workspace --all-targets --all-features -D warnings 0 (compiles the bench);
workspace tests 0 FAILED; cargo bench prints MIPS; wasm build + node bench green; zero-cost selftest OK.
rr: N/A (perf/macOS). Verifier angles open: dead-code (1, black_box + recompile-loops-with-more-work
→ MIPS ~constant), battery variance (2), bench()≥10^7 (3, =1e7), recompute MIPS by hand from
criterion ns (4: 48 instrs / 687.88 ns = 69.8 Melem/s ✓), docs SHA vs HEAD (5).
