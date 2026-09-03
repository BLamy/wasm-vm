---
id: E5-T10c
epic: 5
title: virtio-input injection and frame-integrity buffering
priority: 510.3
status: verified
depends_on: [E5-T10b]
estimate: S
risk: high
capstone: false
---

## Goal

Finish the input chassis host API with synchronous frame emission, bounded pending events, and a
drop-oldest-full-frame policy that cannot strand a key-down without its matching key-up.

## Deliverables

- `inject_event(type, code, value)` and `sync()` with automatic EV_SYN/SYN_REPORT framing.
- A default-256 pending-event budget, whole-frame drop accounting, and non-blocking behavior when
  the guest has not posted eventq buffers.
- Deterministic native and wasm32 integration fixtures covering slow draining, key bursts, and
  queue recovery.

## Acceptance criteria

- 1000 injected events with a slowly draining guest never blocks the VM loop, drops only complete
  EV_SYN-delimited frames, and reports an accurate counter.
- Key down/up bursts delivered through eventq preserve frame boundaries; a dropped frame drops
  both sides of a key transition.
- `inject_event` and `sync` produce identical 8-byte little-endian event streams on native and
  wasm32, and statusq callback behavior remains intact.

## Adversarial verification

Force the drop path with a three-buffer eventq, alternate key-down/up bursts, drain after each
wrap, and machine-check the stream invariant that every key frame terminates in SYN_REPORT and
no delivered key-down lacks its eventual up or a whole-frame drop. Vary the buffer budget and
confirm the VM loop remains non-blocking.

## Verification log

### 2026-09-03 — worker — implemented

- **Framing API — HELD.** Added non-blocking `inject_event(type, code, value)` staging and
  `sync()` publication with one `EV_SYN/SYN_REPORT` terminator per complete frame. The eventq
  service advances a frame only after each exact eight-byte event is written.
- **Bounded buffering — HELD.** Added the default 256-event pending budget, complete-frame
  admission, whole-frame drop counters, and bounded staging for oversized frames. A 1000-frame
  native stress fixture retains 128 complete two-event frames and reports 872 dropped frames / 1744
  dropped events exactly.
- **Key transition integrity — HELD.** Dropping an unstarted key-down frame suppresses and removes
  its queued matching key-up frame; already-started frames and releases for keys seen by the guest
  are protected from dropping. Native three-buffer delivery proves key-down, key-up, and
  SYN_REPORT remain an intact stream.
- **Cross-target coverage — HELD.** The wasm32 runner drives the real virtio-mmio eventq with
  `inject_event` + `sync` and compares the same eight-byte stream as native.

Implementation commit: `85f5c4e`.

Evidence: `evidence/e5-t10c/input-injection-2026-09-03.json` (SHA-256
`6036c7384940401321f41e157b1ffd6004bd85fc1b5105e5e30f2388982dc3ac`).

Commands: `cargo fmt --all -- --check`; `git diff --check`; `cargo test -p wasm-vm-core --lib
dev::virtio::input` (11 passed); `cargo test -p wasm-vm-core --lib --quiet` (230 passed);
`cargo clippy -p wasm-vm-core --lib -- -D warnings`; `cargo build -p wasm-vm-core
--no-default-features --target wasm32-unknown-unknown`; `cargo clippy -p wasm-vm-core --target
wasm32-unknown-unknown --no-default-features --lib -- -D warnings`; `cargo test -p wasm-vm-core
--test virtio_mmio_slots --test virtio_blk --test virtio_net_critic --quiet` (22 passed);
`wasm-pack test --node crates/wasm --test input_config` (1 passed); and `wasm-pack test --node
crates/wasm --test input_queues` (2 passed). The existing wasm-pack warning in
`crates/wasm/tests/hart_ctrl.rs` is unrelated.

The recorded run demonstrates atomic SYN_REPORT framing, bounded non-blocking retention and exact
whole-frame accounting under 1000 frames, paired key-transition drops, three-buffer eventq
delivery, and native/wasm32 stream parity. Independent-machine, WebKit, and host-layer rr runs
were excluded per the user's direction and the repository's current evidence policy.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Framing and boundedness — HELD.** The native stress fixture predicts 1000 one-event frames
  become 2000 events; observed retention is exactly 256 events in 128 complete SYN_REPORT frames,
  with 872 frames and 1744 events counted as dropped.
- **Key integrity — HELD.** Under the four-event budget, the recorded drop removes the queued
  key-down and its separate key-up frame together; the three-buffer delivery records key-down,
  key-up, and SYN_REPORT in order with no held key remaining.
- **Cross-target transport — HELD.** The wasm32 runner drives the real virtio-mmio/eventq path and
  observes the same eight-byte stream for both key transitions and SYN_REPORT.
- **Coverage — HELD.** The changed staging, sync framing, budget enforcement, suppression/drop
  accounting, delivery protection, reset state, and existing T10b queue paths execute in the
  focused/native and wasm32 runs.
- **Evidence integrity — HELD.** Evidence digest
  `6036c7384940401321f41e157b1ffd6004bd85fc1b5105e5e30f2388982dc3ac` matches the checked-in
  artifact for implementation commit `85f5c4e`.

E5-T10c is verified; the next queue items must be decomposed before activation.
