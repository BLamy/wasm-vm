---
id: E9-T22u
epic: 9
title: Measure the cold desktop after the session block-transfer correction
priority: 524.92202988
status: in-progress
depends_on: [E9-T22t]
estimate: S
risk: high
capstone: false
---

## Goal

Record the original Omarchy cold boot again with the corrected session block
transfer boundary, then establish its first real nonblank frame or the next
exact failure frontier. The previous 21.7B checkpoint followed a guest disk
write error at 14.365B and cannot serve as a clean continuation source.

## Boundary

One fresh, bounded diagnostic prefix from transition zero in a new browser
profile, with the frozen image, kernel, bootargs, ICount/64 clock, 50M
checkpoint cadence, service files, renderer and workload unchanged. The prior
source graphs remain immutable. Change only the diagnostic finite transition,
wall and capacity admission to cover the post-fix observation window. This is
not the full E9-T22c qualification, a timing result, or an allowance for it.

## Acceptance criteria

- [ ] Preflight the new finite limit from measured 20B and 25.2B rates,
  16 GiB retention, browser quota and host space for a live profile plus an
  independent export, with explicit reserves. Reject insufficient capacity
  before launching the long run.
- [ ] Record the original cold guest from zero through a real nonblank frame
  or an exact bounded frontier. Show whether the formerly failing 1,179,648-
  byte virtio-blk write now completes successfully in the guest; preserve
  guest serial, disk, session, process and physical renderer evidence.
- [ ] Authenticate the exported graph and replay two adjacent checkpoint
  windows to exact witnesses without live replay egress. A fresh Daybreak
  verifier attacks the source pins, disk conclusion, frame classification,
  capacity and exact replay independently.

## Deterministic acceptance

`make verify-E9-T22u` on a clean exact head, with a unique `E9_OUT` directory.

## Adversarial verification

Try the old 1 MiB transfer cap, a changed image or workload, omitted graph
chunks, a blank scanout misclassified as a frame, low quota, low disk, and a
replay that silently fetches base data. Refuse a recovered checkpoint whose
guest already observed the earlier disk failure. If the run ends without a
frame, cite the exact position and next concrete obstruction rather than
claiming a supported allowance.

## Verification log
