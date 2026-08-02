---
id: E3-T12c3
epic: 3
title: Overlay-generation snapshot coherence and stale-restore refusal
priority: 321.933
status: verified
depends_on: [E3-T12c1, E3-T10]
estimate: S
risk: medium
capstone: false
---

## Goal
Bind every snapshot to the exact base image and overlay generation it was taken against, and refuse —
before mutating any machine state — to restore a snapshot onto a diverged disk. A resumed CPU/RAM must
never land on an overlay the guest's page cache disagrees with (silent corruption).

## Context
The resume header already carries `core_hash` / `base_image_hash` / `overlay_generation` and
`SnapshotHeader::validate_for` refuses a mismatch (E3-T12a). This ticket makes it real end-to-end: the
overlay generation is a persisted, monotonic counter that advances as the overlay commits; the header
binds the CURRENT generation at save time; and `load_resume` validates base+generation FIRST, returning
a typed error with NO component restored on mismatch (all-or-nothing at the machine level for the
coherence guard). Distinct from E3-T12c2 (in-flight quiesce) and E3-T12c1 (device serialization).

## Deliverables
- A persisted, monotonic overlay-generation binding surfaced to `save_resume` and checked by
  `load_resume` before any section is applied.
- Typed refusals: `BaseImageMismatch`, `OverlayGenerationMismatch` — returned before machine mutation.
- Tests: a snapshot restored against the matching base+generation succeeds; against a bumped generation
  or a different base hash it fails, and the target machine is byte-identical to its pre-restore state.

## Acceptance criteria
- [x] `make verify-E3-T12c3`: restore against a changed base hash OR a bumped overlay generation fails
  with the typed error BEFORE any CPU/RAM/device mutation (the target is unchanged).
- [x] A matching base+generation restore succeeds and resumes.
- [x] Restoring the same snapshot twice is refused the second time if the overlay advanced in between.

## Adversarial verification
Alter the overlay generation after snapshot and restore; restore the same snapshot twice; corrupt the
base hash. Any stale-overlay resume, half-applied restore on a coherence failure, or generation that
fails to advance refutes.

## Verification log
- 2026-08-02 — `make verify-E3-T12c3`: **OK** (native + wasm32). Implementation:
  - `Machine` gains a `SnapshotCoherence { core_hash, base_image_hash, generation }` binding
    (`crates/core/src/lib.rs`). `set_snapshot_identity()` binds build + base image;
    `advance_overlay_generation()` is the monotonic, saturating overlay-commit counter (the persist
    pump calls it on each durable commit); `overlay_generation()` / `snapshot_coherence()` expose it.
    Defaults all-zero / generation 0, so the RAM-only harness round-trips against an identical binding.
  - `save_resume` now stamps the real `core_hash` / `base_image_hash` / `generation` into the header
    (was hardcoded zeros).
  - `load_resume` runs `SnapshotHeader::validate_for` FIRST — before the section loop touches any
    component — so a `BaseImageMismatch` / `OverlayGenerationMismatch` / `CoreHashMismatch` is refused
    with the target machine byte-identical to its pre-restore state (machine-level all-or-nothing).
  - Test `crates/core/tests/snapshot_coherence.rs` (5 cases): matching base+generation resumes and the
    source RAM marker lands (AC2); a changed base hash and a bumped generation each refuse with the
    typed error and leave the target RAM untouched (AC1); the same blob is refused on the second
    restore once the generation advanced (AC3); the counter is monotonic/saturating.
  - Existing `cpu_resume` / wasm `resume` round-trips (default coherence on both sides) still green.
