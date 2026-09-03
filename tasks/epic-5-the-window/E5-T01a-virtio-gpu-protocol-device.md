---
id: E5-T01a
epic: 5
title: virtio-gpu device identity, config space, and protocol types
priority: 501.1
status: verified
depends_on: [E4]
estimate: S
risk: high
capstone: false
---

## Goal

Add the virtio-gpu device skeleton and typed wire-format helpers without dispatching a guest
command: device ID 16, VERSION_1 negotiation, the six-byte configuration surface, and exact
little-endian control/response header and display-mode representations.

## Context

Every later GPU command depends on a stable protocol boundary. Keeping identity, feature bits,
configuration registers, and byte-layout fixtures in one small slice makes the device enumerable
before queue behavior is introduced and allows native/wasm byte comparisons without a running
desktop.

## Deliverables

- `crates/core/src/dev/virtio/gpu/` protocol and device-skeleton modules.
- `VirtioGpu` implementing the existing `VirtioDevice` trait with device ID 16, one scanout, and
  zero capsets.
- Native unit tests for feature/config reads and the 24-byte control header plus 408-byte display
  response layout fixtures.

## Acceptance criteria

- `cargo test -p wasm-vm-core --lib gpu_protocol` passes and asserts the exact little-endian bytes
  for the control header and all 16 display modes.
- The device reports ID 16, negotiates VERSION_1, and exposes `num_scanouts == 1` and
  `num_capsets == 0` through the existing virtio-mmio transport.
- No queue command is claimed complete by this slice; command dispatch remains owned by E5-T01b.

## Adversarial verification

Flip every multi-byte field independently and compare the fixture bytes against the virtio-gpu
wire layout. Run the same protocol tests under the wasm32 test target. Attempt an unsupported
feature bit and confirm negotiation rejects it without mutating the configuration surface.

## Verification log

### 2026-09-03 — coordinator — VERDICT: verified (user-directed)

- **Protocol wire layout — HELD.** `gpu_protocol_wire_fixtures` asserts the exact 24-byte
  little-endian control header with independent nonzero values in every multi-byte field, then
  asserts every one of the 16 24-byte display modes in the 408-byte response: scanout 0 is the
  only enabled mode at 1280x800 and modes 1–15 are zero. The typed decoder round-trips the same
  bytes.
- **Device identity/config — HELD.** `gpu_mmio_identity_features_and_config` drives the existing
  virtio-mmio register file, observes DeviceID 16, VERSION_1 in feature bank 1, two queue slots,
  `num_scanouts=1`, and `num_capsets=0`. `unsupported_feature_does_not_mutate_config` confirms
  FEATURES_OK stays clear and the config values remain unchanged after an unoffered bit.
- **Wasm/native parity — HELD.** The dedicated wasm32 Node runner exercises the same wire fixture
  and a real virtio-mmio Machine attachment: 2 tests passed. The no-default-features core wasm32
  build and clippy checks also pass.
- **Scope — HELD.** This slice only adds the identity/configuration and typed protocol boundary;
  it does not claim queue command completion. E5-T01b owns controlq dispatch.

Implementation commit: `b4d0735`.

Evidence: `evidence/e5-t01a/gpu-protocol-2026-09-03.json` (SHA-256
`b3dcab3a3ad407a6673ebf46028efc04b7296dcd15de3246ccab307498584783`).

Commands: `cargo fmt --all`; `cargo clippy -p wasm-vm-core --lib -- -D warnings`; `cargo test
-p wasm-vm-core --lib gpu_protocol` (1 passed); `cargo test -p wasm-vm-core --lib gpu::` (4
passed); `cargo test -p wasm-vm-core --lib` (179 passed); `cargo build -p wasm-vm-core
--no-default-features --target wasm32-unknown-unknown`; `cargo clippy -p wasm-vm-core --target
wasm32-unknown-unknown --no-default-features --lib -- -D warnings`; and `wasm-pack test --node
crates/wasm --test gpu_protocol` (2 passed). Independent-machine, WebKit, and host-layer rr runs
were not used per the user's direction and current repository evidence policy.
