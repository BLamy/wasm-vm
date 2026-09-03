---
id: E5-T14a
epic: 5
title: pointer device specs and guest stream wiring
priority: 514.1
status: in-progress
depends_on: [E5-T10c]
estimate: S
risk: medium
capstone: false
---

## Goal

Add the two guest-visible pointer devices that the browser will drive: an absolute virtio tablet
and a relative virtio mouse. Keep their capability maps, identity, slot wiring, and event stream
semantics deterministic and independently testable before adding DOM behavior.

## Deliverables

- Tablet and mouse `InputDeviceSpec` declarations with exact ABS/REL/KEY capability bitmaps and
  stable virtual-bus identities.
- Machine/controller wiring that keeps both devices present while the host selects which one
  receives events, without disturbing the existing keyboard slot.
- Native configuration and event-stream fixtures covering coordinates, relative deltas, buttons,
  and frame termination.

## Acceptance criteria

- [ ] Guest config for the tablet exposes `ABS_X`/`ABS_Y` with `0..32767` ranges and the expected
      left/right/middle/side/extra button bits; mouse config exposes `REL_X`/`REL_Y` and wheel axes.
- [ ] Both devices appear in deterministic slot order and each injected pointer frame is a
      complete `EV_*` sequence ending in exactly one `SYN_REPORT`.
- [ ] Native hostile fixtures reject malformed/unsupported pointer events without corrupting the
      other device or the keyboard queue.

## Adversarial verification

Read every config selector in a permuted order, request unsupported bitmap bytes, and interleave
tablet/mouse/button frames while the event queue is slow. The verifier must observe isolated
capabilities, bounded complete frames, and no keyboard-state changes.

## Verification log

(empty)
