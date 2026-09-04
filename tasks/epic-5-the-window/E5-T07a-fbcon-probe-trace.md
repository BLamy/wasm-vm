---
id: E5-T07a
epic: 5
title: Guest virtio-gpu fbcon probe and command trace
priority: 507.1
status: in-progress
depends_on: [E5-T03c, E5-T05c, E5-T06d]
estimate: S
risk: high
capstone: false
---

## Goal

Prove the rebuilt Linux graphics stack drives the production virtio-gpu control queue through its
fbcon probe and initial framebuffer setup, with a deterministic native command trace that the later
browser slices can compare.

## Boundary

This slice owns guest-facing command tracing and the native first-light probe harness. It does not
own browser canvas layout, tty input, VT stress, or WebKit/independent-machine coverage.

## Deliverables

- A feature-gated virtio-gpu command-sequence trace that records command type, response, scanout,
  resource dimensions, and queue progress without changing the null-sink semantics.
- A native kernel boot/probe capture and checked-in `tests/fixtures/gpu-probe.log` (or an equivalent
  canonical trace fixture) covering display info/EDID, resource creation/backing, scanout binding,
  transfer, and flush.
- Regression assertions that malformed or unsupported probe traffic still makes queue progress.

## Acceptance criteria

- Native boot reaches a live virtio-gpu controlq and records the expected Linux probe sequence in
  order, with no queue stall, reset loop, or duplicate completion.
- The trace contains the first valid framebuffer resource dimensions and at least one transfer plus
  flush, while the null sink remains side-effect free beyond the trace.
- The exact acceptance command succeeds from the checked-in kernel/artifact inputs.

## Verification command

`make verify-E5-T07a`

## Adversarial verification

Run the probe with the control queue delayed at each command boundary and with one malformed
descriptor in each request class. The guest must continue making progress or report the specified
error, and the trace must never claim a flush that did not publish a used-ring entry.

## Verification log

(empty)
