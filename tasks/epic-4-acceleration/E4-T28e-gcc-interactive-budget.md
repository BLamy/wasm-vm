---
id: E4-T28e
epic: 4
title: In-guest gcc compile and continuous interactive echo budget
priority: 429.5
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified (user-directed verification-debt closure)

- Exact-head candidate: `6af49f25e22a5a9e9f6ad91c9713bc0ba8484ac8` (implementation commits
  `b4a0d05` and `6af49f2`).
- Acceptance command, run twice in fresh Chromium contexts:
  `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8133 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test tests/e4-t28-gcc-interactive.spec.js --project=chromium`.
  Both runs fetched `/gcc-overlay/gcc.ext4` with HTTP 200, verified the pinned overlay and
  local chunked-Alpine artifacts, and produced no browser request or console errors. The first
  setup RPC timed out at 180 seconds; after changing the read-only mount to `mount -o ro,noload`
  and extending the bound, the second setup RPC still timed out at 900 seconds while mounting
  `/dev/vdb`. No compile, object, echo-p95, or final runtime-digest claim is made from these
  browser attempts; the gap is recorded explicitly in
  `evidence/e4-t28e/gcc-interactive-2026-09-03.json`.
- The pinned source/overlay identity was exercised before the gap: overlay
  `f53445f65b5e32b9fe3c47e0f84c52c850da2c747edae0abca60e9592a758c4a`, source
  `0fcdc9888cb3a29ca8f176bac087e5fe6c7258a6ab06b1c271c1e109a11d3740`, 322,549 source bytes.
  Historical native exact-overlay evidence remains at
  `evidence/e4-t19/ab-2026-09-01/gcc-k64-d2497e3.json` (guest compile 163.96 seconds and
  object SHA `97198b27557042fb84de54881c5fb577505b4ee77c41bc056612be6173e5faca`), but it is
  not substituted for the missing browser proof.
- Per explicit owner direction, promote the debt item to `verified` and carry the bounded
  browser-mount gap into the Level-4 capstone/follow-up. Independent machines, WebKit, and host
  rr are outside this directed proof.
