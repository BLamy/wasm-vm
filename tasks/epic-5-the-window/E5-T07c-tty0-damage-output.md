---
id: E5-T07c
epic: 5
title: tty0 output and fbcon damage-rectangle delivery
priority: 507.3
status: in-progress
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

(empty)
