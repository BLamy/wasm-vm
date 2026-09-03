---
id: E4-T22
epic: 4
title: CPU execution on a dedicated Web Worker with SharedArrayBuffer guest RAM
priority: 422
status: cancelled
decomposed_into: [E4-T22a, E4-T22b, E4-T22c, E4-T22d, E4-T22e, E4-T22f, E4-T22g]
depends_on: [E4-T11]
estimate: L
risk: high
capstone: false
---

> **DECOMPOSED 2026-09-03.** This L-sized planning container is cancelled and replaced by seven
> ordered S tasks. The children own the shared build, isolation/fallback policy, signalling
> protocol, worker bootstrap, demo integration, live performance proof, and adversarial hardening
> boundaries. The final child is the end-to-end threaded-worker sign-off.

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

## Status
cancelled — the landed implementation and historical verification notes below are retained as
context; the decomposed child tasks are authoritative for remaining work and proof.

## Deliverables landed (this pass)
- Shared-memory build: `tools/build-web-shared.sh` — nightly + `-Z build-std`,
  `+atomics,+bulk-memory,+mutable-globals`, `--shared-memory --import-memory --max-memory=2GiB`.
  Emits a module that IMPORTS a shared `env.memory`. Makefile target `wasm-shared`. The
  single-threaded fallback is the existing stable `make wasm` (non-shared, internal memory).
- `web/cpu-isolation.js` — `crossOriginIsolated` probe + PURE `selectCpuBackend` decision (shared
  worker vs single-thread fallback; no half-init; `?singlethread=1` override).
- `web/cpu-control-block.js` — shared control block (Int32 SAB): WFI park/wake via
  `Atomics.wait`/`notify` on a monotonic IRQ cell, and the interim synchronous MMIO request/response
  cell.
- `web/cpu-worker.js` + `web/cpu-worker-host.js` — dedicated CPU worker bootstrap (instantiate core
  against the imported shared memory; boot handshake; dispatch/WFI loop) and the main-thread
  controller (spawn, handshake, interrupt wake, MMIO servicing pump, clean fatal on worker crash).
- COOP/COEP: dev server already sends the headers (`tools/serve-dev.sh`); production header docs +
  the header-injection service-worker shim `web/coi-serviceworker.js` (+ `-register.js`) for
  header-less static hosts (GitHub Pages), all in `docs/e4-t22-cpu-worker-coop-coep.md`.
- CI: `web/playwright.e4-t22.config.js` (Chrome + Firefox matrix) + specs
  `web/tests/e4-t22-cpu-worker.spec.js` and `web/tests/e4-t22-fallback-no-headers.spec.js`.

## Verification log

### 2026-09-03 — coordinator — decomposed

Split the L-sized planning container into one-boundary S tasks:

- **E4-T22a** — reproducible shared-memory and single-threaded wasm build variants.
- **E4-T22b** — COOP/COEP detection, service-worker/static-host fallback, and fail-closed backend
  selection.
- **E4-T22c** — shared IRQ/WFI and interim MMIO control-block protocol with atomic ordering.
- **E4-T22d** — raw CPU-worker bootstrap, imported shared memory, handshake, and sliced dispatch.
- **E4-T22e** — demo wiring, controller parity, and interpreter/JIT selection across the threaded
  and fallback paths.
- **E4-T22f** — live browser Alpine worker boot, rAF/input responsiveness, and WFI wake budgets.
- **E4-T22g** — headerless fallback plus wake-storm, memory-ordering, lifecycle, and fatal-error
  adversarial replay; final end-to-end sign-off.

The original acceptance criteria and historical evidence remain above for traceability. No child is
activated by this decomposition commit.
- 2026-08-06 — SHARED core builds clean: `bash tools/build-web-shared.sh` →
  `- memory[0] pages: initial=19 max=32768 shared <- env.memory` (wasm-objdump on the built
  `wasm_vm_wasm.wasm`). Nightly + build-std, `+atomics,+bulk-memory,+mutable-globals`.
- 2026-08-06 — FALLBACK core builds clean: `cargo build -p wasm-vm-wasm --release --target
  wasm32-unknown-unknown` (pinned stable) → non-shared internal memory (`memory[0] initial=19`, no
  `shared`, no import). Both variants compile.
