---
id: E5-T15c
epic: 5
title: Cursor mode wiring and lifecycle
priority: 515.3
status: implemented
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
