---
id: E4-T22e
epic: 4
title: Threaded demo integration with controller and JIT fallback parity
priority: 422.5
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified

- **Backend selection and fallback parity — HELD.** Predicted a restored default boot would use the
  whole-machine worker, `?singlethread=1` would select the main-thread differential path, and the
  existing `?worker=0` override would remain a working fallback. The exact-head T22e Chromium run
  observed the worker and single-thread paths restoring the same paused guest digest and returning
  the same computed shell result (`E4T22E_ORACLE_42`, exit `0`); the focused T32 regression also
  booted `?worker=0` as `main-thread` with forced-off JIT.
- **Controller and snapshot semantics — HELD.** Predicted the two backends would expose matching
  persistence, read-only, file-transfer status, snapshot status, and overlay-seed identity without
  changing the paused restore boundary. The integration spec compared each result, exercised
  pause/resume around the shell command, and successfully saved a snapshot after the comparison.
  Transfer-byte ownership is unchanged by this routing-only diff and remains covered by the
  retained E4-T32 protocol/transfer proof.
- **JIT policy truthfulness — HELD.** Predicted `jit=0` would report `forced-off` with no executor,
  while an isolated `jit=1&jitThreshold=1` boot would report `enabled` with an attached translated
  executor. Both assertions held in local Chromium; the already-verified E4-T32 translated-block
  run remains the execution-level proof for actual JIT blocks.
- **Worker failure cleanup — HELD.** Predicted terminating the live worker would reject pending and
  future controller calls and clear guest readiness rather than leave a stale controller or active
  boot. The exact-head test observed two rejected promises, a bounded `heartbeat timed out` future
  rejection, `guestUp:false`, `boot.active:null`, and `guestReady:false`, with zero non-favicon
  console/page errors.
- **Coverage — HELD.** The changed startup-query branch in `web/main.js:13-26` executed through
  default worker, `?singlethread=1`, and `?worker=0` boots; the named Chromium project in
  `web/playwright.config.js:29-34` was exercised by the exact acceptance command; the new
  integration spec covered parity, snapshot, JIT admission, and worker termination; and the
  generated `web/dist/main.js` matched the source. No changed behavioral hunk is unexecuted.
- **SUITE:** retained the T22e integration spec, worker harness (`33/33` Node cases, placement
  audit OK, `5/5` bootstrap Chromium cases), focused `worker=0` regression, exact-head JSON, and
  screenshot. WebKit and independent-machine legs were not used per the user's explicit direction
  and current evidence policy.

Implementation commit: `74a2f4b`.

Evidence: `evidence/e4-t22e/cpu-worker-integration-2026-09-03.json` and
`evidence/e4-t22e/cpu-worker-integration-2026-09-03.png` (SHA-256
`ee6c53d30448c3456d973caf2f774a9c5b033a5ba4f046ad95fda3a330008a61`).

Commands: `node --check web/main.js web/playwright.config.js
web/tests/e4-t22-cpu-worker-integration.spec.js`; `make web-dist`; the exact T22e acceptance
command (`2/2` Chromium tests); `make web-test-cpu-worker` (`33/33` Node tests, placement audit
OK, `5/5` Chromium tests); and the focused T32 `worker=0` regression (`1/1`). The pre-existing
artifact manifests were restored untouched after the dist build. Host-layer rr, WebKit, and
independent-machine checks were not required for this browser/guest-layer proof.