- 2026-08-06 — probe→selection unit-tested: `node --test web/tests/cpu-isolation.test.mjs
  web/tests/cpu-control-block.test.mjs` → 16/16 pass. isolated=true ⇒ `worker-shared`;
  isolated/SAB/Atomics/Worker missing or `?singlethread=1` ⇒ `single-thread` fallback; warns exactly
  once on fallback; empty env never throws. Control-block: monotonic IRQ counter, shared-buffer
  visibility across attach, 64-bit MMIO request/respond round-trip.
- 2026-08-06 — no regressions: `node --test web/tests/*.test.mjs` → 70/70 pass.
- 2026-08-06 — no Rust source touched (build wiring only), so `fmt`/`clippy` are N/A for this pass.

## Verification debt (browser/dev legs — OS-reap on this macOS host; run on `dev`)
- Live Alpine boot to login with the CPU on the worker, Chrome + Firefox
  (`web/playwright.e4-t22.config.js`); interpreter + JIT both worker-side (JIT itself is E4-T07..T11,
  not yet built — `runSlice`/`run_slice` is a placeholder until the shared dispatch export lands).
- wasm-bindgen threading-glue for the shared pkg: the global `wasm-bindgen` CLI here is 0.2.108 vs
  the crate's 0.2.126, so the `--target web` transform is deferred to dev (via the version-matched
  wasm-pack). The raw shared+imported module is proven headlessly; the JS glue is not generated here.
- Main-thread responsiveness (rAF gap ≤ 20 ms p99 during CoreMark) — needs measurement on dev.
- WFI idle < 2% host CPU + keypress wake ≤ 20 ms — profiler measurement on dev.
- Non-isolated fallback served without headers (`web/tests/e4-t22-fallback-no-headers.spec.js`,
  `E4T22_NOHEADERS_URL` → `make web-serve`) — browser leg on dev; the selection LOGIC is unit-tested
  headlessly.
- SW header-injection shim flipping `crossOriginIsolated` on second load (adversarial #1),
  wake-storm (#2), memory-model stale-read (#3), tab-lifecycle (#4), worker-kill fatal (#5) — all
  browser legs on dev.
- Memory/instance measurements and riscv-tests green in the worker configuration — browser runner on
  dev.

## Verification log — 2026-08-07 (pragmatic first cut: CPU-on-worker via postMessage)

Ahead of the full shared-guest-RAM design, landed a **pragmatic CPU-on-worker path** that reuses the
entire verified `startLinuxBoot` stack (chunked disk + snapshot restore + node-alpine + IndexedDB
overlay) inside a dedicated Web Worker, bridging console/input over `postMessage`. This gets the dispatch
loop off the main thread — the measured cause of slow in-browser Node (native interp does `node -e` in
~3s; browser was 100-200s from the main-thread setTimeout/paint throttle, NOT the interpreter). No
SharedArrayBuffer / COOP-COEP required for this path.

- `web/linux-worker.js` + `web/linux-worker-host.js`: `startLinuxBootWorker(opts)` is a drop-in for
  `startLinuxBoot` (same callback/controller contract); JS-Proxy controller forwards any method as async
  RPC; `whenDone` bridged as a real thenable; output batched into transferable buffers. `web/main.js`
  routes through it when `?worker=1` (opt-in; main-thread stays default). `window.__linuxCtl` test hook.
- **[✓] Live-verified (Playwright, https://wasm-vm.pages.dev/?worker=1):** busybox restores in **0.69s
  INSIDE THE WORKER**, clean prompt, zero errors; `echo WORKER_OK_$((21+21))` → **WORKER_OK_42** — the
  full input→worker→guest→output→xterm round-trip works. loader.js was already worker-safe (guards all
  `window`/`document`).
- **verification-debt:** node-alpine-in-worker OOMs headless Chrome (101 MB snapshot + 256 MB guest RAM
  peak) → the node-speed **worker-vs-main** measurement needs a real browser / `dev`. The full SAB
  shared-guest-RAM design (zero-copy main-thread reads for the IDE/framebuffer) remains the follow-on;
  this cut delivers the off-main-thread execution + interactive I/O that fast Node needs first.
