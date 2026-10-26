---
id: E9-T22o
epic: 9
title: Calibrate the cold Omarchy first-frame frontier from an authenticated prefix
priority: 524.9220298
status: pending
depends_on: [E9-T22n]
estimate: S
risk: medium
capstone: false
---

## Goal

Determine a defensible finite guest-transition bound for the original Omarchy
desktop after the clean E9-T22c run reached 20B transitions before first light.

## Boundary

One offline, non-acceptance diagnostic continuation from the authenticated
20B checkpoint. Reconstruct its complete RAM ancestry, CPU/device/disk state,
host queues, renderer epoch and witness digest from the exported physical graph
before creating a VM. Continue only in a separate diagnostic owner with no
live replay egress. Do not edit the image, clock, cadence, guest service files,
workload, probe or production replay policy. The continuation is calibration,
never a substitute for the next original cold qualification run.

## Acceptance criteria

- [ ] Authenticate the exact 20B saved-graph closure and the chosen checkpoint,
  including every physical chunk/object, RAM ancestor digest, renderer bytes,
  disk root and witness membership, before continuation.
- [ ] Run a bounded offline continuation to a real nonblank Omarchy frame, or
  retain an exact failure frontier with guest session/process, GPU and host
  presentation evidence that identifies the next concrete obstruction.
- [ ] Record the first-frame position if reached, runtime/guest progress, storage
  growth and a conservative finite bound recommendation. Preserve the source
  graph and zero live replay egress. A fresh Daybreak critic independently
  attacks the reconstruction and conclusion.

## Deterministic acceptance

`make verify-E9-T22o` using the pinned E9-T22c 20B saved graph and its recorded
SHA-256 receipts. The target must refuse missing or changed input and produce a
bounded browser report with source and output digests.

## Adversarial verification

Corrupt an unrequested base chunk or RAM delta, swap renderer epochs, alter a
pending input, remove a witness page, and block all network. A continuation
that works only after skipping an authentication boundary does not calibrate
the original guest. Distinguish actual frame presentation from a compositor
process existing without visible pixels.

## Verification log
