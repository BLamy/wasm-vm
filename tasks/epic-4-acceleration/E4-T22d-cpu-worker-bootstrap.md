---
id: E4-T22d
epic: 4
title: Imported-memory CPU worker bootstrap and sliced dispatch
priority: 422.4
status: verified
depends_on: [E4-T22c]
estimate: S
risk: high
capstone: false
---

## Goal

Boot the interpreter/JIT dispatch loop on a dedicated module worker using the imported shared wasm
memory and control block, with an explicit ready/halted/fatal handshake and bounded slices that can
park for WFI.

## Context

`cpu-worker.js` and `cpu-worker-host.js` currently describe the intended seam, but the raw shared
module, generated glue, and dispatch export must agree on one instance and one memory. This task
closes that ABI boundary without pulling DOM or device ownership into the worker.

## Deliverables

- Worker bootstrap accepting a cloned module or URL, importing the caller's shared memory, and
  returning a typed ready/fatal result.
- `run_slice`/equivalent bounded dispatch export, halt propagation, WFI park, and clean terminate.
- A deterministic worker fixture/spec that proves the worker sees the same memory bytes as its host.

## Acceptance criteria

- `make web-test-cpu-worker` passes from a clean checkout, including
  `web/tests/e4-t22d-worker-bootstrap.spec.js` in local Chromium. The spec covers boot handshake,
  shared-memory identity, one guest slice, WFI wake, halt, and worker error propagation.
- No DOM, xterm, IndexedDB, or main-thread-only API is reachable from the worker dispatch path.
- A missing dispatch export and a killed worker produce a bounded fatal result rather than a hung
  promise or a half-ready controller.

## Adversarial verification

Send a malformed boot message, a non-shareable memory, a duplicate boot, a spurious wake, and a
worker termination during a slice. Verify that the host observes one terminal state and never
continues using a stale instance.

## Verification log

### 2026-09-03 — verifier — VERDICT: verified

- **Imported-memory handshake — HELD.** Predicted the fresh Chromium worker would accept a cloned
  `WebAssembly.Module`, construct a shareable imported `env.memory` from the descriptor, and publish
  a versioned ready record before dispatch. The exact-head run observed `protocol:1`,
  `dispatchExport:"run_slice"`, `memoryShared:true`, one initial page, and `jit:false`; the fixture
  wrote `0x22` through the imported memory and the host read the same marker through
  `ready.memoryBuffer`.
- **Bounded slice/WFI lifecycle — HELD.** Predicted one slice would continue, a positive status would
  park in `Atomics.wait`, a notify without an IRQ would re-park rather than lose the state, and a
  monotonic IRQ would reach halt. The browser capture observed `parkedBefore:true`,
  `spuriousWakeCount:1`, `reparkedAfterSpuriousWake:true`, `halted:true`, and the terminal state
  returned to `BOOT`; the event sequence was exactly `["ready","halted"]`.
- **Fail-closed errors — HELD.** Predicted missing dispatch, malformed boot, non-shareable memory,
  reversed limits, duplicate boot, and a worker killed before ready would never leave a pending or
  half-ready controller. The focused Chromium spec observed `ready→fatal` for the missing export,
  one fatal for duplicate boot, fatal `STATE` for both memory attacks, fatal for malformed input, and
  the host rejected the killed-worker boot at the bounded 100 ms deadline.
- **Worker placement — HELD.** Predicted the worker dispatch path would remain free of DOM, xterm,
  IndexedDB, and other main-thread-only APIs. `node tools/worker-device-audit.mjs` passed with
  `placement audit OK`; the worker bootstrap imports only the control block and isolation policy.
- **Coverage — HELD.** The changed validation, descriptor construction, imported-memory wiring,
  ready SAB publication, dispatch lookup/status validation, WFI transition, halt/fatal guards, host
  timeout, generated `web/dist` copies, and all fixture/spec branches executed in the final gate;
  declarative WAT fixtures are the only non-runtime additions. No changed behavioral hunk is dead.
- **SUITE:** retained the five-case Chromium spec, the 33-case Node isolation/control/device suite,
  placement audit, exact-head evidence JSON, and screenshot. WebKit and independent-machine legs
  were not used per the user's explicit direction.

Implementation commits: `f23cedd`, `2b3ed27`.

Evidence: `evidence/e4-t22d/worker-bootstrap-2026-09-03.json` (SHA-256
`11e0c55024633b6184b1d6703493f4835a37d1b1577aed979189a3df001dd4d7`) and
`evidence/e4-t22d/worker-bootstrap-2026-09-03.png` (SHA-256
`51d1cfa5bae5476da69433b0e8131685a7de001119d28036d593b34fc6328397`).

Commands: `make web-test-cpu-worker` (`33/33` Node tests, placement audit OK, `5/5` Chromium
tests); `node --check web/cpu-worker.js web/cpu-worker-host.js
web/tests/e4-t22d-worker-bootstrap.spec.js`; `python3 tools/check_task_policy.py`; `make tasks-json`;
and `make web-dist`. The web-dist build was run with the pre-existing local artifact manifests
restored untouched. Host-layer rr, WebKit, and independent-machine checks were not required for this
browser/guest-layer proof.
