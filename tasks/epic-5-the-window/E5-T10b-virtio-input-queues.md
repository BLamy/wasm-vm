---
id: E5-T10b
epic: 5
title: virtio-input eventq and statusq transport
priority: 510.2
status: verified
depends_on: [E5-T10a]
estimate: S
risk: high
capstone: false
---

## Goal

Connect the virtio-input config device to its two queue boundaries: device-to-guest eventq
delivery and guest-to-device statusq consumption, with a host callback for output events.

## Deliverables

- Eventq/statusq queue setup and bounded descriptor-chain servicing on the existing virtio-mmio
  chassis.
- Typed 8-byte `virtio_input_event` encoding/decoding in little-endian order.
- Host status-event callback seam for LED/output events, with malformed and short chains rejected
  without a VM-loop panic or stall.
- Hand-built native queue tests and a wasm32 wire-layout mirror.

## Acceptance criteria

- A posted eventq buffer receives exactly one 8-byte event and the used length is exact.
- A statusq event reaches the host callback with the original type, code, and value.
- Split descriptors, short buffers, unsupported queue shapes, and repeated service calls preserve
  ring progress and return bounded errors; native and wasm32 event bytes are identical.

## Adversarial verification

Exercise split event/status descriptors, empty and undersized buffers, alternating queue kicks,
and a hostile used-ring index. Prove no event is partially written and no status callback runs
for malformed input.

## Verification log

### 2026-09-03 — worker — implemented

- **Eventq transport — HELD.** Added the fixed eight-byte `InputEvent` wire type and deferred
  eventq service. A complete event is written across split writable descriptors and published with
  `used.len = 8`; undersized or wrongly-directed buffers publish `used.len = 0` without partial
  bytes or consuming the pending event.
- **Statusq transport — HELD.** Added split readable-descriptor decoding and an
  `InputStatusSink` callback seam. Short and wrongly-directed chains advance the ring without
  invoking the callback; a complete status event reaches the host with the original type, code,
  and value.
- **Hostile transport behavior — HELD.** QueueNotify is deferred outside the guest MMIO borrow,
  non-power-of-two queue shapes take the existing bounded NEEDS_RESET path, reset drops cached
  queue state, and a hostile used index cannot redirect the device-owned completion shadow.
- **Cross-target coverage — HELD.** Native queue tests and the wasm32 event wire-layout mirror
  exercise positive and negative values with identical bytes.

Implementation commit: `b6c840f`.

Evidence: `evidence/e5-t10b/input-queues-2026-09-03.json` (SHA-256
`09de312319c92b96d6619cee901d987e108fa0ecfc0185e736f0807e7a0d1108`).

Commands: `cargo fmt --all -- --check`; `git diff --check`; `cargo test -p wasm-vm-core --lib
dev::virtio::input` (8 passed); `cargo test -p wasm-vm-core --lib --quiet` (227 passed);
`cargo clippy -p wasm-vm-core --lib -- -D warnings`; `cargo build -p wasm-vm-core
--no-default-features --target wasm32-unknown-unknown`; `cargo clippy -p wasm-vm-core --target
wasm32-unknown-unknown --no-default-features --lib -- -D warnings`; `cargo test -p wasm-vm-core
--test virtio_mmio_slots --test virtio_blk --test virtio_net_critic --quiet` (22 passed);
`wasm-pack test --node crates/wasm --test input_config` (1 passed); and `wasm-pack test --node
crates/wasm --test input_queues` (1 passed). The existing wasm-pack warning in
`crates/wasm/tests/hart_ctrl.rs` is unrelated.

The recorded run demonstrates exact event wire parity, complete split-descriptor event delivery,
short-buffer recovery without partial writes, callback-free malformed status handling, bounded
queue-shape rejection, and preservation of the existing virtio regression suite. Independent-
machine, WebKit, and host-layer rr runs were excluded per the user's direction and the repository's
current evidence policy.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Acceptance — HELD.** The recorded native run proves one complete event crosses split eventq
  descriptors with `used.len = 8`; short buffers preserve their bytes and later ring progress; and
  valid split statusq descriptors deliver the original event fields to the host callback.
- **Malformed-input safety — HELD.** Short and wrongly-directed status chains complete with no
  callback, non-power-of-two queue configuration takes the bounded NEEDS_RESET path, and the
  hostile used index does not redirect completion publication.
- **Coverage — HELD.** The changed event type, shared state, deferred QueueNotify path, reset
  handling, queue preparation, split read/write helpers, status callback, and both queue services
  execute in the focused native tests; the wasm32 runner covers the same wire bytes.
- **Evidence integrity — HELD.** Evidence digest
  `09de312319c92b96d6619cee901d987e108fa0ecfc0185e736f0807e7a0d1108` matches the checked-in
  artifact for implementation commit `b6c840f`.

E5-T10b is verified; E5-T10c is the next active eligible slice.
