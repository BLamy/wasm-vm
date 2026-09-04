---
id: E5-T19c
epic: 5
title: virtio-snd queue errors, XRUN events, and reset hardening
priority: 519.3
status: implemented
depends_on: [E5-T19b]
estimate: S
risk: medium
capstone: false
---

## Goal

Make the playback queues total and recoverable: malformed descriptors complete with errors, audio
underruns become bounded eventq notifications, and reset/re-setup cannot leak or strand buffers.

## Deliverables

- `VIRTIO_SND_EVT_PCM_XRUN` eventq serialization and delivery at the stream boundary.
- Defensive txq parsing for header-only, zero-length PCM, undersized, and wrong-stream buffers.
- Queue-depth accounting, reset/re-setup handling, and native tests for descriptor reclamation.
- A stable control/data response fixture suitable for comparison with QEMU's virtio-snd layout.

## Acceptance criteria

- [ ] Each malformed or wrong-stream txq descriptor completes with the specified error status and
      the queue continues to accept a later valid period.
- [ ] A forced mock-clock underrun emits one bounded XRUN event per missed period without unbounded
      event or sample buffering.
- [ ] Fifty STOP/RELEASE/reset/re-setup cycles return every descriptor and preserve the sink and
      stream state; queue depth does not monotonically shrink.

## Adversarial verification

Byte-dribble and truncate txq headers, mix invalid stream IDs with valid periods, fill the eventq
while the guest is not polling, and reset between kicks. Verify used-ring progress, error status,
event count, and a clean subsequent playback period.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

- Commit: `70f45cfb7c6244a5a40ceb272d324b568a6805e3`.
- Commands: `cargo fmt --all -- --check`; `cargo test -p wasm-vm-core --test virtio_snd --quiet`;
  `cargo test -p wasm-vm-core --test virtio_snd_playback --quiet`; `cargo test -p wasm-vm-core --test virtio_snd_queue --quiet`;
  `cargo test -p wasm-vm-core --lib --quiet`; `cargo clippy -p wasm-vm-core --all-targets -- -D warnings`;
  `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release`; `cargo check -p wasm-vm-core --no-default-features`;
  `git diff --check`.
- Results: `virtio_snd` 6/6, `virtio_snd_playback` 7/7, `virtio_snd_queue` 4/4, and the core
  library 238/238 passed; clippy, the release wasm build, the no-default-features check, and the
  diff check passed.
- Evidence: [`snd-queue-native-2026-09-03.txt`](../../evidence/e5-t19c/snd-queue-native-2026-09-03.txt),
  SHA-256 `03cbd620f83c152370507602139b5c46658d3f98f6a9ce3152d9d5a443bcc5db`.

The final native run covers exact event serialization, truncated/header-only/zero-PCM transfers,
undersized status, wrong-stream recovery, later valid playback, three missed-period XRUN delivery,
a 256-event bounded backlog with overflow accounting, short and wrongly-directed eventq buffers,
and fifty STOP/RELEASE/reset/re-setup cycles.
