---
id: E6-T11d74c
epic: 6
title: Restore RAM, disk and reconstructed GPU atomically in the production worker
priority: 525.0270383
status: pending
depends_on: [E6-T11d74b]
estimate: S
risk: high
capstone: false
---

## Boundary

Compose native checkpoint and renderer reconstruction with existing paired RAM
snapshot/disk-overlay coherence. Pause/quiesce without losing original pending
fences, release host inputs and bind schema/build/image/overlay/profile/digests.
Load an accelerated warm pair before guest execution in a fresh production
worker. Publish ready only after real scanout and new original submissions;
failed restore must not half-apply CPU/disk/GPU or silently select software.
Keep legacy software snapshots and explicit cold recovery compatible.

## Deterministic acceptance

`make verify-E6-T11d74c` records actual production-worker save/close/fresh-worker
restore with paired disk marker, native identity, clock rebase, new fenced GPU
frames, trusted keyboard and cursor movement. Test corrupt/mismatched/stale
pairs, lost context and unsupported qualification with explicit results. All
four software warm paths still restore and preserve their disk markers. Run
affected native/Wasm/browser gates and final exact-head pristine clone.

## Adversarial verification

Attack a torn publication between GPU/RAM/delta, concurrent save/restore,
context loss during checkpoint/reconstruction and late old-worker receipts.
Use varied schedules and remove one coherence/generation guard in isolation.
No changed snapshot or persistence boundary may be asserted on screenshots
alone; inspect original device state, outputs and commits.

## Verification log

### 2026-10-15 — worker — explicit accelerated warm-boot scope

The user's clarified goal is warm boot with GPU rendering. This is an ordered
implementation boundary of that request, not the cancelled software-default
workaround. Existing independent rendering/timekeeping proofs carry only across
unchanged code and dependency identities; new checkpoint behavior needs its own
recorded acceptance and fresh verifier.
