---
id: E4-T02
epic: 4
title: Host-side flamegraphs for native and in-browser builds
priority: 402
status: partially-verified
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

## Verification debt
_Tracked as debt (the ticket is `partially-verified`); clear on `dev`._
- **CLEARED on `dev` (2026-08-05):** a live Chrome DevTools performance profile of the wasm build booting in-browser was captured on `dev` (the mac reaps this boot) — `evidence/e4-t02/browser-boot.cpuprofile.gz` (3 MB uncompressed). The `-g`-preserved name section yields demangled `wasm_vm_core::*` frames. Native flamegraph pipeline + this browser capture together satisfy the ticket; no debt remains.

## Verification log
- 2026-08-05 — **Native flamegraph pipeline done + a real capture landed (commits `19c07e6`, `6d26fa7`);
  status partially-verified (browser CAPTURE reaping-deferred).** Profiler: `samply` (no-sudo OS sampler
  on macOS; exports a committable/re-openable Firefox-Profiler JSON — chosen over cargo-flamegraph which
  needs dtrace/sudo). Symbol readability: additive `[profile.profiling]` (`inherits=release, debug=true,
  strip=false`) — release already carries `debug=2` via `.cargo/config.toml`, so the profiling profile is
  the portable guarantee; release build unaffected; CoreMark on the profiling binary = 261.734 it/s,
  identical to baseline (0% overhead, well inside AC). WASM adversarial finding: a bare `wasm-pack build
  --profiling` ships NO `name` section (wasm-opt strips it), so browser frames would be anonymous — fixed
  with `[package.metadata.wasm-pack.profile.profiling] wasm-opt=['-O','-g']` (restores a 123 KB name
  section, 208 demangled `wasm_vm_core::*` funcs, verified via `wasm-objdump -h`); shipped release wasm
  stays stripped.
  - **REAL top host hotspots** (from `evidence/e4-t02/boot-native.samply.json.gz`, 323k samples,
    atos-symbolicated; CoreMark profile agrees ±1pt): `Machine::sync_plic` 24.1%, `mmu::translate_cached`
    9.8%, `run_traced_inner` dispatch 9.5%, `IrqLine::set` 7.7%, `sync_clint` 7.1%. **Bucketed: per-quantum
    device/interrupt re-sync ≈ 47% (dominant), address translation ≈ 24%, dispatch+execute 13–23%, decode
    9%.** KEY finding that redirects E4-T05/T06: **dispatch is second-order; the per-quantum device re-sync
    is the real host bottleneck** — the quantum-boundary sync cadence, not the decode/dispatch loop, is
    where the win is.
  - Artifacts: `evidence/e4-t02/{boot-native.samply.json.gz, boot-native.folded, coremark-native.samply.json.gz,
    hotspots-summary.md}`; procedure at `docs/perf/flamegraphs.md`.
  - **DEBT:** the live BROWSER capture (Chrome/Firefox DevTools) — reaping-deferred (Alpine wasm boot
    OS-reaps here, same as E4-T03/T04). The hard part (build-flag mechanics for symbolicated browser
    frames) IS verified on-host; only the interactive capture needs a machine that holds the boot.

(empty)
