---
id: E5-T26d
epic: 5
title: Virtio-snd stream snapshot and XRUN restore
priority: 526.4
status: in-progress
depends_on: [E5-T26c]
estimate: S
risk: high
capstone: false
---

## Goal

Persist virtio-snd stream configuration and restore running playback through the explicit XRUN
path while keeping host SAB audio rings ephemeral.

## Boundary

Own stream state, period/ring metadata, restore-time XRUN signaling, and empty-ring recovery.
Do not redesign the AudioWorklet, autoplay policy, or the desktop browser flow.

## Acceptance criteria

- Stopped, prepared, and running streams serialize with versioned state and restore to the same
  configuration; running streams restore as XRUN-pending rather than pretending DAC time survived.
- Restored SAB rings are empty, the guest receives the XRUN/report, and one subsequent user
  gesture plus `speaker-test`/reference ramp produces valid audio with no hang or duplicate block.
- Invalid stream ids, rates, formats, and ring lengths fail closed without affecting other streams.

## Verification command

make verify-E5-T26d

## Adversarial verification

Checkpoint during `aplay` with a partially consumed period and during a 500 ms producer stall;
restore repeatedly and require a bounded XRUN recovery or clean failure, never a hung stream.

## Verification log

### 2026-09-07 — worker — STARTED
- Activated on `codex/e5-t26d-sound-snapshot-xrun` above verified T26c (`9a0186ad`).
- Risk: high. The implementation must preserve stopped/prepared/running stream configuration,
  discard host audio-ring contents on restore, and drive a bounded guest-visible XRUN recovery
  without allowing invalid stream metadata to mutate another stream.

### 2026-09-07 — worker — IMPLEMENTED
- Implementation commit: `ca002004650f0f4ec6acf302db871d2308318350`.
- Exact-head evidence: `evidence/e5-t26d/native-final.json`, SHA-256
  `8f8bcf3f3f84b9c6adfe64b9368aec83760b2cfaf27b4118bc7907d7613d6c19`.
- Command: `make verify-E5-T26d` (exit 0). The gate passed format, both GPU-trace clippy
  checks, 5 snapshot tests, 7 control tests, 8 playback tests, 5 queue tests, 9 capture tests,
  4 capture-config tests, 4 machine tests, and the no-default-features `wasm32-unknown-unknown`
  build.
- The versioned `WVSND001` payload stores validated output/capture lifecycle configuration and
  bounded queue metadata while omitting host descriptor chains, PCM frames, and SAB-backed audio
  buffers. Restore validates all fields before mutation, empties both host queues, marks running
  streams for lifecycle rescheduling, and prepends one bounded guest-visible XRUN per running
  stream. The end-to-end playback fixture checkpoints a partially queued ramp, proves the old
  block is never pushed or completed, then posts a fresh ramp that completes exactly once; the
  snapshot unit suite covers stopped/running round-trips, capture repair, malformed params, and
  event-budget atomic refusal.

### 2026-09-07 — verifier — VERDICT: refuted
- P6 invalid ring lengths — FAILED. Predicted a snapshot with one pending transfer and one pending
  byte would be rejected because the decoded playback/capture configuration has a 4096-byte period.
  Both output and capture payloads were accepted, returned a one-transfer discard report, and
  replaced a distinctive prepared target (`target_unchanged=false`). The mutation points are
  `evidence/e5-t26d/verifier/src/main.rs:275-282` and `:306-313`; the insufficient check is
  `crates/core/src/dev/virtio/snd/snapshot.rs:602-615`, followed by mutation at `:356-378`.
  Validate `pending_bytes == pending_count * decoded_period_bytes` with checked arithmetic for both
  streams before assignment, then rerun the prescribed gate and verifier harness.
- P1/P2/P3/P4/P5/P7/P8 — HELD where unchanged. The scrubbed `make verify-E5-T26d` gate passed; the
  public-API harness preserved prepared/stopped/running and duplex configuration, emptied restored
  host queues, emitted bounded repair XRUNs, rejected 40 other malformed ID/rate/format/header/event
  cases atomically, and completed 64 restore/service cycles after a 500 ms clock advance with one
  fresh 1024-frame ramp and no duplicate audio.
- COVERAGE — the Makefile target, direct/device wrappers, lifecycle encode/restore, header/stream/
  queue/event decoder classes, all five new unit tests, and the partial-playback integration test
  executed. Fixed-bound arithmetic/allocation failure arms and invalid in-memory encoder states are
  waived as unreachable defensive paths; the queue validation hunk executed and was refuted.
- Evidence: `evidence/e5-t26d/verifier/attack-plan.md`, `results.md`, and the locked Rust harness.
  Exact implementation `ca002004650f0f4ec6acf302db871d2308318350`; inspected branch head
  `7e436d99d1b0cdf4b1f50295b055433908a51e16`; worker evidence SHA-256
  `8f8bcf3f3f84b9c6adfe64b9368aec83760b2cfaf27b4118bc7907d7613d6c19`.
- SUITE: retain the verifier harness as the remediation regression. No implementation test promoted
  until the semantic refutation clears. Host rr, independent-machine, and WebKit runs waived by
  repository policy and user direction.
