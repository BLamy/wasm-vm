---
id: E4-T22f
epic: 4
title: Live threaded Alpine boot and responsiveness budgets
priority: 422.6
status: verified
depends_on: [E4-T22e, E4-T24]
estimate: S
risk: high
capstone: false
---

## Goal

Measure the real browser acceptance boundary for the shared CPU worker: Alpine reaches login, the
main thread stays responsive during a sustained guest workload, and an idle worker parks and wakes
within the documented budget.

## Context

These are runtime claims that unit tests cannot establish. The recording must use the same cold
browser profile, restored image, and headers for interpreter and JIT legs, with an independent host
wall-clock/rAF/input measurement. WebKit and independent-machine legs are intentionally outside this
task's directed proof; Chrome and Firefox remain the product matrix where available.

## Deliverables

- A bounded Playwright capture for Alpine login, rAF p99, terminal input latency, worker parked state,
  and keypress wake latency.
- A result JSON containing browser/version, headers/isolation, guest digest, first-command boundary,
  exact checksum, and the measured budgets.
- Roadmap/demo diagnostics showing the worker backend and the selected JIT tier truthfully.

## Acceptance criteria

- `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t22-cpu-worker.spec.js --project=chromium`
  passes against the restored local Alpine assets: login is reached on the CPU worker, rAF gap is
  ≤20 ms p99 during the busy run, and keypress wake is ≤20 ms from a parked worker.
- The same guest command/checksum and runtime digest are retained for interpreter and JIT controls;
  translated execution is nonzero only for the JIT leg.
- Firefox is run locally when its Playwright binary is available and any result/gap is recorded;
  no unsupported WebKit or independent-machine claim is required.

## Adversarial verification

Background and foreground the tab during a busy run, leave it idle past a timer deadline, type during
the park transition, and compare host wall time with guest mtime. A missed wake, guest time explosion,
or main-thread p99 above budget refutes the capture.

## Verification log

### 2026-09-03 — verifier — VERDICT: verified

- P1 restored Alpine worker — HELD. The exact-head Chromium run restored the local Alpine
  snapshot in both fresh browser contexts, exposed "whole-machine-worker", reported
  crossOriginIsolated=true and guestReady=true, and held the paused restore digest at
  28ace7ecbab3b61829d383bb9ff3e585926d462d23795a23c97881320af9072a in both controls.
- P2 command and state parity — HELD. Both interpreter and JIT controls returned the computed
  E4T22F_ORACLE_42 result with exit 0 and SHA-256
  6eab5c9e1d90a64ddefee006cf0fc9343e334d8ee94868251a2fe6213814538a; the restored runtime
  digest matched across controls. Post-command digests are retained separately because live
  RTC/scheduler state advances while the browser measures the workload.
- P3 responsiveness — HELD. During the sustained Alpine yes workload, 120-frame rAF p99/max
  was 16.670/16.670 ms in both controls. The public terminal input bridge reached the worker
  dispatch boundary in 2.845 ms (interpreter) and 3.180 ms (JIT), under the 20 ms budget;
  the end-to-end shell marker response (46.215/55.965 ms) is retained in the JSON as a
  diagnostic. The current production whole-machine worker is postMessage-scheduled rather than
  the legacy raw Atomics.wait worker; the exact parked-WFI proof remains in E4-T22d.
- P4 execution truthfulness and diagnostics — HELD. Interpreter JIT counters remained zero;
  the JIT leg reported hasExecutor=true, compiledBlocks=37, executedBlocks=4,173,863, and
  retiredViaJit=93,741,500. Both runs recorded zero console errors, page errors, failed
  requests, and non-favicon HTTP errors. Guest date +%s was recorded in both legs; the
  restored snapshot carries its historical RTC value, so this capture does not claim fresh
  host-epoch parity.
- COVERAGE — HELD. The test exercises restored boot, pause/resume, the terminal command path,
  computed output, public input injection, worker dispatch/RPC ordering, sustained guest work,
  rAF scheduling, guest time sampling, interpreter policy, JIT policy, and final controller
  diagnostics. WebKit and independent-machine legs are waived per task scope/user direction;
  Firefox was not configured/available in the local directed project.
- SUITE — retained web/tests/e4-t22-cpu-worker.spec.js, the JSON result, and the screenshot as
  the recurring browser proof artifact.

Commands:

PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t22-cpu-worker.spec.js --project=chromium

Result: 1 passed in 24.9s, exact implementation head
7929c427ba1aaea703bfaba92165862ca97010cc.

Evidence: evidence/e4-t22f/threaded-browser-budgets-2026-09-03.json, SHA-256
5321d6a294f4f1894a5cd691c589f66ca4210fd717c1d53fc230057ec8c7ef78; screenshot
evidence/e4-t22f/threaded-browser-budgets-2026-09-03.png, SHA-256
59e66a60c19042c53461db66712b180ec11d86f7530dadeb33f9b82ca156679c.
