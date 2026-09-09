---
id: E5-T11b
epic: 5
title: keyboard device registration and LED status wiring
priority: 511.2
status: verified
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

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit 95fd672 adds the slot-3 keyboard registration, host-owned LED state and
status-sink adapter, Machine boundary servicing, and native/wasm32 registration fixtures. The
exact-head checks were cargo fmt --all -- --check, git diff --check, cargo test -p wasm-vm-core
--lib dev::virtio::input (15 passed), cargo test -p wasm-vm-core --test virtio_keyboard (2
passed), cargo test -p wasm-vm-core --lib (234 passed), the 22-test virtio regression sweep,
native library and integration clippy with -D warnings, the wasm32 core build and clippy, and
wasm-pack tests keyboard_registration (1 passed), keyboard_spec (1 passed), input_config (1
passed), and input_queues (2 passed). Evidence:
evidence/e5-t11b/keyboard-led-wiring-2026-09-03.json, SHA-256
b37434c5c997b4bab4b3aedcf155442bfe4e75d10fa805dd99e7c0e92c52e6bf.

The recording demonstrates that DeviceID 18 is installed in slot 3 without disturbing the
existing GPU/headless slot layout, and that the normal Machine run-loop statusq path applies 100
ordered NumLock/CapsLock/ScrollLock updates to the host-owned indicator. A transport reset and
queue re-setup retain the callback sink and deliver the next LED update, while the wasm32 fixture
confirms the same registration and T11a config payload.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- Registration — HELD. Predicted DeviceID 18 would occupy only reserved slot 3, leaving the GPU
  in slot 0 and slots 1 and 2 empty; the native and wasm32 registration fixtures observe exactly
  that layout. Evidence: keyboard-led-wiring-2026-09-03.json.
- LED ordering and reset — HELD. Predicted each of 100 alternating EV_LED status events would
  update the corresponding host field before the next Machine boundary, and that reset plus
  queue re-setup would preserve the sink; the native test observes every intermediate state,
  status_events_served = 101 after the post-reset event, and the final CapsLock update.
- Coverage — HELD. The changed keyboard sink, Machine fields/constructor, slot installer,
  accessor, and run-loop service branch all execute in the focused unit, native Machine, or
  wasm32 registration tests. No changed runtime hunk is unexercised.
- Evidence integrity — HELD. Evidence digest
  b37434c5c997b4bab4b3aedcf155442bfe4e75d10fa805dd99e7c0e92c52e6bf matches the checked-in
  artifact for implementation commit 95fd672.
- SUITE — HELD. The deterministic native status-queue test and wasm32 registration/config fixture
  are the permanent proof artifacts for this isolated registration slice.
