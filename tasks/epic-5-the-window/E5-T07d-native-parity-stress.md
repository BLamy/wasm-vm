---
id: E5-T07d
epic: 5
title: Native fbcon parity and first-light stress proof
priority: 507.4
status: in-progress
depends_on: [E5-T07c]
estimate: S
risk: high
capstone: false
---

## Goal

Close the first-light integration with a native null-sink parity check and bounded scroll, VT, and
reload stress against the browser trace fixture.

## Boundary

This slice owns comparative evidence and stress hardening for the already-integrated path. It does
not add new display features or broaden the acceptance to independent machines or WebKit.

## Deliverables

- A native headless capture using the identical kernel/rootfs and the null sink.
- A normalized native/browser probe comparison plus the final resource/queue health report.
- A bounded stress verifier for rapid fbcon scroll, VT switching, and tab-reload/re-probe cleanup.

## Acceptance criteria

- Native and browser traces agree on probe order and framebuffer dimensions modulo timestamps and
  explicitly documented host-only fields.
- One million-byte console scroll and 100 VT switches complete without a controlq deadlock, resource
  leak, row corruption, or duplicate callback.
- A reload after an interrupted run starts from a clean device state and the native null sink still
  reaches the same terminal probe boundary.

## Verification command

`make verify-E5-T07d`

## Adversarial verification

Repeat the stress harness with independent seeds and a forced queue delay at each flush. Compare the
final screenshot/readback against the reference renderer and reject any unexplained divergence from
the T07a fixture.

## Verification log

(empty)
