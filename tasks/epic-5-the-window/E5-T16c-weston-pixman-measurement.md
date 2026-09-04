---
id: E5-T16c
epic: 5
title: Measure weston with the pixman renderer inside the emulator
priority: 516.3
status: in-progress
depends_on: [E5-T16b]
estimate: S
risk: medium
capstone: false
---

## Goal

Bring up weston as the second T16 finalist on a throwaway Alpine riscv64 image and record the
identical end-to-end workload under weston's software pixman renderer.

## Boundary

This slice owns only the weston candidate bring-up and its capture. It does not change the shared
workload contract, choose a winner, or publish the final decision.

## Deliverables

- A scripted scratch-image bring-up using `weston --backend=drm --renderer=pixman` on the
  emulator's DRM/virtio-gpu path, with renderer diagnostics captured.
- The same T16a workload result: cold start to idle, terminal launch, 100 typed characters,
  300 px drag, close, and all required guest/host counters.
- Evidence containing the exact command line, image manifest, renderer, phase markers, upload
  bytes, peak RSS, idle wakeups/s, and any cursorq observations.

## Acceptance criteria

- Weston completes every workload phase inside the emulator with actual measured values; the
  result is schema-valid and directly comparable to E5-T16b.
- The capture proves pixman was active and does not count a GL startup failure, a host-native run,
  or an extrapolated row as the weston measurement.
- Idle instruction cost, typing upload bytes, peak RSS, and idle wakeups/s are explicitly present;
  an idle cost above 2% is disqualified or justified in the eventual decision inputs.
- The weston result is reproducible from its committed scratch-image/config manifest and passes
  the shared T16a phase and counter checks.

## Verification command

`make verify-E5-T16c`

## Adversarial verification

Check the weston command line and startup log for `--renderer=pixman`, then repeat the typing and
drag workload after a cold reset. Remove the renderer flag in a test copy and ensure the harness
rejects the result instead of accepting a possibly-GL or failed-start capture. Verify all damage
bytes come from T09 counters for this run.

## Verification log

(empty)
