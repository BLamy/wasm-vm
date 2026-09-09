---
id: E5-T26g
epic: 5
title: Desktop snapshot stress, versioning, size, and portability proof
priority: 526.7
status: pending
depends_on: [E5-T26f]
estimate: S
risk: high
capstone: false
---

## Goal

Close the desktop snapshot slice with deterministic stress, version-refusal, differential, size,
and multi-tab evidence.

## Boundary

Own only the adversarial proof and measured report over the completed snapshot implementation.
Do not change runtime semantics except for fixes directly refuted by this harness.

## Acceptance criteria

- Two hundred snapshots taken at 10 ms intervals during drag, `aplay`, and resize activity all
  restore to a working desktop; no control queue, stream, or frame hangs.
- A yesterday-format fixture is refused cleanly; 1000 identical deterministic input events before
  and after restore converge to the same final screen CRC; the same snapshot works in two tabs
  without shared mutable host residue.
- The report records the desktop-versus-headless size delta and exercises a different window size
  with both letterbox and T22 resize paths.

## Verification command

make verify-E5-T26g

## Adversarial verification

Vary snapshot timing seeds, corrupt one section per run, restore concurrently in two tabs, and
force audio/agent/resize interruptions. Any divergence, hang, or unbounded recovery is a finding.

## Verification log

(empty)
