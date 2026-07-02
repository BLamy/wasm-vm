---
id: E4-T22
epic: 4
title: CPU execution on a dedicated Web Worker with SharedArrayBuffer guest RAM
priority: 422
status: pending
depends_on: [E4-T11]
estimate: L
capstone: false
---

## Goal
The CPU loop (interpreter + JIT) runs on a dedicated Web Worker against a shared wasm
memory (SharedArrayBuffer-backed) holding guest RAM, CPU state, and TLBs, leaving the main
thread for DOM/xterm.js/devices — with the COOP/COEP deployment story solved (headers,
dev server, and static-hosting fallback documented and tested), a WFI park/wake path via
`Atomics.wait`/`notify`, and a single-threaded fallback build retained for non-isolated
contexts.

## Context
Off-main-thread execution is a prerequisite for both smooth UX (Level 5 needs the main
thread for frames) and the JIT's long uninterrupted runs. Requirements stack: shared wasm
memory needs `crossOriginIsolated === true`, which needs `Cross-Origin-Opener-Policy:
same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (or credentialless) — easy on
our dev server, awkward on GitHub Pages (document the service-worker header-injection
shim as fallback). Build mechanics: `wasm32` with `+atomics,+bulk-memory,+mutable-globals`
and shared-limits memory (the E4-T07 emitter already encodes shared limits for JIT
modules; the *main* module's shared build is a wasm-bindgen/target-feature exercise).
The worker owns the dispatch loop; `Atomics.wait` is legal there (forbidden on main).
WFI parks the worker in `Atomics.wait` on an IRQ cell with a timeout for the next timer
deadline. Device MMIO is *temporarily* a blocking stub; the real proxy is E4-T23.

## Deliverables
- Worker bootstrap: instantiate the core module with an imported shared `WebAssembly.
  Memory`; handshake transferring boot parameters; JIT runtime (E4-T10) operating
  worker-side (compile via `WebAssembly.compile` in-worker).
- WFI park/wake: `Atomics.wait(irq_cell, 0, timeout_to_next_mtimecmp)`; main thread (or
  device code) writes irq_cell + `Atomics.notify`.
- COOP/COEP: dev-server headers, production header documentation, service-worker shim for
  header-less static hosts, and a runtime `crossOriginIsolated` probe that selects the
  single-threaded fallback build cleanly (no half-initialized state).
- Interim synchronous MMIO stub (worker-blocking request/response cell) so Alpine still
  boots before E4-T23 replaces it.
- CI: browser test matrix runs the worker build in Chrome + Firefox.

## Acceptance criteria
- [ ] Alpine boots to login with the CPU on the worker, Chrome and Firefox; interpreter
      and JIT tiers both function (stats show translated execution worker-side).
- [ ] Main-thread responsiveness: rAF gap ≤ 20 ms p99 during CoreMark (was: whole runs
      blocked pre-worker) — measured and committed.
- [ ] WFI idle: an idle Alpine shell consumes < 2% host CPU (worker parked in
      Atomics.wait, verified via profiler), and wakes on keypress within 20 ms.
- [ ] Non-isolated context (no COOP/COEP) falls back to single-threaded build with a
      console warning — same guest behavior, verified in CI by serving without headers.
- [ ] riscv-tests green in the worker configuration (browser runner).

## Adversarial verification
Refute isolation and wake correctness. Attack angles: (1) deploy to a header-less static
host (or local server stripping COOP/COEP) — if the page whitescreens or half-boots
instead of cleanly falling back, refuted; verify the SW shim path actually flips
`crossOriginIsolated` on second load; (2) wake storm: pipe 10 kB/s of UART input at a
parked guest — lost wakeups (guest misses bytes) or a missed `Atomics.notify` leaving the
worker parked past its timeout refutes; (3) memory-model attack: main thread writes a
device buffer then sets irq_cell — confirm the worker observes buffer contents (SAB +
Atomics ordering used correctly; a data race visible as stale reads refutes); use
`--enable-features` TSAN-ish stress where available or a handshake-counter test;
(4) tab lifecycle: background the tab 5 minutes mid-CoreMark, foreground — worker must
resume without guest time explosion (full fix is E4-T24; here, no crash/deadlock);
(5) kill the worker via DevTools and confirm the page surfaces a fatal-but-clean error.

## Verification log
(empty)
