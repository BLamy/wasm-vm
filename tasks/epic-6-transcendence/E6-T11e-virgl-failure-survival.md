---
id: E6-T11e
epic: 6
title: Survive hostile guest 3D requests and browser graphics context loss
priority: 525.02705
status: pending
depends_on: [E6-T11d]
estimate: S
risk: high
capstone: false
---

## Boundary

Close fail-closed behavior across the now-live device, renderer and asynchronous
completion boundary. Malformed guest commands return specified ERR_* responses;
renderer/context loss completes or explicitly fails pending work and falls back
to 2D scanout or surfaces a recoverable error. Implement the contract's reset,
snapshot and generation invalidation policy without persisting raw WebGL handles.
Never leave the control queue or compositor permanently waiting on a lost GPU.

## Deterministic acceptance

`make verify-E6-T11e` records a reproducible combined 10^6-case fuzz/property run
over SUBMIT_3D bodies, RAM scatter/gather lists and transfer extent/stride math,
with per-family counts, seeds, timeouts and no panic/OOB/hang. Include the native
transport fuzz targets and shared JS decoder rather than a mock-only substitute.
Run varied deterministic completion schedules, the 100-fenced-submit immediate
CTX_DESTROY attack and queued-transfer backing detach/duplicate attach/stale ID
attacks against the integrated path. Every accepted request gets one response.

In the actual built browser, lose the WebGL2 context mid-frame using
WEBGL_lose_context; prove pending fences resolve as success/error according to
the documented boundary, cursor/event-loop/2D progress continues, and reset or
restoration cannot resurrect stale objects. Record browser/guest traces, failure
and recovery screenshots, allocation counts and zero unexpected errors. Run
affected high-risk gates, final clean clone and relevant demo/deployment checks.

## Adversarial verification

Independently choose seeds and loss timing around upload, draw, readback and
scanout. Sabotage fence cancellation/generation checks and demand failure.
Unavailable context-loss injection is missing evidence, not a passed test.
Snapshot/reset rejection must be explicit and leave existing 2D behavior usable.

## Verification log

(empty)
