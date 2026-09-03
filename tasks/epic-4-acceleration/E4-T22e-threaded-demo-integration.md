---
id: E4-T22e
epic: 4
title: Threaded demo integration with controller and JIT fallback parity
priority: 422.5
status: in-progress
depends_on: [E4-T22d, E4-T23]
estimate: S
risk: high
capstone: false
---

## Goal

Expose the verified worker bootstrap through the demo's normal Linux boot/controller contract while
preserving the single-threaded fallback, device-proxy ownership, interpreter oracle, and explicit
JIT policy.

## Context

The page has several boot paths and controller consumers. A worker integration is only complete when
terminal input, persistence, snapshot/chunk accounting, interrupts, and diagnostics all identify
the same guest and when non-isolated pages remain usable. E4-T23 supplies the real device proxy;
this task wires it without duplicating device state.

## Deliverables

- Loader/main-page backend selection and worker controller integration.
- Explicit interpreter/JIT options and diagnostics in both threaded and fallback modes.
- Controller parity tests for boot, input, pause/resume, persistence, snapshot, and worker failure.

## Acceptance criteria

- `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t22-cpu-worker-integration.spec.js --project=chromium`
  (added in this task) passes on a restored local guest: the threaded path reaches the same shell
  oracle as `?singlethread=1`, and the selected JIT tier reports translated execution only when
  isolation permits it.
- Every controller method returns the same semantic result in worker and fallback modes, and no
  transfer leaves a detached buffer or stale generation visible to the UI.
- The page records zero non-favicon console errors in both modes.

## Adversarial verification

Toggle `?singlethread=1`, `?jit=0`, and `?worker=0` around a restored boot; upload/download bytes;
pause during an MMIO completion; and kill the worker. Any optimistic UI state, wrong guest digest,
or late JIT attachment refutes the integration.

## Verification log
