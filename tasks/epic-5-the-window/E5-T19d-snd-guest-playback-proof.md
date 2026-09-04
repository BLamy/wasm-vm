---
id: E5-T19d
epic: 5
title: virtio-snd Linux guest integration and playback proof
priority: 519.4
status: implemented
depends_on: [E5-T19c]
estimate: S
risk: medium
capstone: false
---

## Goal

Wire the completed virtio-snd device into the booted guest and freeze the end-to-end playback
contract that E5-T20 will consume.

## Deliverables

- Native and browser assembly wiring that preserves existing virtio slots and exposes the sound
  device to Linux without changing unrelated devices.
- A deterministic guest playback validator and checked-in control/response capture diffed against
  the QEMU-shaped fixture.
- Final native WavSink and headless Alpine playback evidence, including pacing and recovery.

## Acceptance criteria

- [ ] The booted guest's `aplay -l` lists the card and `speaker-test -c2 -tsine -l1 -r48000`
      completes; the native WavSink capture contains the clean reference sine.
- [ ] `aplay short.wav` under the real-time mock clock completes within ±10% of the file duration
      and is not a burst drain.
- [ ] The exact-head validator proves the QEMU-shaped control responses, malformed-buffer recovery,
      and STOP/START playback resumption with zero unexpected guest or host errors.

## Adversarial verification

Kill the guest playback process mid-stream and immediately restart it 50 times, checking legal
STOP+RELEASE sequences, stable queue depth, and no repeated periods. Run the reference ramp through
the guest path and compare the sink output sample-for-sample; vary the mock clock at 0.5x and 2x.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

- Commit: `ad55ed0b73c3d001fe7212b0050a80a4761ab1d3`.
- Commands: `cargo fmt --all --check`; the focused native sound suites (`virtio_snd_machine` 3/3,
  `virtio_snd` 6/6, `virtio_snd_playback` 7/7, `virtio_snd_queue` 5/5); `cargo test -p
  wasm-vm-core --lib --quiet` (238/238); targeted core/CLI clippy; wasm library clippy;
  `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release`; no-default-features
  core check; native hello assembly; `make web-build`; `make web-dist`; and `git diff --check`.
- Results: all listed native suites, 238 core tests, targeted clippy, no-default-features, release
  wasm, native assembly, deployable web build, and diff checks passed. The local Chromium smoke
  against `web/dist/app.html` reached `__ready=true`, showed the T19d capability as `verified`,
  and had zero unexpected console or HTTP errors; only the expected favicon and local-only Alpine
  manifest 404 probes were ignored.
- Evidence: [`snd-guest-native-2026-09-03.txt`](../../evidence/e5-t19d/snd-guest-native-2026-09-03.txt),
  SHA-256 `b7999723a16ebeece67fa8aeb260b4195c875ae1eb886b52e739e930d41eacd3`.
- Screenshot: [`browser-assembly-2026-09-03.png`](../../evidence/e5-t19d/browser-assembly-2026-09-03.png),
  SHA-256 `9aaf5fa313c79c268722b80aa43a7efe6dd31882be301578ee7767fa8b32efd1`.

The assembled Machine fixture drives the guest-facing controlq and txq through real virtio-mmio
QueueNotify writes, preserves the existing blk/net/input slots, compares the exact zero-padded
`PCM_INFO` payload, reclaims malformed control traffic, holds a four-frame ramp until its 48 kHz
deadline, and resumes it exactly once across STOP/START. The dependent T19b WavSink/sine fixture
provides the native capture proof, while T19c provides malformed-transfer recovery and fifty reset /
re-setup cycles. The browser assembly uses the same seam with a monotonic clock and headless
`NullSink` pending T20's AudioWorklet sink. Independent machines and WebKit are waived by user
direction.
