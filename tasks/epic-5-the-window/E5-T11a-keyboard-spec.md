---
id: E5-T11a
epic: 5
title: virtio-input keyboard capability specification
priority: 511.1
status: verified
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
e841e5b828c681840822aea5e27c60412d12e96f2be93b4769683eab5905d10c.

The recording demonstrates that the keyboard spec emits exactly PC-105 codes 1..=248, the
three declared LED bits, optional MSC_SCAN, and SYN_REPORT, while EV_REP remains empty. Native
and wasm32 VirtioMmio reads assert the stable name and devids plus byte-identical, zero-padded
capability payloads, including the final advertised key and the first undeclared edge.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- EV_KEY range — HELD. Predicted the native and wasm32 payloads would contain every code from
  1 through 248, with no code 0 or 249..1023; the focused native assertions and the full
  zero-padded wasm32 fixture observe exactly fe, thirty bytes of ff, then 01. Evidence:
  the native keyboard tests and keyboard_spec wasm test in
  evidence/e5-t11a/keyboard-spec-2026-09-03.json.
- EV_LED/MSC/EV_REP — HELD. Predicted LED byte 07, MSC byte 10, SYN byte 01, and a zero-length
  repeat bitmap; both config paths observe those values and the native map test rejects
  non-declared tail bits. Evidence: the same evidence digest
  e841e5b828c681840822aea5e27c60412d12e96f2be93b4769683eab5905d10c.
- Identity and coverage — HELD. Predicted the stable keyboard name and BUS_VIRTUAL devid tuple
  would round-trip through VirtioMmio and every changed implementation hunk would execute;
  the native and wasm32 fixtures read both identity fields, while the 233-test core sweep,
  22-test virtio regression sweep, and focused 14-test input suite remain green. No changed
  runtime or fixture hunk is unexercised.
- SUITE — HELD. The deterministic native and wasm32 fixtures are the permanent proof artifact;
  no additional golden trace is needed for this declarative, non-concurrent slice.
