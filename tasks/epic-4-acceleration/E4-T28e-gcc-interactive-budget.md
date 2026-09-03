---
id: E4-T28e
epic: 4
title: In-guest gcc compile and continuous interactive echo budget
priority: 429.5
status: in-progress
depends_on: [E4-T28a, E4-T32, E4-T34]
estimate: S
risk: high
capstone: false
---

## Goal

Run the pinned in-guest `gcc -O2 -c miniz.c` workload through the real Alpine terminal while
continuously injecting independent keystrokes, proving the compile completes within 20 guest
seconds and the browser remains interactive with p95 echo latency below 100 ms.

## Context

The parent calls gcc's memory-heavy compile the interactive-speed reality check. A guest-reported
compile duration alone cannot prove interactivity, and an echo marker emitted by the guest alone
cannot prove the browser event loop stayed responsive. This slice records both clocks and binds the
object checksum to the actual compile command.

## Deliverables

- `web/tests/e4-t28-gcc-interactive.spec.js` using the pinned gcc overlay and independent browser
  input/echo timestamps.
- Evidence JSON with guest compile time, object size/hash, echo p95, runtime digest, controls, and
  artifact identity; no generated object or toolchain cache is silently treated as evidence.

## Acceptance criteria

- `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t28-gcc-interactive.spec.js --project=chromium`
  runs the exact `gcc -O2 -c miniz.c` command in the guest, returns exit 0, produces a nonzero object
  with the expected checksum, and reports guest wall time `≤ 20 s`.
- During the compile, independently injected terminal probes return p95 echo latency `< 100 ms`
  with no lost or reordered probe bytes, and the JIT is the selected shipping configuration.
- The result binds the timing and object to one exact source/build commit and records the Bun/Node
  and browser control flags without relying on a host-side compiler.

## Adversarial verification

Cross-check the object with `file`/hash inside the guest, replace `miniz.c` with a same-sized no-op,
and confirm the checksum/compile work changes. Inject probes at the start, middle, and end of the
compile, including while JIT compilation is active; kill/reload during an in-flight probe and make
sure the result is rejected rather than spliced together. Compare guest and host timing to expose
clock skew.

## Verification log
