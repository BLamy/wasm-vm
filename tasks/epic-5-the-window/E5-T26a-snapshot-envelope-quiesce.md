---
id: E5-T26a
epic: 5
title: Versioned desktop snapshot envelope and quiesce boundary
priority: 526.1
status: pending
depends_on: [E5-T18e, E5-T20e]
estimate: S
risk: high
capstone: false
---

## Goal

Create the versioned desktop-device snapshot envelope and the atomic quiesce/checkpoint
boundary that later GPU, input, sound, and agent slices use.

## Boundary

Own section framing, per-device version tags, component digests, bounded quiesce at a
virtqueue boundary, and forward-version refusal. Do not add GPU, input, sound, or browser
restore payloads.

## Acceptance criteria

- A deterministic native fixture serializes an empty and populated envelope byte-for-byte,
  including component versions and a stable digest.
- Snapshot requests wait for a bounded device boundary, reject in-flight/half-processed
  control work, and leave the device usable after abort.
- Truncated, duplicate, unknown, and newer-version sections fail closed without mutating
  the live machine; the exact error is machine-readable.

## Verification command

make verify-E5-T26a

## Adversarial verification

Inject malformed lengths, an unknown section version, and a snapshot request during a control
queue operation. Verify no partial snapshot is published and the next ordinary device request
still completes.

## Verification log

(empty)
