---
id: E4-T22c
epic: 4
title: Atomic WFI wake and interim MMIO control block
priority: 422.3
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified

- **WFI wake and ordering — HELD.** Predicted a worker blocked in `Atomics.wait` would observe a
  value written before `raiseIrq`, and would not lose a notification at the park boundary. The
  worker-thread test woke with IRQ `1` and observed `0x12345678`; a deliberate notify without an
  IRQ increment was ignored by the recheck loop, then the real wake completed after exactly two
  wakeups with `0x55667788`.
- **MMIO protocol — HELD.** Predicted sequential worker requests would retain their request tags,
  address/width/write fields, and a full-width response. The worker issued request `1` at
  `0x100000004` (8-byte load) and request `2` at `0x100000010` (4-byte store); the main-thread
  responder returned `0xdeadbeef00000042`, and no request remained pending.
- **Adversarial suite — HELD.** Predicted the existing device/ring isolation checks would remain
  green alongside the blocking worker cases. `make web-test-cpu-worker` passed `33/33`, including
  ring overflow/backpressure, interleaved UART/block correlation, zero CLINT crossings, interrupt
  injection, placement audit, the new visibility/spurious-wake tests, and the MMIO round trip.
- **Coverage — HELD.** The new worker helper and control-block tests execute the blocking waits,
  atomic visibility, spurious-wake loop, sequential request matching, and 64-bit encoding paths;
  no production source was changed in this slice.
- **SUITE:** promoted the worker-thread test cases and the deterministic control-block JSON as the
  durable proof. rr, independent machines, and WebKit were not used per the user's explicit
  direction/current evidence policy.

Implementation commit: `d029615`.

Evidence: `evidence/e4-t22c/control-block-2026-09-03.json` (SHA-256
`8a3ebc6941671824177098fe013dfe9eea6f6536c1804ddc6fa75fba118afbd3`).

Commands: `make web-test-cpu-worker` (`33 passed`); `node --test
web/tests/cpu-control-block.test.mjs` (`8 passed`); `node --check` on the helper/test modules;
`python3 tools/check_task_policy.py`; and `python3 tools/build_queue.py`.
