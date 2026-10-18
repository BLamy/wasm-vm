---
id: E9-T14
epic: 9
title: Replay recorded sessions and detect the first divergence
priority: 524.914
status: in-progress
depends_on: [E9-T05, E9-T10, E9-T11, E9-T12, E9-T13]
estimate: S
risk: high
capstone: false
---

## Goal

Re-execute a recorded software VM from its starting checkpoint using only recorded external inputs.

## Boundary

The replay driver, intent matching, exact event consumption and state-digest comparison. Runtime JIT artifacts may be rebuilt; observable guest behavior must remain identical.

## Acceptance criteria

- [ ] Original and replayed CPU/RAM/device/disk digests match at selected event positions in native and built-browser runs, with interpreter and JIT.
- [ ] Replay completion and trace exhaustion stop at the declared end; switching to live execution requires an explicit separate branch action.
- [ ] Report the first missing/extra/misordered event or digest mismatch with its exact position; retain the recording and do not conceal drift by loading a later checkpoint.

## Deterministic acceptance

`make verify-E9-T14`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Corrupt one event or omit one DMA payload, then vary execution quanta and host schedules. Require a precise divergence instead of an apparently successful replay.

## Verification log

(pending; no implementation or verification claim)
