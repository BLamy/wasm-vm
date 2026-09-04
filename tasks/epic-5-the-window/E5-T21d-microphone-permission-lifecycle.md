---
id: E5-T21d
epic: 5
title: Lazy microphone permission and silence fallback
priority: 521.4
status: in-progress
depends_on: [E5-T21c]
estimate: S
risk: high
capstone: false
---

## Goal

Connect capture PCM_START to a lazy `getUserMedia` request and make denied, missing, muted, or
revoked tracks behave as a correctly paced digital-silence source with honest UI state.

## Boundary

This slice owns the main/worker permission state machine, indicator states, track lifecycle events,
silence fallback, and eventq notification. It does not own the final `arecord` WAV/FFT proof or
full-duplex guest workload.

## Deliverables

- A permission adapter invoked only by capture PCM_START when `enable_mic` is true.
- `off`, `live`, `denied`, and `revoked` indicator states with no uncaught host exception.
- Deterministic browser harness hooks for delayed grant, denial, mute, track end, and retry.

## Acceptance criteria

- [ ] A session that never starts capture makes zero `getUserMedia` calls and shows the microphone as
      off; playback remains unaffected.
- [ ] Denial or no-device returns paced zero frames, a completed capture stream, and a denied state;
      revocation/mute switches to silence, notifies the guest, and permits a later retry.
- [ ] A permission response delayed by 30 seconds leaves the capture timeline continuous with silence
      before grant and no duplicate streams or listeners after re-grant.

## Verification command

`node tools/verify/e5-t21d-microphone-permission.mjs`

## Adversarial verification

Spy on every `getUserMedia` call before PCM_START, delay the permission response, deny twice, revoke
mid-stream, and re-grant without reload. Check wall-clock frame counts, UI state, eventq records, and
listener cardinality after each transition.

## Verification log

(empty)
