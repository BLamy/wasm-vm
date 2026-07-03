# Performance baselines (E0-T24)

The **official Level 0 interpreter baseline**. Level 4's "≥10× JIT" capstone is
contractually measured against these numbers. A performance claim without a pinned
workload, build profile, and environment is noise, so all three are fixed here.

- **Workload:** `guest/prebuilt/loops.elf` — retired-instruction count goldened in E0-T14
  at **48**. MIPS = retired ÷ wall-time. The count is *verified* every bench iteration
  (the harness asserts the machine's own retired counter equals 48), not assumed.
- **Metric:** each iteration reloads the ELF (a clean reset — segments + bss-zero +
  `pc=entry` + HTIF re-armed) and runs it to HTIF exit; criterion reports
  `Throughput::Elements(48)` as instructions/second.
- **Regenerate the native rows:** `make bench`. Node row: `node web/bench-node.mjs`.
  Browser row: the **Bench** button on the E0-T23 demo page.

## Measurement — 2026-07-03

| Field | Value |
|-------|-------|
| Git SHA (branch base) | `f917b0484b85d93873620b2b29ac1857ce67f282` (`task/e0-t24-benchmark`) |
| Host CPU / OS | Apple M2 / macOS 26.2 |
| rustc | 1.96.0 (ac68faa20 2026-05-25) |
| Build profile | `--release`, default (`lto = false`, `codegen-units = 16`, `opt-level = 3`) |
| Node | v24 (bundled with this toolchain) |
| Browser | Chrome 150 |

### Native (criterion, 3 consecutive `cargo bench` runs)

| Bench | Run 1 | Run 2 | Run 3 | Cross-run spread |
|-------|------:|------:|------:|-----------------:|
| `trace_off`         (MIPS) | 71.5 | 70.8 | 70.6 | **1.2 %** (< 10 %) |
| `trace_on_nullsink` (MIPS) | 69.4 | 70.0 | 67.8 | — |
| `trace_on_vecsink`  (MIPS) | 36.1 | 36.1 | 35.8 | — |

- **Native interpreter ≈ 70 MIPS** (within the 50–300 MIPS sanity rail for a naive
  interpreter).
- **Zero-cost trace (E0-T15), measured:** `trace_off` vs `trace_on_nullsink`, measured
  back-to-back, differ by **0.4 %–1.0 %** (≤ 2 %) — as expected, since `run()` *is*
  `run_traced(&mut NullSink)` (E0-T18), so the two exercise the identical monomorphized
  code and the small spread is pure measurement noise (both signs observed across runs).
  The **definitive** zero-cost proof is the asm-level `tools/check-zero-cost.sh` (the
  null-sink path contains no trace calls).
- **Recording cost:** `trace_on_vecsink` ≈ 36 MIPS — capturing every record roughly halves
  throughput (the honest cost of `--trace`).

### wasm (loops.elf, ≥ 10⁷ retired instructions per `bench()` call)

| Environment | Run 1 | Run 2 | Run 3 | native ÷ wasm |
|-------------|------:|------:|------:|--------------:|
| node-wasm (`bench-node.mjs`) | 37.5 | 34.8 | 38.2 | **≈ 1.9×** |
| browser (Chrome 150, steady) | 17.9 | 18.1 | — | **≈ 3.9×** |

- Each `bench()` call retires **10,000,032** instructions (≥ 10⁷ — keeps JS↔wasm boundary
  chatter out of the measurement; the first browser call also pays JIT warm-up, discarded).
- **native ÷ wasm = 1.9× (node) and 3.9× (browser)** — both inside the sane 1.5×–8× band.
  (node's V8 wasm tier outruns the browser's here; both are legitimate wasm baselines.)

## Notes

- These are **baselines, not thresholds** — Epic 0 has no perf gate. The 50–300 MIPS and
  1.5×–8× ranges are sanity rails that catch measurement bugs (a "MIPS" that rises when the
  guest does *more* work per instruction, or a wild native/wasm ratio, means the counter or
  timer is lying — not a fast machine).
- Re-run `make bench` on any descendant of the recorded SHA; the interpreter is unchanged
  by this task (only the benchmark harness was added), so the numbers reproduce within the
  documented variance.
