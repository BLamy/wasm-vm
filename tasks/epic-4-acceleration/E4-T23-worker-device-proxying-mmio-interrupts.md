---
id: E4-T23
epic: 4
title: Main-thread and worker device proxying — MMIO round trips and interrupt injection
priority: 423
status: partially-verified
depends_on: [E4-T22]
estimate: L
capstone: false
---

## Goal
The interim blocking MMIO stub becomes a real split-device architecture with measured
latency budgets: device state is partitioned between the CPU worker (everything without a
DOM/main-thread dependency: CLINT, PLIC, virtio ring processing) and the main thread
(xterm.js UART endpoint, IndexedDB/network backends), with SAB ring-buffer proxying for
cross-thread MMIO, interrupt injection via shared pending-IRQ cells + `Atomics.notify`,
and `Atomics.waitAsync` (not busy-wait, not blocking) on the main-thread side.

## Context
Every MMIO round trip is a potential 100 µs+ stall of guest execution, so the design
minimizes *crossings*, not just crossing cost: CLINT/PLIC move wholly into the worker
(timer reads are the hottest MMIO in Linux — they must never cross threads); virtio
rings live in guest RAM (already shared), so the worker processes ring bookkeeping
locally and only crosses for actual backend I/O (fetch, IndexedDB, OPFS — note OPFS
SyncAccessHandle is *worker-only*, an argument for a dedicated I/O worker reachable
without main-thread hops; decide and document). Crossing mechanics: lock-free SPSC rings
in the SAB; worker→main wake via `Atomics.notify` + `waitAsync`; synchronous-read MMIO
(rare: e.g. UART LSR) uses worker-side `Atomics.wait` on a response cell with a deadline.
Interrupt injection: backend completion sets the device's pending bit in an atomic cell
(PLIC state itself is worker-side), then `Atomics.notify` the WFI cell.

## Deliverables
- Device placement matrix in `docs/worker-devices.md` (what runs where, and why —
  including the OPFS/IO-worker decision) + the implementation matching it.
- SPSC SAB rings (fixed-slot, cache-line-padded) for MMIO requests/responses and
  device→CPU interrupt signals; `Atomics.waitAsync` main-thread consumer.
- CLINT + PLIC fully worker-local; virtio ring processing worker-local with backend
  crossings only for real I/O.
- Latency instrumentation: per-crossing-type histograms (UART tx, blk request submit→
  interrupt, net) in ProfStats.
- Budgets recorded and enforced as tests: UART character round-trip p50 < 100 µs worker-
  local path; virtio-blk 4 KiB read submit→completion-interrupt p50 < 2 ms (IndexedDB
  path), keystroke→guest-visible < 5 ms.

## Acceptance criteria
- [ ] Alpine boots to login on the split architecture; `dd if=/dev/vda` throughput ≥ 90%
      of the pre-worker (E3) figure; interactive typing shows no perceptible change
      (scripted echo-latency comparison committed).
- [ ] Timer MMIO (CLINT mtime reads) generates zero thread crossings (counter-verified
      over a boot).
- [ ] All budget tests above pass in Chrome and Firefox CI.
- [ ] No busy-waiting: main thread shows < 1% CPU with an idle guest (profiler evidence);
      worker parks correctly (E4-T22 behavior preserved).
- [ ] Interrupt injection under JIT: a blk completion arriving mid-chained-hot-loop is
      delivered within the E4-T18 budget (directed test).

## Adversarial verification
Refute with races and floods. Attack angles: (1) ring overflow — flood UART output
(`yes` piped to console) and blk requests simultaneously until rings fill; lost MMIO,
responses matched to wrong requests, or deadlock refutes (slots must carry sequence tags
— check them); (2) interrupt-loss hunt: fire 10k blk completions with randomized timing
against a guest alternating WFI/poll; any undelivered completion (guest stall > timeout)
refutes; (3) teardown race: reload the page mid-I/O 50 times — a wedged worker, orphaned
waitAsync, or corrupted persistent disk (cross-check Epic 3 overlay integrity) refutes;
(4) sync-read deadline: jank the main thread (synthetic 200 ms loop) and verify worker-
side synchronous MMIO reads hit their deadline fallback rather than stalling the guest;
(5) placement audit: grep device code for main-thread-only APIs (DOM/IndexedDB) reachable
from worker-side classes — a hidden dependency refutes the architecture doc.

