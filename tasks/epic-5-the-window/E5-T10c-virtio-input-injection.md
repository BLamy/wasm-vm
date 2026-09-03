---
id: E5-T10c
epic: 5
title: virtio-input injection and frame-integrity buffering
priority: 510.3
status: pending
depends_on: [E5-T10b]
estimate: S
risk: high
capstone: false
---

## Goal

Finish the input chassis host API with synchronous frame emission, bounded pending events, and a
drop-oldest-full-frame policy that cannot strand a key-down without its matching key-up.

## Deliverables

- `inject_event(type, code, value)` and `sync()` with automatic EV_SYN/SYN_REPORT framing.
- A default-256 pending-event budget, whole-frame drop accounting, and non-blocking behavior when
  the guest has not posted eventq buffers.
- Deterministic native and wasm32 integration fixtures covering slow draining, key bursts, and
  queue recovery.

## Acceptance criteria

- 1000 injected events with a slowly draining guest never blocks the VM loop, drops only complete
  EV_SYN-delimited frames, and reports an accurate counter.
- Key down/up bursts delivered through eventq preserve frame boundaries; a dropped frame drops
  both sides of a key transition.
- `inject_event` and `sync` produce identical 8-byte little-endian event streams on native and
  wasm32, and statusq callback behavior remains intact.

## Adversarial verification

Force the drop path with a three-buffer eventq, alternate key-down/up bursts, drain after each
wrap, and machine-check the stream invariant that every key frame terminates in SYN_REPORT and
no delivered key-down lacks its eventual up or a whole-frame drop. Vary the buffer budget and
confirm the VM loop remains non-blocking.

## Verification log

(empty)
