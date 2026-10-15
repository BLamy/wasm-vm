---
id: E6-T11d74b
epic: 6
title: Reconstruct a production renderer in a fresh physical GPU context
priority: 525.0270382
status: pending
depends_on: [E6-T11d74a]
estimate: S
risk: high
capstone: false
---

## Boundary

Record a bounded portable reconstruction journal or equivalent logical state
for the actual production bridge, including resource contents, command state,
shaders, transfers, queries and retained scanout. Recreate native WebGL objects
in a fresh qualified context; never serialize or reuse handles. Restore must
validate framing, limits, profile and data identities before publishing an owner.
Captured DMA and completion records may not mutate a restored guest during host
reconstruction. Loss/reset revokes old generations and aborts failed restores.

## Deterministic acceptance

`make verify-E6-T11d74b` records physical GPU draws, exact supported buffer/image
contents, render state and scanout before a checkpoint and after reconstruction
in a fresh context. Subsequent original draws must produce new checked pixels;
include dimensional depth, transform feedback, queries and production transfers.
Record bounded sizes/timeouts and malformed/profile/stale/incomplete refusals,
zero unexpected browser errors and allocation cleanup. Build affected target and
record one final pristine browser proof.

## Adversarial verification

Invent a data/state mutation not covered by the happy path. Check true physical
context identity changes, no stale native handles or completion callbacks, no
self-generated expected pixels, and no replay DMA into resumed RAM. Corrupt one
journal frame/data digest and remove a generation guard in isolated copies;
restoration must fail rather than display a saved screenshot.

## Verification log

### 2026-10-15 — worker — explicit accelerated warm-boot scope

The user's clarified goal is warm boot with GPU rendering. This is an ordered
implementation boundary of that request, not the cancelled software-default
workaround. Existing independent rendering/timekeeping proofs carry only across
unchanged code and dependency identities; new checkpoint behavior needs its own
recorded acceptance and fresh verifier.
