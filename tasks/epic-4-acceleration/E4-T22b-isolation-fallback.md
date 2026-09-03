---
id: E4-T22b
epic: 4
title: COOP/COEP isolation gate and static-host fallback
priority: 422.2
status: in-progress
depends_on: [E4-T22a]
estimate: S
risk: high
capstone: false
---

## Goal

Select the threaded shared-memory backend only after a complete cross-origin-isolation capability
probe, and make every headerless/static-host case fall back cleanly to the single-threaded build.

## Context

The backend decision must happen before wasm instantiation. Dev-server COOP/COEP headers, the
service-worker header-injection shim, the `?singlethread=1` override, and a warning on fallback are
one policy boundary: no half-initialized worker or JIT may survive a failed isolation check.

## Deliverables

- Pure `selectCpuBackend`/`probeIsolation` logic with explicit reasons and a fail-closed fallback.
- Dev-server and production/static-host COOP/COEP documentation and the second-load service-worker
  shim path.
- Node tests for all missing-capability and forced-fallback cases.

## Acceptance criteria

- `node --test web/tests/cpu-isolation.test.mjs` passes with the isolated case selecting
  `worker-shared`, every missing capability selecting `single-thread`, and exactly one warning on
  fallback.
- The served-page check shows COOP/COEP and `crossOriginIsolated === true`; a headerless page never
  instantiates the shared module and visibly reports the fallback reason.
- `?singlethread=1` wins over a fully capable isolated environment without changing guest behavior.

## Adversarial verification

Strip both headers, remove `SharedArrayBuffer`, remove `Atomics`, remove `Worker`, and force a
second-load service-worker path. Any white screen, late fallback after partial initialization, or
silent JIT admission is a refutation.

## Verification log
