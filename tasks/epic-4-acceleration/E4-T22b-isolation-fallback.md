---
id: E4-T22b
epic: 4
title: COOP/COEP isolation gate and static-host fallback
priority: 422.2
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified

- **Isolation ordering — HELD.** Predicted the served HTML would establish the isolation decision
  before `main.js` evaluated backend or wasm imports. The local COOP/COEP response carried
  `same-origin` and `require-corp`; Chromium observed `crossOriginIsolated=true`,
  `__cpuBackendSelection.backend="worker-shared"`, `wasmVariant="shared"`, and the matching
  document dataset. The page produced zero non-favicon console errors.
- **Fail-closed fallback — HELD.** Predicted a headerless page without a usable shim would not hang
  or partially initialize. The first adversarial run exposed an unsettled
  `navigator.serviceWorker.ready` promise; the 5-second bounded wait was added, and the final
  headerless run with service workers blocked selected `single-thread`/`fallback` in `5.3s` with
  no console errors.
- **Static-host shim — HELD.** Predicted a headerless page with the shim enabled would reload once,
  become controlled, and then select `worker-shared`. The final Chromium leg observed
  `crossOriginIsolated=true`, an active service-worker controller, and the shared backend on the
  second load. The three-leg spec passed `3/3`; the pure selector suite passed `16/16`.
- **Coverage — HELD.** The changed registration timeout, HTML bootstrap ordering, fallback decision,
  browser spec, generated `app.html`/service-worker bundle, and diagnostics all executed in the
  focused browser run or are generated/declarative wiring. The committed screenshot records the
  headerful selection surface.
- **SUITE:** promoted `web/tests/e4-t22b-isolation-fallback.spec.js`, the existing pure selector
  tests, and the JSON/screenshot capture as the repeatable isolation proof. WebKit and
  independent-machine legs were not used per the user's explicit direction.

Implementation commit: `177039e`.

Evidence: `evidence/e4-t22b/isolation-fallback-2026-09-03.json` (SHA-256
`454dd386b70e6fc1c3776630cfed90bf96dc1d1558e8f422c69507c4853f6035`) and
`evidence/e4-t22b/isolation-selection.png` (SHA-256
`f634226c16ef61fc25c6625ce65ddf949f630c33ed4e6956a56a11b56f2a8340`).

Commands: `node --test web/tests/cpu-isolation.test.mjs` (`16 passed`); the exact three-leg
Chromium command recorded in the JSON (`3 passed`); `node --check` on the changed JavaScript;
`make web-dist`; `python3 tools/check_task_policy.py`; and `python3 tools/build_queue.py`. The broad
workspace all-features clippy wall remains outside this slice and retains the pre-existing macOS
`wvseccomp` libc API failure.