## Status
partially-verified

## Verification debt (browser / `dev` box — macOS OS-reaps the cross-thread boot)
- **AC1** — Alpine boots to login on the split arch; `dd if=/dev/vda` ≥ 90% of the E3 figure;
  interactive typing echo. Spec: `web/tests/e4-t23-device-proxy.spec.js` (`AC1:` tests). NOT run
  here; no numbers fabricated.
- **AC3** — Chrome+Firefox budget tests (UART p50 < 100µs / blk p50 < 2ms / keystroke < 5ms) read
  from the live ProfStats histograms. Spec: same file, `AC3:` test.
- **AC4** — main <1% CPU idle / no busy-wait (`Atomics.waitAsync` parks). Spec: `AC4:` test.
- **Adversarials #2 / #3 / #4** — 10k-completion interrupt-loss flood; 50× teardown-race reload +
  overlay integrity; janked-main sync-read deadline fallback. Specs committed (`adversarial #2/#3/#4`
  tests) to drop in on `dev`.

## Verification log

### 2026-08-06 — headless gates VERIFIED on this macOS host

- **SPSC ring protocol + sequence tags + adversarial #1 flood (node)** — `make web-test-cpu-worker`
  → 25 tests pass across `cpu-isolation` + `cpu-control-block` + new `device-proxy.test.mjs`. The
  ring tests prove: FIFO order across full wraps, 64-bit payload round-trip, sequence-tagged slots,
  and the flood-to-full adversarial (ring accepts exactly `capacity`, every refused push is COUNTED
  as overflow — no silent drop, no wrong-request match, backpressure releases on drain → no
  deadlock). Interleaved UART+blk flood stays per-stream correlated with zero loss.
- **AC2 zero-crossing CLINT (node property/counter)** — `device-proxy.test.mjs`: 100k simulated
  CLINT mtime reads through `WorkerDeviceRouter.mmio()` yield `router.crossings === 0` and an empty
  request ring — timer MMIO is worker-local by construction.
- **AC5 interrupt-injection-under-JIT (native directed)** — `cargo test -p wasm-vm-jit-runtime
  --test chaining` → 5/5 pass incl. new `device_completion_fires_inside_chained_loop`: a virtio-blk
  PLIC completion injected against a HOT, chained loop is delivered within the chain budget (loop
  advances ≤ 64 iters between injection and delivery; the handler runs; dispatch is re-entered).
  This EXPOSED AND FIXED a real gap: the E4-T18 chain per-link boundary poll re-mirrored only the
  CLINT timer (`sync_clint`), NOT the PLIC — so a device IRQ was delayed ~30 000 iterations until
  the chain exhausted its depth budget. Fix: added `sync_plic()` to the chain poll in
  `crates/core/src/lib.rs#try_jit_block`. The existing timer variant `interrupt_fires_inside_chained_loop`
  still passes (no regression).
- **Adversarial #5 placement audit (static, wired to CI)** — `node tools/worker-device-audit.mjs`
  → "placement audit OK: 3 worker-side files clean". Self-verified: injecting `document.title` into a
  worker-side file makes it exit 1 with the offending line. Wired into `make web-test-cpu-worker`.
- **Commit gates** — `cargo fmt --check` clean on core + jit-runtime; wasm32 no_std core build +
  clippy: see the run outputs in the task report.

### Files
- `web/device-proxy.js` — SPSC rings (cache-line-padded, sequence-tagged), `classify()` placement,
  `WorkerDeviceRouter` (worker-local dispatch + crossing counter), `MainDeviceServer` (waitAsync
  consumer + interrupt injection), `LatencyStats` (per-crossing histograms / ProfStats analog).
- `web/tests/device-proxy.test.mjs` — headless SPSC/classification/AC2/injection tests.
- `tools/worker-device-audit.mjs` — adversarial #5 placement audit (CI).
- `docs/worker-devices.md` — placement matrix + OPFS I/O-worker decision + protocol.
- `crates/core/src/lib.rs` — `sync_plic()` added to the E4-T18 chain boundary poll.
- `crates/jit-runtime/tests/chaining.rs` — AC5 `device_completion_fires_inside_chained_loop`.
- `web/tests/e4-t23-device-proxy.spec.js` — deferred browser legs (AC1/AC3/AC4 + adversarials #2-4).
- `Makefile` — `web-test-cpu-worker` runs the new node suite + placement audit.
