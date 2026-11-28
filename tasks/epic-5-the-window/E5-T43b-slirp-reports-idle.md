---
id: E5-T43b
epic: 5
title: Paced idle with networking on — the slirp backend reports when it is idle
priority: 0.387661
status: pending
depends_on: []
estimate: S
risk: high
capstone: false
---

## Why this exists

E5-T37c item 1: a network backend that does not answer `NetBackend::idle` keeps the quiescence
marker unset, so no idle wait is reported and the paced clock never lets the worker sleep.
`SlirpLocalBackend` and `SharedSlirpBackend` are such backends. Turning networking on for the
Replay desktop (E5-T43d) would take its idle worker time from about 1.2 % back to nearly 100 %.

## Boundary

`crates/slirp` (and the core's net seam if needed): the slirp backends report idle exactly when
no frame is queued for the guest, no timer of the stack is due before the wait would end, and no
outbound transport has data or a pending event; the next deadline bounds the wait. No other
device changes.

## Deterministic acceptance

- Core/slirp tests: idle is reported with an empty, quiet stack; not reported with a queued
  frame, a due DHCP/ARP/TCP timer, or pending relay data; a reported wait never passes a stack
  deadline; the existing paced-idle tests (E5-T37a) pass.
- Browser, committed bundle, Replay desktop with `slirpNet` on (offline provider is enough):
  idle worker time in run slices within 2 points of the networking-off figure.

## Adversarial verification

High risk (guest timing). Attack list: a TCP retransmit timer due during a long idle wait; DHCP
renewal; relay data arriving while the worker sleeps (it must wake); a guest polling the NIC.

## Verification log
