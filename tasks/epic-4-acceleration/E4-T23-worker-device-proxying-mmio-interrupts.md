---
id: E4-T23
epic: 4
title: Main-thread and worker device proxying — MMIO round trips and interrupt injection
priority: 423
status: pending
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

## Verification log
(empty)
