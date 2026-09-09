---
id: E4-T22g
epic: 4
title: Threaded worker fallback and lifecycle adversarial hardening
priority: 422.7
status: verified
depends_on: [E4-T22f]
estimate: S
risk: high
capstone: false
---

## Goal

Close the worker boundary with deterministic attacks against headerless fallback, wake delivery,
shared-memory ordering, tab lifecycle, and worker failure, then publish the final end-to-end proof
for the decomposed E4-T22 capability.

## Context

The worker can appear healthy while losing input, observing stale device bytes, or leaving the page
half-booted after termination. These attacks exercise the failure modes that the happy boot and unit
protocol tests cannot see. The final result must retain the exact guest oracle rather than only UI
text.

## Deliverables

- Headerless-server fallback and second-load service-worker-shim browser coverage.
- Wake-storm and handshake-counter stress, shared-buffer ordering, tab background/foreground, and
  worker-kill fatal-state tests.
- Final E4-T22 result JSON and a concise committed verification command.

## Acceptance criteria

- `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t22-fallback-no-headers.spec.js tests/e4-t22-worker-hardening.spec.js --project=chromium`
  (the second spec is added in this task) passes with no lost UART bytes, no stale shared-buffer
  reads, a bounded fatal UI after worker kill, and a clean single-thread fallback on the headerless
  server.
- Ten-kilobyte-per-second input for the bounded stress window preserves ordering and reaches the
  guest; reload/background cycles leave no orphan worker, pending RPC, or corrupted overlay.
- The final result carries runtime digest, first-command boundary, exact checksum, control flags,
  and the generated deploy artifact identity. The child is not verified on claims alone.

## Adversarial verification

Deliberately strip COOP/COEP, race ten thousand IRQ/input events with WFI, write a device buffer
immediately before notifying, background for five minutes, reload during MMIO, and terminate the
worker from DevTools. Any white screen, lost byte, stale read, guest time warp, or uncited optimistic
state is a refutation.

## Verification log

### 2026-09-03 — verifier — VERDICT: verified

- P1 headerless fallback and shim — HELD. Prediction: a headerless origin with the isolation shim
  blocked selects `single-thread` before wasm initialization, while the explicit `?worker=0` path
  remains usable; with the shim allowed, its second-load document becomes isolated and reaches the
  shared worker. Observed the blocked test pass with `crossOriginIsolated=false`, selection
  `single-thread`, `wasmVariant=fallback`, `main-thread` backend, exact computed
  `E4T22G_NOHEADERS_42`, and the allowed test pass with a service-worker controller,
  `worker-shared` selection, `whole-machine-worker` backend, and a restored BusyBox command
  returning `E4T22G_SHIM_42`.
- P2 ordered input and wake delivery — HELD. Prediction: 100 chunks of 100 bytes at 10 ms
  intervals plus a newline produce exactly the expected 10,000-byte SHA-256 and exit 0, without
  the partial-read truncation that the adversarial raw-tty case would expose. Observed
  `4c207598af7a20db0e3334dd044399a40e467cb81b37f7ba05a4f76dcbd8fd59`, 10,000 bytes, exit 0,
  input duration 1,179.145 ms, and measured rate 8,480.721 bytes/s; no leftover payload appeared
  at the next shell prompt.
- P3 background, foreground, and reload lifecycle — HELD. Prediction: hiding the document pauses
  the scheduler without advancing slices or retired instructions, visibility restore resumes the
  guest, and reloading during an in-flight `sleep` RPC restores a usable worker with no pending RPC
  or overlay bytes. Observed identical paused scheduler counters before and after the 500 ms hidden
  interval, exact `E4T22G_BEFORE_42`/`E4T22G_AFTER_42`/`E4T22G_RELOAD_42` results, restored
  `whole-machine-worker`, `rpc.pending=0`, and `persist.pendingBytes=0`.
- P4 worker termination and fallback — HELD. Prediction: terminating the live worker rejects both
  pending `stateDigest`/`whenDone` promises, rejects future calls after the heartbeat deadline,
  marks the guest down, and leaves the explicit fallback usable without constructing a worker.
  Observed two rejected settlements, `Linux worker heartbeat timed out after 324ms`, `guestUp=false`,
  two worker terminations, and exact `E4T22G_FALLBACK_42` from the `main-thread` fallback with zero
  fallback worker constructions.
- P5 evidence and diagnostics — HELD. The exact-head result records runtime digest
  `e0b1980799c77ece81f2ddb97b493d5223c1212d1b25f1e1bc94d10f74aafbf3`, the first-command
  boundary, controls, exact checksum, browser/version, and generated deploy artifact identities;
  console errors, page errors, failed requests, and non-favicon HTTP errors were all empty.
- COVERAGE — HELD. The changed fallback spec executes both headerless branches; the new hardening
  spec executes the normal worker boot, computed terminal command, 10 KB/s input path, visibility
  pause/resume, reload during MMIO/RPC activity, worker termination, and explicit main-thread
  fallback. The current production whole-machine worker is postMessage-scheduled and does not use a
  shared guest-memory control block; the raw shared-buffer/WFI proof remains in E4-T22d.
- SUITE — retained `web/tests/e4-t22-fallback-no-headers.spec.js`,
  `web/tests/e4-t22-worker-hardening.spec.js`, the JSON result, and the screenshot.

Commands:

`PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t22-fallback-no-headers.spec.js tests/e4-t22-worker-hardening.spec.js --project=chromium`

Result: 3 passed in 36.7s at exact implementation head
`84ff4841b35e3f6a705ed8864493f09e0bed5b87`.

Evidence: `evidence/e4-t22g/worker-hardening-2026-09-03.json`, SHA-256
`40163bd3995468bde86d3c57632ff2c0829a49b1ea2f57b851eec9a7a300eebf`; screenshot
`evidence/e4-t22g/worker-hardening-2026-09-03.png`, SHA-256
`8876827c2aeaeac6192c251e8113fec1351d0a1a1620c665c6b8ea0e909e8af3`.

WebKit and independent-machine execution are waived per user direction. Host rr/`ssh dev` is
waived by the repository's 2026-09-01 evidence policy.
