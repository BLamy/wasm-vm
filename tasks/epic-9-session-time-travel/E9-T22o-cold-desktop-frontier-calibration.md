---
id: E9-T22o
epic: 9
title: Calibrate the cold Omarchy first-frame frontier from an authenticated prefix
priority: 524.9220298
status: in-progress
depends_on: [E9-T22n, E9-T22q, E9-T22r]
estimate: S
risk: medium
capstone: false
---

## Goal

Determine a defensible finite guest-transition bound for the original Omarchy
desktop after the exact E9-T22r cold recording reached a durable 21.7B
checkpoint before first light and stopped at the 21.75B HostSpace guard.

## Boundary

One offline, non-acceptance diagnostic continuation from the recovered exact
E9-T22r 21.7B checkpoint. Authenticate its complete RAM ancestry,
CPU/device/disk state, host queues, renderer epoch and witness digest from the
exported physical graph before creating a VM. Continue only in a separate
diagnostic owner with no live replay egress. Preserve the failed source report
and its guest disk errors. Do not edit the image, clock, cadence, guest service
files, workload, probe or production replay policy. The continuation is
calibration, never a substitute for the next original cold qualification run.

## Acceptance criteria

- [ ] Authenticate the recovered exact 21.7B saved-graph closure and checkpoint,
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

First run `E9_OUT=target/evidence/e9-t22o-base-prefetch node
tools/verify/e9-cold-base-prefetch.mjs` to materialize and hash every member
of the original frozen image before the browser run. Then run
`E9_SOURCE=target/evidence/e9-t22r-recovery-b481f6c71/desktop
E9_BASE_REPORT=target/evidence/e9-t22o-base-prefetch/progress.json make
verify-E9-T22o` using the pinned recovered E9-T22r graph and recorded
SHA-256 receipts. The target must refuse missing or changed input, including
the complete offline base cache, and produce a bounded browser report with
source and output digests. The browser and guest must remain offline.

## Adversarial verification

Corrupt an unrequested base chunk or RAM delta, swap renderer epochs, alter a
pending input, remove a witness page, and block all network. A continuation
that works only after skipping an authentication boundary does not calibrate
the original guest. Distinguish actual frame presentation from a compositor
process existing without visible pixels.

## Verification log

### 2026-10-26 — worker — blocked on exact GPU notification-latch restore

The original 20B graph authenticated every physical chunk, object, witness
page and checkpoint ancestor. Repro: `node
tools/verify/e9-cold-frontier-browser.mjs --output
target/evidence/e9-t22o-cold395-divergent-state-v2 --limit 20000010000
--restore-mode history`. From the original cold-395 19.8B checkpoint, replay
fails at the next 19.85B witness with original digest
`7967c3dde55a71e77ad05461c6a1b038286fd44fc89dfd909d12dea876974002`
versus `5b2ea2cf90b5b05a3ef21fce4c48e9c37390f7c2bccc85678fd9d47ffd5d989c`.
`target/evidence/e9-t22o-state-diff.json` proves equal RAM, CPU, clock and all
other serialized devices; only `VIRTIO_GPU` differs. The original queue shadow
is `452/452`, replay is `453/452` with one extra pending RESOURCE_FLUSH.
Fresh Daybreak traced the unrecorded dequeue to exact checkpoint restore
unconditionally rearming both GPU notification latches. The v2 checkpoint
does not retain those latches, so a later witness cannot authenticate the
continuation from that checkpoint. The divergent browser report SHA-256 is
`bebdbf1cf874a794cfc65f5656bdf042d8decf88e73a8fc3596b1f835492c41d`;
the section comparison SHA-256 is
`b272b4c2ebaf82e28b68c4dd8e1146069a9f14b881da8e2e66ca003ddf3cc7f5`.
An independent reconstruction of the terminal 20B RAM and logical witness
was admitted; a bounded 50M-transition diagnostic branch reached 20.05B with
no nonblank frame or browser egress (report SHA-256
`adceb24b41adb50a664bbfa8cee7722ab2dc6e993d1b184314eea03a9152f1d3`).
That branch is not accepted as calibration because the latch's value is absent
from the source checkpoint. SHA-256-checked reconstruction of guest RAM's
control ring found avail index `579` while the saved control queue shadow is
`452/452` at all five checkpoints from cold-395 through cold-399. The 127
unserviced descriptors make the omitted latch behaviorally decisive. E9-T22q
must correct exact checkpoint fidelity and E9-T22r must record a new cold
prefix before this task can claim a first-frame bound.
