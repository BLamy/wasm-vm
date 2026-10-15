---
id: E6-T11d74a
epic: 6
title: Capture and restore quiescent production GPU device state
priority: 525.0270381
status: pending
depends_on: [E5-T26h, E6-T11d71, E6-T11d72, E6-T11d73]
estimate: S
risk: high
capstone: false
---

## Boundary

Add an explicit bounded, versioned native production GPU checkpoint path. Preserve
qualified device/capset identity, original transport/ring positions, control
contexts/resources/backing identities, counters and retained scanout/cursor
metadata. A pending GPU job, mailbox result, lost/poisoned host or invalid profile
must refuse before mutation. Ordinary unsupported 3D snapshot APIs retain their
explicit rejection until the paired host path is ready. No WebGL handle is data.

## Deterministic acceptance

`make verify-E6-T11d74a` records original MMIO/DMA create/attach/submit/scanout
round-trips through native whole-machine save/restore with a quiescent qualified
GPU. Compare exact guest traces/digests, every logical device/ring field and
subsequent original requests in cached/uncached modes. Reject truncation,
corruption, stale keys, foreign profiles and in-flight work failure-atomically.
Run affected fmt/clippy/native/Wasm/no-std and one final pristine clone.

## Adversarial verification

Independently vary resource/backing IDs, epochs, two queues and deadlines. Attack
old completion keys before/after restoration and a result not yet consumed by
Machine.run. Remove one generation/digest/quiescence guard in an isolated copy;
the deterministic original-wire test must fail. Carry unchanged render proofs;
this native boundary does not claim a complete GPU warm boot.

## Verification log

### 2026-10-15 — worker — explicit accelerated warm-boot scope

The user's clarified goal is warm boot with GPU rendering. This is an ordered
implementation boundary of that request, not the cancelled software-default
workaround. Existing independent rendering/timekeeping proofs carry only across
unchanged code and dependency identities; new checkpoint behavior needs its own
recorded acceptance and fresh verifier.
