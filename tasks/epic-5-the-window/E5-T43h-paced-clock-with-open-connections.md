---
id: E5-T43h
epic: 5
title: Paced clock keeps real time while the guest waits with a network connection open
priority: 0.3876634
status: pending
depends_on: [E5-T43f]
estimate: S
risk: high
capstone: false
---

## Boundary

`crates/core/src/lib.rs` `after_wfi_retire`: the WFI fast-forward is skipped whenever a network flow
has I/O in flight outside the guest (`external_net_io_pending`). That guard was written for the
instruction-count clock, where the jump is instantaneous in host time and a socket timeout could fire
before the browser delivers the WebSocket data. Under the paced clock the jump is already limited to
the host's real time (`limit_deadline_after`), so the guard is not needed there; without the jump an
idle guest's time follows its retire count, about 25 times slower than real time.

Found in E5-T43f (`evidence/e5-t43f/probe-timing.json`): on the online Replay desktop,
`node -e 'require("https").get("https://example.com", …)'` printed 200 and then took 16.2 guest seconds
(0.55 s of CPU) and 405 host seconds to exit (the keep-alive socket's timers ran 25 times slow);
a typed `node` fetch answered 92 s after typing began.

## Deterministic acceptance

- With the paced clock and a network flow open, an idle guest's `mtime` follows the host clock (core
  test with a fake monotonic clock and a backend reporting external I/O); with the instruction-count
  clock the guard still holds (existing tests).
- Browser, online Replay desktop: the `https.get` above exits within 2x its guest time in host time
  (was 25x); a typed `node` fetch answers within 30 s of typing ending; idle worker time with networking
  on and no connection still within 2 points of E5-T43f's.

## Adversarial verification

High risk (guest time semantics). Attack list: a socket timeout firing before the relay's data arrives
under the paced clock (a slow relay); keyboard and GPU pending guards unchanged; the instruction-count
and recording clocks unchanged (determinism evidence); the worker's CPU while a connection is open and
the guest idle.

## Verification log
