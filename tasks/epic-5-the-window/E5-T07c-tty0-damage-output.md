---
id: E5-T07c
epic: 5
title: tty0 output and fbcon damage-rectangle delivery
priority: 507.3
status: verified
depends_on: [E5-T07b]
estimate: S
risk: high
capstone: false
---

## Goal

Prove that serial-console commands targeting `/dev/tty0` appear on the visible fbcon surface and
that cursor blinking/partial updates publish only the changed damage rectangle.

## Boundary

This slice owns the tty0-to-frame path and its bounded damage evidence. It does not add a host
keyboard device, change the virtio-gpu protocol, or implement compositor scheduling.

## Deliverables

- A deterministic serial command harness for `echo hello > /dev/tty0` with a canvas readback assertion.
- Trace assertions distinguishing full framebuffer transfers from cursor/partial flush rectangles.
- A bounded duplicate-callback and guest-queue-liveness regression test.

## Acceptance criteria

- `hello` appears at the expected VT coordinates and colors on the canvas in the same run that
  produced the serial command.
- Cursor blink and partial text updates emit damage rectangles smaller than the full resource and
  preserve pixels outside each rectangle.
- No duplicate callback, queue stall, resource growth, or lost serial output occurs during the
  deterministic command sequence.

## Verification command

`make verify-E5-T07c`

## Adversarial verification

Alternate full-line output and cursor updates at the flush boundary, including an update at each
edge and an odd-width rectangle. The final visible frame must match the independent reference
buffer and every used-ring completion must be accounted for exactly once.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified
- TTY0 output — HELD. Predicted the exact serial input `echo hello > /dev/tty0` would return to the
  BusyBox prompt while changing the visible VT. Chromium observed the command and prompt, and the
  independent 1280×800 RGBA reference found 142 non-black pixels in the expected `(0,0)-(40,16)`
  hello cell with opaque `170,170,170` foreground; the canvas readback matched that region exactly.
- Damage delivery — HELD. Predicted the first frame would establish the complete resource and later
  transfer/cursor work would publish smaller rectangles without changing sampled pixels outside each
  rectangle. The exact-head trace recorded 4 full and 193 partial frames, with 170 post-command
  partials; the largest partial area was 663,138 versus 1,024,000, every outside sample held, and
  the independent reference matched the final canvas with zero differing bytes.
- Liveness/accounting — HELD. Predicted no duplicate callback, queue stall, or lost input. The run
  recorded 197 callbacks and 197 successful presents, zero drops/errors, contiguous frame sequence,
  58 expected and 58 scheduler-accounted input bytes across two calls, 437,985,385 retired guest
  instructions, 876 slices, and 877 main-thread yields.
- Coverage — HELD. The promoted native resource and control-queue tests exercise full, odd-width,
  edge, pending-outside-request, and used-ring completion behavior; the browser route exercises the
  production wasm FrameSink, Canvas2D readback, tty0 command, cursor updates, and source/dist parity.
  Independent-machine, WebKit, and host-rr checks are outside this task by explicit project/user
  scope.
Evidence: `evidence/e5-t07c/tty0-damage.json` (SHA-256 `18768378323075a1e6c5cb8e1087aea772d5c0d8b8dd7be7523b84706a03ccc7`), `evidence/e5-t07c/tty0-damage.png` (SHA-256 `5ca12a4d07d5b7c9c3aabefd3e26441cb5cf0b5ae39964f0671f0a182dad2702`). Exact implementation head: `85d3b3688362c699c4288a0398d714ebf3c2f99c`. Commands: `make verify-E5-T07c`; exact-head `node tools/verify/e5-t07c-tty0-damage.mjs --output evidence/e5-t07c/tty0-damage.json`; `node --test web/tests/e5-t06d-presentation.test.mjs`.
