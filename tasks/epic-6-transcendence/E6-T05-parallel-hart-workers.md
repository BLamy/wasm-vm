---
id: E6-T05
epic: 6
title: True parallel harts — one worker per hart over SharedArrayBuffer RAM
priority: 605
status: pending
depends_on: [E6-T03, E6-T04]
estimate: L
capstone: false
---

## Goal
Each hart executes on its own dedicated Web Worker against guest RAM in shared wasm
memory (SharedArrayBuffer), following the E6-T04 mapping — Linux SMP boots with harts
genuinely running in parallel, with a clean automatic fallback to the E6-T03 round-robin
scheduler when the page is not crossOriginIsolated.

## Context
Epic 4 already moved execution off the main thread; this task multiplies it. Design
points: the wasm module is built with `+atomics,+bulk-memory` and shared memory; one
module compile, N instantiations (one per hart worker) over the same memory. Requires
COOP/COEP (`crossOriginIsolated === true`) — the embedding story (E6-T19) inherits this
constraint. Device model stays on the existing device worker: hart-initiated MMIO becomes
a synchronous RPC over a per-hart SAB mailbox (`Atomics.wait` on the reply slot), except
hot CLINT paths (mtime read, msip write) which are serviced directly from shared state.
WFI parks the worker in `Atomics.wait` on a per-hart doorbell; CLINT/PLIC/IPI writes
`Atomics.notify` the target. mtime needs one coherent source: a shared atomic counter
advanced by the device worker's timer, not per-worker `performance.now()`.

## Deliverables
- `hart_worker.rs`/JS shim: per-hart worker lifecycle (spawn on HSM start, park on stop),
  panic propagation to the main thread with hartid attribution.
- MMIO mailbox protocol (request word layout, doorbell, timeout diagnostics) documented
  in `docs/smp-runtime.md`; CLINT fast paths in shared memory.
- WFI park/wake via Atomics.wait/notify; no busy-spin harts at idle (verify CPU% ~0 on an
  idle booted system).
- Capability detection + fallback: `!crossOriginIsolated` or `n_harts==1` selects
  round-robin transparently; the machine config reports which engine is active.
- Guest RAM accessors per the E6-T04 decision (atomic ops via raw pointers; no `&mut`
  aliasing over shared RAM anywhere — enforced by an accessor-module boundary).

## Acceptance criteria
- [ ] Alpine boots with smp=4, all four harts on separate workers; `stress-ng --cpu 4
      -t 60s` shows ≥3x aggregate bogo-ops vs smp=1 on a ≥8-core host.
- [ ] Idle booted system: all hart workers parked in Atomics.wait; host CPU usage of the
      tab < 5% (measured via Chrome task manager, documented).
- [ ] Full riscv-tests + Linux boot pass under the parallel engine with smp=1 (parity
      with round-robin) and smp=4.
- [ ] Serving the page without COEP boots via fallback with a console warning, same
      guest-visible behavior at smp=1.
- [ ] 30-minute `stress-ng --cpu 4 --vm 2` soak: no worker panic, no kernel oops.

## Adversarial verification
Attack the mailbox: flood MMIO from all four harts simultaneously (guest program hammering
the UART data register from four pinned threads) and look for lost replies, interleaved
reply corruption, or deadlock between MMIO-wait and WFI-wait on the same futex word. Kill
one hart worker via devtools mid-boot — the machine must surface a fatal, attributed error
rather than hang silently. Attack time: read mtime from four harts in a tight loop and
check monotonicity per hart and cross-hart (a backwards mtime refutes). Suspend/resume the
laptop (or throttle the tab) during a soak — timer storms or a stuck Atomics.wait refute.
Run the E6-T04 litmus suite under this engine on 2 browsers; any forbidden outcome
refutes. Verify the fallback path by diffing boot dmesg between engines at smp=1.

## Verification log
(empty)
