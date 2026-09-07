---
id: E5-T26c
epic: 5
title: Virtio-input pending rings, LEDs, and restore release-all
priority: 526.3
status: pending
depends_on: [E5-T26b]
estimate: S
risk: high
capstone: false
---

## Goal

Persist the three virtio-input device queues and LED state while deliberately excluding the
host's held-key set, then reconcile physical input safely on restore.

## Boundary

Own input-device snapshot sections, pending-event ring ordering, LED state, and T13 release-all
reconciliation. Do not own GPU pixels, sound streams, or browser UI.

## Acceptance criteria

- A scripted keyboard/tablet/consumer-input checkpoint round-trips pending events and LEDs
  byte-for-byte, preserving event order and queue indices.
- Restore emits release events for every host-held key/button, records that the host-held set was
  intentionally discarded, and leaves no stuck key or button in evdev state.
- A restored empty queue accepts a new key, pointer, and LED event without requiring a guest
  reboot; malformed ring lengths and duplicate events are rejected.

## Verification command

make verify-E5-T26c

## Adversarial verification

Snapshot immediately after key-down, button-down, and LED change; restore with the host state
changed, then run evtest-style assertions for release-all, queue ordering, and fresh input.

## Verification log

(empty)
