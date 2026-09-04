---
id: E5-T15c
epic: 5
title: Cursor mode wiring and lifecycle
priority: 515.3
status: verified
depends_on: [E5-T15b, E5-T14c]
estimate: S
risk: medium
capstone: false
---

## Goal

Wire cursor state into absolute CSS-cursor and relative pointer-lock overlay modes without coupling
cursor movement to framebuffer frame pacing or changing software-fbcon host cursor behavior.

## Boundary

This slice owns mode selection, MOVE_CURSOR transform updates, hide/show and resource replacement
lifecycles, and DOM listener/layout discipline. The final guest/browser workload belongs to E5-T15d.

## Deliverables

- Absolute mode CSS cursor selection and relative mode overlay with `will-change: transform`.
- Resource 0 hide, UNREF cleanup, replacement, and oversized-image fallback behavior.
- A transform-only move path with no forced layout/readback and a mode-transition state snapshot.

## Acceptance criteria

- Absolute mode uses the CSS cursor and suppresses the overlay; relative mode uses the overlay and
  leaves host CSS cursor hidden only while pointer lock is active.
- 500 Hz MOVE_CURSOR updates change only transform/style state and do not call layout APIs.
- Hiding, replacing, and unref-ing an active cursor leaves no stale image, listener, or DOM node.
- A software-fbcon boot that sends no cursorq traffic leaves the default host cursor untouched.

## Verification command

`make verify-E5-T15c`

## Adversarial verification

Alternate modes and UPDATE/MOVE/hide/UNREF 1,000 times, inject moves during a framebuffer upload,
and spy on layout reads/writes. Any stale cursor, layout read, duplicate listener, or host-cursor
mutation without cursorq state refutes the slice.

## Verification log

### 2026-09-04 — worker — IMPLEMENTED

- Commit: `9c0060864d87ebde262182a860441eaf2eba884c`.
- Exact submission gate: `make verify-E5-T15c` — passed syntax checks, the 31-test cursor/machine
  protocol matrix, the Chromium production-page smoke, Rust formatting/clippy, 267 core tests, 3
  machine-boundary tests, and the wasm32 build.
- Implementation: the core now emits a distinct `cursor_move` callback without borrowing cursor
  pixels; the wasm sink labels UPDATE/MOVE events and provides an empty MOVE view; direct and
  whole-machine worker loaders route cursor events around framebuffer presentation; and the page
  owns one bounded CSS/overlay controller with pointer-lock-aware host-cursor restoration,
  transform-only movement, replacement/hide cleanup, and a no-traffic default-cursor path.
- Evidence: [`evidence/e5-t15c/cursor-mode-browser-2026-09-04.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t15c/cursor-mode-browser-2026-09-04.json),
  SHA-256 `43436209af48affe8e95c65de14163bb9f267169d8024544981b65ba4ea2d7c1`; screenshot
  [`evidence/e5-t15c/cursor-mode-browser-2026-09-04.png`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t15c/cursor-mode-browser-2026-09-04.png),
  SHA-256 `bff503494b4e7cad24d9b9089676ca348f7cee8c795a23f9749f86f1d76b889b`.
- Claim: the deterministic fixtures hold absolute CSS versus relative overlay mode, hide and
  replacement/unref lifecycle, 500 MOVE callbacks with no layout reads and only transform writes,
  1,000 alternating bounded transitions, and worker-side private UPDATE ownership with empty MOVE
  payloads. The Chromium recording additionally proves source/dist identity, a clean production
  page, exact hotspot CSS `(10,3)`, final transform `(689,796)`, 500 moves, and no stale overlay
  after resource 0. The real guest checkerboard/delayed-frame workload remains E5-T15d.
- Independent-machine and WebKit coverage were excluded per the user's direction; host rr is waived
  by the repository evidence policy.

### 2026-09-04 — verifier — VERDICT: verified

- P1 mode selection and no-traffic default — HELD. Predicted no cursorq event leaves the initial
  host cursor style empty and overlay count zero; absolute UPDATE owns CSS, while relative mode
  owns one `will-change: transform` overlay and hides the host cursor only under pointer lock.
  Observed exactly in the checked-in controller assertions (`web/tests/e5-t15c-cursor-mode.test.mjs:123-152,191-234`)
  and Chromium evidence (`evidence/e5-t15c/cursor-mode-browser-2026-09-04.json:55-90,93-122,144-178`),
  with no page/console/request errors.
- P2 transform-only MOVE path — HELD. Predicted 500 MOVE callbacks preserve the copied image and
  one overlay, write only `transform`, and perform zero layout reads. The test held at
  `web/tests/e5-t15c-cursor-mode.test.mjs:154-189`; browser evidence records `moves: 500`,
  `transformWrites: 501`, and the expected final transform at JSON lines 99-142. A bounded novel
  interleaving attack (200 simulated framebuffer-upload windows, each with one wrong-resource
  MOVE followed by one valid MOVE) also held: 200 rejected attacks, 200 transform writes, zero
  layout reads, one overlay, and clean resource-0 teardown.
- P3 core/worker lifecycle and ownership — HELD. Predicted UPDATE/MOVE/hide/unref transitions
  retain no stale cursor state and MOVE crosses the worker boundary with an empty pixel payload.
  Checked-in core tests passed the cursor queue sequence and 1,000 hide/show bound
  (`crates/core/src/dev/virtio/gpu/mod.rs:2201-2331,2385-2418`), machine-boundary tests passed
  3/3, and the worker ownership assertion held at
  `web/tests/e4-t32-worker-protocol.test.mjs:308-350`; the full JS matrix passed 31/31.
- P4 gate and evidence integrity — HELD. Exact verification HEAD was
  `3cc89531a490e91811613e52ad138b918d387925` before execution. `make verify-E5-T15c` passed syntax, fmt, clippy,
  267/267 core tests, 3/3 machine tests, and the wasm32 build. The checked-in evidence digest is
  SHA-256 `43436209af48affe8e95c65de14163bb9f267169d8024544981b65ba4ea2d7c1`, with PNG digest
  `bff503494b4e7cad24d9b9089676ca348f7cee8c795a23f9749f86f1d76b889b`; all eight source/dist
  parity hashes match (`evidence/...json:12-52`). Independent-machine, WebKit, host-rr, and the
  real guest cursor workload remain waived/deferred exactly as authorized and bounded by T15d.
- COVERAGE: HELD for the T15c boundary. Core MOVE publication (`crates/core/src/dev/virtio/gpu/mod.rs:400-404,1106-1135`),
  worker routing/copying, controller lifecycle, browser wiring, and generated dist artifacts are
  exercised by the cited tests/smoke or parity/load checks. The wasm `JsFrameSink` guest callback
  body is compiled and its typed UPDATE/MOVE payload contract is covered downstream; actual guest
  cursorq traffic is intentionally deferred to E5-T15d per the task boundary. Test, Makefile,
  smoke, task, queue, manifest, and evidence additions are harness/metadata artifacts and are
  covered by their direct checks or waived as non-runtime bookkeeping.
- Commands: `make verify-E5-T15c`; checked-in digest/parity `sha256sum` checks; the bounded
  `node --input-type=module -` novel attack; `git diff --check 9c00608^ HEAD`.
