---
id: E4-T22f
epic: 4
title: Live threaded Alpine boot and responsiveness budgets
priority: 422.6
status: in-progress
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
