---
id: E5-T11b
epic: 5
title: keyboard device registration and LED status wiring
priority: 511.2
status: pending
depends_on: [E5-T11a]
estimate: S
risk: medium
capstone: false
---

## Goal

Instantiate the keyboard spec as a concrete virtio-input device, register it through the existing
virtio-mmio chassis, and retain guest LED state through the T10 statusq callback seam.

## Deliverables

- A host-owned keyboard LED state with CapsLock/NumLock/ScrollLock fields and a callback adapter.
- Machine/slot registration that preserves the existing GPU and headless virtio slot behavior.
- Deterministic statusq tests for repeated LED updates, reset, and callback ordering.

## Acceptance criteria

- The keyboard device enumerates as virtio input with the T11a capabilities and can be attached
  without changing unrelated virtio slots.
- 100 repeated LED status events reach the host state in order, with the final state equal to the
  last event and no callback lost across a reset/re-setup.
- Native and wasm32 registration/config tests pass with no browser-specific code in core.

## Adversarial verification

Alternate LED bits while eventq injections are pending, reset between statusq kicks, and prove the
host indicator converges to the final guest state without a stale callback or queue stall.

## Verification log

(empty)
