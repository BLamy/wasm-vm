---
id: E5-T11a
epic: 5
title: virtio-input keyboard capability specification
priority: 511.1
status: implemented
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

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit 916ee8f4b0616ac96a23be7b6807ec16338c1e5e adds the reusable keyboard
capability module and native/wasm32 configuration fixtures. The exact-head checks were:
cargo fmt --all -- --check, git diff --check, cargo test -p wasm-vm-core --lib dev::virtio::input
(13 passed), cargo test -p wasm-vm-core --lib (232 passed),
cargo test -p wasm-vm-core --test virtio_mmio_slots --test virtio_blk --test virtio_net_critic
--quiet (22 passed), native and wasm32 cargo clippy with -D warnings, the wasm32 core build, and
wasm-pack test --node crates/wasm --test keyboard_spec (1 passed), input_config (1 passed), and
input_queues (2 passed). The evidence is
evidence/e5-t11a/keyboard-spec-2026-09-03.json, SHA-256
eae7d2fb09092d7b50ddcac2084ca3e029efd7cd18fcfef9e0a9e4da8d1d8961.

The recording demonstrates that the keyboard spec emits exactly PC-105 codes 1..=248, the
three declared LED bits, optional MSC_SCAN, and SYN_REPORT, while EV_REP remains empty. Native
and wasm32 VirtioMmio reads assert the stable name and devids plus byte-identical, zero-padded
capability payloads, including the final advertised key and the first undeclared edge.
