---
id: E5-T26a
epic: 5
title: Versioned desktop snapshot envelope and quiesce boundary
priority: 526.1
status: implemented
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

### 2026-09-06 — worker — IMPLEMENTED

Worker commit `5defbabf` adds `crates/core/src/desktop_snapshot.rs` as a separate, no-std-compatible
desktop envelope rather than changing the frozen E3 whole-machine resume format. The canonical
header carries a boundary id and section table length; each reserved GPU/input/sound/agent section
has an explicit version, bounded length, and SHA-256 component digest; the envelope has a SHA-256
trailer. `DesktopSnapshot::parse` owns all validation before a caller can obtain restore payloads,
and exposes stable `DesktopSnapshotError::code()` values for fail-closed diagnostics. The generic
`SnapshotQuiesceDevice`/`SnapshotQuiesce` seam services bounded device boundaries, rejects residual
in-flight work, and calls the participant abort hook before returning a timeout so ordinary queue use
is reopened.

Exact-head evidence: `evidence/e5-t26a/native-final.json` (SHA-256
`3621a7e92ac4f9237e44c2be78c1d5f8327f278b5a1cd2c5273ab09ebe10a8d2`). Final command was
`make verify-E5-T26a` at commit `5defbabf`: fmt and both clippy checks
passed; the deterministic desktop fixture passed 9/9 tests; the existing virtio-blk quiesce gate
passed 3/3; CPU/resume regression passed 6/6; and the no-default-features `wasm32-unknown-unknown`
build passed. The fixture asserts byte-exact empty/populated bytes, stable section/envelope digests,
truncated/duplicate/unknown/newer-version refusal without live-state mutation, and post-abort
ordinary-request usability. GPU/input/sound/agent payload semantics remain out of scope for their
ordered T26b–T26e slices. A fresh Daybreak verifier must set the terminal status.
