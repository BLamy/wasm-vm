---
id: E2-T25
epic: 2
title: Boot-time profiling baseline — where the time goes, CPU vs devices
priority: 225
status: pending
depends_on: [E2-T19]
estimate: S
capstone: false
---

## Goal
A quantified, reproducible answer to "why does boot take N seconds": phase-by-phase wall
time, instructions retired, emulated MIPS, and the CPU-execution vs device-emulation vs
host-I/O split — the frozen baseline Epic 4's ≥10x JIT claim will be measured against.

## Context
Two measurement layers. Guest-relative: kernel `printk` timestamps (`CONFIG_PRINTK_TIME`
from E2-T12) plus `initcall_debug` give per-initcall costs; OpenRC service timings from
its own logs; mark phases at SBI-probe, earlycon-up, VFS-mount-root, getty-exec. Host-
relative: instrument the emulator's main loop with counters — instructions retired, time
in CPU dispatch vs time in device MMIO handlers (per device: UART, virtio-blk, RTC, PLIC,
CLINT) vs block-backend I/O vs (browser) executor idle gaps; derive MIPS per phase.
Correlate the two clocks by logging host time at each guest printk phase marker (watch
the UART — every console byte is an MMIO exit; console-heavy phases will look
device-bound, which is itself a finding). Native profiling: `cargo flamegraph` (or
`samply`) over a full boot, archived SVG. Browser: `performance.mark`/`measure` around
quanta + a boot-total figure; note rAF-executor duty cycle. Deliberately cheap
methodology — this is a baseline, not an observability platform; instrument behind a
`profile` feature flag so release WASM stays lean.

## Deliverables
- `--profile-boot` flag emitting a phase table (JSON + pretty) at getty-exec; per-device
  MMIO time counters in the E2-T20 stats struct.
- `docs/perf-baseline.md`: the numbers (native + browser), flamegraph, top-5 hotspots
  named, and the explicit MIPS baseline figure Epic 4 must beat 10x.
- `tools/profile-boot.sh` reproducing the whole measurement in one command.

## Acceptance criteria
- [ ] Phase table produced for both busybox and Alpine boots, native and browser; totals
      within 5% of an independent stopwatch (script-measured wall time).
- [ ] The CPU/device/IO split sums to ≥ 95% of measured wall time (unaccounted time
      < 5%, or the residual is itself explained).
- [ ] Documented MIPS figure for the interpreter on the Alpine boot (native and browser),
      plus top-5 flamegraph hotspots with % shares.
- [ ] Three consecutive `tools/profile-boot.sh` runs: per-phase variance < 10% RSD.
- [ ] `profile` feature off: counters compile away (checked via benchmark: overhead < 1%).

## Adversarial verification
Independently time a boot with `hyperfine` (native) and Playwright wall-clock (browser)
and compare to the tool's total — > 5% disagreement refutes. Sanity-check the split by
perturbation: artificially slow the block backend by 10x (add a delay) and confirm the
device/IO share moves by roughly the predicted amount — if the attribution barely moves,
the accounting is fiction: refute. Cross-check instruction counts against the E1 trace
counter for a fixed bare-metal workload (must match exactly). Run with `profile` feature
disabled and diff boot time vs enabled — overhead above the documented figure refutes.
Check the baseline doc's numbers were produced by the checked-in script, not hand-edited
(re-run and compare).

## Verification log
(empty)
