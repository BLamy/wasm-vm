---
id: E5-T11a
epic: 5
title: virtio-input keyboard capability specification
priority: 511.1
status: pending
depends_on: [E5-T10c]
estimate: S
risk: medium
capstone: false
---

## Goal

Define the reusable PC-105 keyboard `InputDeviceSpec` with an auditable evdev capability map and
the deliberate no-autorepeat contract.

## Deliverables

- Table-driven EV_KEY coverage for the declared PC-105 range, including the documented edge keys.
- EV_LED bits for NumLock, CapsLock, and ScrollLock plus optional scan metadata when declared.
- No EV_REP capability, with the host make/break-only policy documented beside the spec.
- Native and wasm32 config fixtures for the exact name, devids, EV_BITS, and LED bitmap.

## Acceptance criteria

- The spec advertises every key code the keyboard instance is allowed to emit and no undeclared
  code; EV_REP is absent.
- Native and wasm32 config reads produce byte-identical EV_KEY and EV_LED bitmaps.
- A focused native test fails if a declared key or LED bit moves, disappears, or is silently added.

## Adversarial verification

Compare the complete bitmap against the checked-in QEMU-shaped fixture and probe edge codes near
the declared range, including F24 and the highest advertised code.

## Verification log

(empty)
