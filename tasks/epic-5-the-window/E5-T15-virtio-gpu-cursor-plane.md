---
id: E5-T15
epic: 5
title: Hardware cursor plane — cursorq UPDATE/MOVE_CURSOR with DOM-overlay presentation
priority: 515
status: cancelled
depends_on: [E5-T03c, E5-T14c]
estimate: M
risk: high
capstone: false
decomposed_into: [E5-T15a, E5-T15b, E5-T15c, E5-T15d]
---

## Goal
The cursorq comes alive: `VIRTIO_GPU_CMD_UPDATE_CURSOR` and `MOVE_CURSOR` are
implemented with a host presentation strategy that keeps the guest cursor a separate
plane (DOM overlay / CSS cursor image) instead of compositing it into the framebuffer —
zero-latency cursor movement independent of frame uploads.

## Context
Wayland compositors and X drivers use the DRM cursor plane heavily; virtio-gpu maps it
to cursorq commands: `virtio_gpu_update_cursor { hdr, pos{scanout_id, x, y}, resource_id,
hot_x, hot_y, padding }`. UPDATE_CURSOR sets the cursor image (a small resource, typ.
64x64 B8G8R8A8, transferred like any 2D resource) + hotspot; MOVE_CURSOR only moves it.
resource_id 0 hides the cursor. Presentation options, in latency order: (a) set the
canvas CSS `cursor` property to a data-URL PNG rendered from the cursor resource with
`hot_x/hot_y` as the hotspot — the *browser* then moves it with true hardware latency
and we ignore MOVE_CURSOR in absolute mode (host and guest cursor coincide by
construction because T14's tablet is pixel-exact); (b) an absolutely-positioned
composited DOM element (`transform: translate()`) driven by MOVE_CURSOR — needed in
relative/Pointer-Lock mode where there is no host cursor; (c) composite into the
framebuffer — rejected (couples cursor to frame pacing). Implement (a)+(b) selected by
T14's mode. Guests that render cursors in software (fbcon, some configs) simply never
send cursorq traffic — CSS `cursor:none` must then NOT be applied blindly.

## Deliverables
- cursorq handling in the GPU device: parse both commands, maintain
  `{resource_id, hot_x, hot_y, pos}` per scanout, expose to the sink as a cursor-state
  change callback (core stays canvas-free).
- Sink: cursor-resource → RGBA → data-URL CSS cursor path with hotspot; DOM overlay
  element for relative mode, `will-change: transform`, hidden when resource_id 0.
- Mode wiring: absolute mode uses CSS-cursor path and suppresses the overlay; relative
  mode hides host cursor (pointer lock does) and shows the overlay at MOVE positions.
- Fallback: cursor images larger than the browser CSS-cursor limit (128px, and 32px
  effective on some platforms) fall back to the overlay path automatically.
- Native tests for command parsing + cursor state; fixture from a QEMU weston trace.

## Acceptance criteria
- [ ] UPDATE_CURSOR with a checkerboard 64x64 resource yields a CSS cursor whose PNG
      decodes to the same RGBA (unit test on the conversion, alpha preserved).
- [ ] Hotspot honored: a synthetic guest cursor with hot at (10,3) clicks exactly where
      its tip points (integration-checked under T18's desktop later; math unit-checked
      now: CSS cursor syntax `url(...) 10 3, none`).
- [ ] MOVE_CURSOR at 500 Hz in relative mode updates the overlay without triggering
      layout (verified via DevTools performance trace: transforms only).
- [ ] resource_id 0 hides guest cursor; host cursor behavior per mode matches the doc.
- [ ] No cursorq traffic (fbcon boot) leaves the default host cursor untouched.

## Adversarial verification
Refute latency and drift claims: in absolute mode under T18's desktop, park the host
cursor at 20 screen positions and screenshot — guest-rendered UI hover highlights must
sit under the host cursor at every position and every DPR (offset drift refutes; this
catches hotspot sign errors). Refute plane independence: run a window drag (heavy frame
uploads) while wiggling the cursor — cursor motion must stay smooth even if frames drop
(measure overlay update rate vs present rate). Attack lifecycle: guest UNREFs the
cursor resource while it's active (must not crash or show garbage); UPDATE_CURSOR with
resource dims 256x256 (must take the overlay fallback); alternate UPDATE/MOVE 1000x for
leak of data-URLs (heap snapshot flat).

## Verification log

### 2026-09-04 — coordinator — decomposed

This M-sized cursor-plane container is cancelled before implementation as required by task policy.
The work is split into ordered S tickets with one protocol or browser boundary per ticket:

1. **E5-T15a — cursorq core state.** Parse UPDATE_CURSOR and MOVE_CURSOR, validate resource and
   hotspot/position fields, maintain per-scanout cursor state, and expose a canvas-free callback.
2. **E5-T15b — cursor-resource sink conversion.** Convert a checked cursor resource to RGBA PNG/CSS
   syntax, preserve alpha and hotspot, and retain the bounded overlay fallback for large images.
3. **E5-T15c — mode wiring and lifecycle.** Select CSS cursor versus relative-mode DOM overlay, hide
   resource 0, keep software-fbcon host cursor behavior unchanged, and avoid layout work on moves.
4. **E5-T15d — integration proof.** Exercise checkerboard/hotspot/move/hide/lifecycle cases and the
   500 Hz transform-only path, with a committed Chromium/native evidence envelope.

Downstream desktop work must depend on E5-T15d, not this cancelled planning container.
