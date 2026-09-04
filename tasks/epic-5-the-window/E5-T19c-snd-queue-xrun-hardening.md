---
id: E5-T19c
epic: 5
title: virtio-snd queue errors, XRUN events, and reset hardening
priority: 519.3
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified

- Predictions: malformed txq records are reclaimed in FIFO order without blocking a later valid
  period; missed periods create one bounded XRUN record each; eventq short/directedness failures do
  not consume the event; and reset/re-setup clears stale queue views without retaining buffers.
- Observed: the optimized queue suite passed 5/5, followed by 25 consecutive debug invocations
  passing 5/5 each. Used-ring order, `IO_ERR`/zero-length completion behavior, the 256-record cap,
  event retention, and all fifty lifecycle cycles held. The novel tx-only compatibility attack also
  left the eventq buffer untouched and delivered its event exactly once through the event-aware
  entry point.
- Evidence: [`snd-queue-verifier-2026-09-03.txt`](../../evidence/e5-t19c/snd-queue-verifier-2026-09-03.txt),
  SHA-256 `e0b33d10a68bd144c85064193ca90be05e6c3e2b3e496ce1d9fb6d0747c18ca6`.
- Findings: none. The task is verified.
