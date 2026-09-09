---
id: E5-T21d
epic: 5
title: Lazy microphone permission and silence fallback
priority: 521.4
status: verified
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

### 2026-09-04 — verifier — VERDICT: verified
- Lazy permission — HELD. The exact-head harness observed zero `getUserMedia` calls and `off` before
  capture PCM_START, then one shared request through a logical 30-second delay with zero queued
  frames before grant; duplicate start observations did not duplicate the stream or listeners.
- Failure/recovery lifecycle — HELD. Native capture evidence completed short source periods with
  zero-filled PCM, `Ok` status, and a bounded input PCM_XRUN event. Chromium and the deterministic
  browser harness held denial/no-device as `denied`, mute/end as drained `revoked`, removed all
  three track listeners on end, and re-granted on the next guest start generation without an
  uncaught host exception.
- Exact-head coverage — HELD. The recorded run exercised the new PCM_START edge, capture SAB
  attachment, worker notification path, permission controller, UI indicator, mute/end/retry paths,
  and the generated `web/dist` artifacts. Source/dist parity and all affected checks passed.
Commands: `env -i PATH="$PATH" node tools/verify/e5-t21d-microphone-permission.mjs`; `cargo test -p wasm-vm-core --test virtio_snd_capture --test virtio_snd_capture_config`; `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8151 PLAYWRIGHT_REUSE_SERVER=0 ./node_modules/.bin/playwright test tests/e5-t21d-microphone-permission.spec.js --workers=1`
Evidence: [microphone-permission-2026-09-04.txt](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t21d/microphone-permission-2026-09-04.txt), [microphone-permission-2026-09-04.png](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t21d/microphone-permission-2026-09-04.png)
