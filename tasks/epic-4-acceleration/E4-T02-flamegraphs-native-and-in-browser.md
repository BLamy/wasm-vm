---
id: E4-T02
epic: 4
title: Host-side flamegraphs for native and in-browser builds
priority: 402
status: pending
depends_on: [E4-T01]
estimate: M
capstone: false
---

## Goal
A documented, repeatable procedure (plus committed reference profiles) for producing
flamegraphs of the *emulator itself* — native via `samply`/`cargo flamegraph`, in-browser
via Chrome DevTools performance profiles with readable Rust frame names — so host-side
hotspots (dispatch overhead, bounds checks, bindgen boundary costs) are visible, not
guessed, before the JIT design doc is written.

## Context
E4-T01 tells us where the *guest* spends time; this task tells us where the *host* does.
The interpreter's dispatch loop, memory access path, and wasm-bindgen crossings are the
usual suspects (see v86's optimization history), but Chrome/Firefox profile WASM very
differently and stripped builds show anonymous frames. Getting symbolicated browser
profiles requires keeping the wasm name section (`wasm-pack --profiling` /
`debug = true` in release profile) and is worth pinning down once, permanently.

## Deliverables
- `docs/profiling.md`: exact commands for (a) native flamegraph of a benchmark run under
  `samply` or `perf` + inferno, (b) browser profile capture with symbolicated wasm frames
  in Chrome and Firefox, including required build flags and name-section verification.
- Build profile/feature (`profile.profiling`) that keeps symbols and name section without
  disabling optimizations.
- Committed reference profiles (native SVG + exported DevTools JSON) for two workloads:
  Alpine boot, and a CoreMark run — captured on the Level 3 interpreter.
- A short written findings section: top 5 host-side costs with % attribution, explicitly
  feeding E4-T06 (e.g. dispatch vs memory path vs device polling split).

## Acceptance criteria
- [ ] Following `docs/profiling.md` verbatim on a clean checkout yields a native flamegraph
      where interpreter functions are named (no `[unknown]` in the top 10 frames).
- [ ] Browser capture shows demangled/named Rust frames inside wasm (name section present,
      verified with `wasm-objdump -h` or `wasm-tools`).
- [ ] The profiling build's CoreMark score is within 15% of the release build (symbols must
      not destroy representativeness).
- [ ] Findings doc quantifies dispatch-loop share of host time for the CoreMark workload.

## Adversarial verification
Refute by following the doc on a machine/profile that has never built this repo and failing
to reproduce a symbolicated profile in either browser or native. Attack angles: (1) check
the wasm binary actually shipped to the browser for the name section — if the doc's flags
silently strip it under `wasm-opt`, refuted; (2) compare profiling-build vs release-build
CoreMark — >15% delta refutes representativeness; (3) cross-check the findings: if the doc
claims dispatch is X% of time, hack in a no-op-dispatch microbenchmark or use E4-T01
counters to bound it — a claim off by >2x is a refutation; (4) attempt the Firefox capture
path specifically; a Chrome-only procedure fails the deliverable as written.

## Verification log
(empty)
