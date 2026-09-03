---
id: E4-T22c
epic: 4
title: Atomic WFI wake and interim MMIO control block
priority: 422.3
status: pending
depends_on: [E4-T22b]
estimate: S
risk: high
capstone: false
---

## Goal

Provide a bounded SharedArrayBuffer control block that lets a parked CPU worker wake on an IRQ and
complete the interim synchronous MMIO request/response path without lost notifications or torn
64-bit values.

## Context

The control block is separate from guest RAM so its cells remain stable while the wasm memory grows.
The IRQ counter must be monotonic, and device-buffer writes must happen-before the atomic wake. The
MMIO stub is temporary until E4-T23's device proxy, but it must be correct enough for worker boot.

## Deliverables

- `createControlBlock`/`attachControlBlock`, lifecycle cells, monotonic IRQ raise/wake, and WFI park.
- Sequence-tagged MMIO request/response cells carrying address, width, write bit, and 64-bit value.
- Deterministic tests covering visibility, spurious wake loops, response matching, and full-width
  values.

## Acceptance criteria

- `node --test web/tests/cpu-control-block.test.mjs` passes and proves FIFO request identity,
  monotonic IRQ counts, shared-buffer visibility, and a lossless `0xdead_beef_0000_0042` round trip.
- A worker-side wait wakes after an IRQ raised before or during park, and an MMIO waiter cannot
  consume a response belonging to another request.
- Stores before `raiseIrq` are observed after the worker's atomic load/wake boundary.

## Adversarial verification

Race `raiseIrq` against the park boundary, inject spurious wakeups, wrap the request counter, and
flood a request with the largest supported width. A missed wake, torn value, or stale response is a
failure.

## Verification log
