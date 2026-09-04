---
id: E5-T15c
epic: 5
title: Cursor mode wiring and lifecycle
priority: 515.3
status: in-progress
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

(empty)
