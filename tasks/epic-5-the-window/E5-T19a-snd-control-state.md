---
id: E5-T19a
epic: 5
title: virtio-snd control protocol and PCM state machine
priority: 519.1
status: verified
depends_on: [E5-T05c]
estimate: S
risk: medium
capstone: false
---

## Goal

Define the guest-visible virtio-snd control contract and make one playback stream's legal
transitions explicit before any host audio timing or browser sink exists.

## Deliverables

- `crates/core/src/dev/virtio/snd/mod.rs` control-plane skeleton for virtio device ID 25.
- Deterministic JACK_INFO, PCM_INFO, and CHMAP_INFO responses for one stereo S16 output stream.
- An explicit RELEASED → SET_PARAMS → PREPARED → RUNNING → STOPPED → RELEASED transition table
  with a checked-in oracle covering every request/state cell.
- Validation for format, rate, channels, buffer size, period size, and stream ID.

## Acceptance criteria

- [ ] The exhaustive native oracle covers all six control requests across all five stream states and
      matches the documented OK/BAD_MSG table exactly.
- [ ] Config responses advertise one output jack, FL/FR, S16, stereo, and only 44.1 kHz/48 kHz;
      unsupported selectors and malformed requests return deterministic errors.
- [ ] `SET_PARAMS` at 96 kHz returns `VIRTIO_SND_S_BAD_MSG` while a subsequent legal setup remains
      usable.

## Adversarial verification

Permute control requests and selectors, repeat SET_PARAMS with boundary-sized buffers, and inject
unknown stream IDs or truncated payloads. The oracle must show no illegal transition, panic, or
state mutation after a rejected request.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

- Commits: `411ac609038dfad39c8f3ad754ca445634314bfd` (implementation) and `ae3d641` (shared-constructor coverage).
- Commands: `cargo fmt --all -- --check`; `cargo test -p wasm-vm-core --test virtio_snd -- --nocapture`; `cargo test -p wasm-vm-core --lib --quiet`; `cargo clippy -p wasm-vm-core --all-targets -- -D warnings`; `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release`; `git diff --check`.
- Results: focused control-plane suite 6/6 passed; core library 238/238 passed; clippy and the release wasm build passed.
- Evidence: [`snd-control-native-2026-09-03.txt`](../../evidence/e5-t19a/snd-control-native-2026-09-03.txt), SHA-256 `ed52f518d2aa366ff76ff7912c555f00e495021903c180d8d29d58a2c3d4ca7f`.

The recorded native run exercises the exact JACK_INFO, PCM_INFO, and CHMAP_INFO wire payloads,
the five-state/six-request oracle, malformed and unsupported control requests, queue/reset
markers, parameter-boundary rejection including 96 kHz, and a legal prepare/start/stop/resume/
release sequence. The independent byte fixtures and state assertions show that rejected requests
do not mutate the stream, while the accepted setup remains usable.

### 2026-09-03 — verifier — VERDICT: verified

- Predictions: every oracle cell remains exact; malformed, truncated, unsupported, invalid-boundary,
  and unknown-stream requests return errors without mutation; the legal lifecycle remains usable.
- Observed: the optimized focused suite passed 6/6, and 25 consecutive debug invocations passed
  6/6 each with no panic or failure. The run covers every changed runtime branch, including the
  shared constructor, queue/reset markers, exact info payloads, validation, and lifecycle paths.
- Evidence: [`snd-control-verifier-2026-09-03.txt`](../../evidence/e5-t19a/snd-control-verifier-2026-09-03.txt), SHA-256 `4362b5a2c684802d38c39ef8605e0a555789d85017a3fdfee397fb5787aa3456`.
- Findings: none. The task is verified.
