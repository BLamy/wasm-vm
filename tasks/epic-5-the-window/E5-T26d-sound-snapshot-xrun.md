---
id: E5-T26d
epic: 5
title: Virtio-snd stream snapshot and XRUN restore
priority: 526.4
status: implemented
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
