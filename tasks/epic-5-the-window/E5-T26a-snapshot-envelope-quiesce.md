---
id: E5-T26a
epic: 5
title: Versioned desktop snapshot envelope and quiesce boundary
priority: 526.1
status: verified
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

### 2026-09-06 — verifier — VERDICT: verified

- P1 canonical envelopes and digests — HELD. Predicted repeated empty and populated
  serialization would match fixed canonical bytes, expose explicit version-1 component framing,
  preserve both SHA-256 component digests and the envelope trailer, and round-trip byte-for-byte.
  The fixed empty/populated vectors and parse/re-encode assertions passed
  (`crates/core/src/desktop_snapshot_tests.rs`:18-67), exercising the builder/digest path
  (`crates/core/src/desktop_snapshot.rs`:136-153,305-383).
- P2 bounded quiesce and recovery — HELD. Predicted queued work would consume one bounded
  service pass before a permit, no second request would cross an active boundary, permanently
  in-flight work would consume exactly its three-pass budget and abort once, and an ordinary
  request would then succeed. All values held, including explicit-abort idempotence and stale
  permit refusal (`desktop_snapshot_tests.rs`:181-305; coordinator
  `desktop_snapshot.rs`:386-515). Existing `virtio_blk_quiesce` remained 3/3 green.
- P3 parse-before-mutate refusal — HELD. Predicted truncation, malformed table/payload lengths,
  duplicate and unknown tags, unknown section/envelope versions, and component/envelope digest
  tampering would return typed stable errors before changing the live sentinel. The committed
  attacks passed (`desktop_snapshot_tests.rs`:69-179,307-322) against the validation-before-
  construction path (`desktop_snapshot.rs`:164-269). A fresh forged `u32::MAX` payload-length
  attack independently returned `section_length_overflow` with marker `0xfeedbeef` unchanged
  (`evidence/e5-t26a/verifier/forged-length.log`). No partial snapshot API is reachable before
  `SnapshotQuiesce::request` grants an idle-boundary permit.
- P4 exact-head prescribed gate — HELD. Predicted evidence head
  `0274285f77f4bdfcaede1460a177b0884a77471c` would retain implementation
  `5defbabf3972e3f00d6cb22e14956517fb33f04b` and pass the complete local recipe. Fresh
  `make verify-E5-T26a` passed fmt, both clippy modes, 9/9 desktop tests, 3/3 virtio-quiesce
  tests, 6/6 CPU/resume tests, and the no-default-features `wasm32-unknown-unknown` build
  (`Makefile`:1022-1036). Worker evidence SHA-256 independently matched
  `3621a7e92ac4f9237e44c2be78c1d5f8327f278b5a1cd2c5273ab09ebe10a8d2`
  (`evidence/e5-t26a/native-final.json`:1-16).
- COVERAGE — HELD for canonical serialization, successful/failed parsing, stable error codes,
  queued/in-flight/active/abort/release quiesce paths, public module export, regression gates,
  and native plus no-std wasm compilation. WAIVED only for declarative reserved SOUND/AGENT
  identifiers, defensive allocation ceilings that cannot be constructed with the four unique
  current tags, and GPU/input/sound/agent payload semantics explicitly assigned to T26b–T26e.
  Browser, independent-machine, WebKit, ssh/rr, and device-payload proof are outside this slice.
- SUITE: retain the nine deterministic envelope/quiesce tests, the existing virtio/CPU resume
  regressions, the wasm no-std build, and the verifier forged-length seed. Commands:
  `git diff --check 5defbabf^ 5defbabf`; `make verify-E5-T26a`; offline temporary path-dependent
  verifier binary for the forged-length mutation; evidence SHA-256 audit.
