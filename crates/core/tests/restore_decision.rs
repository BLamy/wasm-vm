//! E3-T12d — the typed resume-vs-cold-boot decision for a persisted snapshot.
//!
//! The browser persistence layer must, on reload, decide whether a stored snapshot is safe to resume
//! or must be discarded for a cold boot — and, when discarding, say WHY with a typed reason (not a
//! free-form string). This proves the header-level decision partitions the whole failure space:
//!   - nothing stored            → ColdBoot(Missing)
//!   - a coherent, matching blob → Resume
//!   - bad magic / truncated / wrong version / garbage → ColdBoot(Corrupt)
//!   - a different build hash     → ColdBoot(ForeignBuild)
//!   - a different base image     → ColdBoot(ForeignImage)
//!   - a bumped overlay generation→ ColdBoot(Stale)
//!
//! and that a restore-time SnapshotError maps onto the same reason space.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::resume::{ColdBootReason, RestoreDecision, SnapshotError, SnapshotWriter};

const CORE: [u8; 32] = [0xC0; 32];
const BASE: [u8; 32] = [0xBA; 32];
const GEN: u64 = 7;

/// A minimal but well-formed snapshot blob (header only, no sections) stamped with the given identity.
fn blob(core: [u8; 32], base: [u8; 32], generation: u64) -> Vec<u8> {
    SnapshotWriter::new(&core, &base, generation).finish()
}

#[test]
fn nothing_stored_is_missing() {
    let d = RestoreDecision::decide(None, &CORE, &BASE, GEN);
    assert_eq!(d, RestoreDecision::ColdBoot(ColdBootReason::Missing));
    assert_eq!(d.code(), "missing");
    assert!(!d.is_resume());
}

#[test]
fn coherent_blob_resumes() {
    let b = blob(CORE, BASE, GEN);
    let d = RestoreDecision::decide(Some(&b), &CORE, &BASE, GEN);
    assert_eq!(d, RestoreDecision::Resume);
    assert_eq!(d.code(), "resume");
    assert!(d.is_resume());
}

#[test]
fn foreign_build_is_rejected() {
    let b = blob([0xFF; 32], BASE, GEN);
    let d = RestoreDecision::decide(Some(&b), &CORE, &BASE, GEN);
    assert_eq!(d, RestoreDecision::ColdBoot(ColdBootReason::ForeignBuild));
    assert_eq!(d.code(), "foreign_build");
}

#[test]
fn foreign_image_is_rejected() {
    let b = blob(CORE, [0xFF; 32], GEN);
    let d = RestoreDecision::decide(Some(&b), &CORE, &BASE, GEN);
    assert_eq!(d, RestoreDecision::ColdBoot(ColdBootReason::ForeignImage));
    assert_eq!(d.code(), "foreign_image");
}

#[test]
fn stale_generation_is_rejected_with_both_values() {
    let b = blob(CORE, BASE, GEN);
    // The live overlay has advanced past the snapshot's generation.
    let d = RestoreDecision::decide(Some(&b), &CORE, &BASE, GEN + 3);
    assert_eq!(
        d,
        RestoreDecision::ColdBoot(ColdBootReason::Stale {
            snapshot: GEN,
            current: GEN + 3,
        })
    );
    assert_eq!(d.code(), "stale");
}

#[test]
fn truncated_blob_is_corrupt() {
    let b = blob(CORE, BASE, GEN);
    let d = RestoreDecision::decide(Some(&b[..b.len() - 10]), &CORE, &BASE, GEN);
    assert_eq!(d, RestoreDecision::ColdBoot(ColdBootReason::Corrupt));
}

#[test]
fn empty_blob_is_corrupt_not_missing() {
    // A present-but-empty stored value is a corrupt blob, distinct from "nothing stored".
    let d = RestoreDecision::decide(Some(&[]), &CORE, &BASE, GEN);
    assert_eq!(d, RestoreDecision::ColdBoot(ColdBootReason::Corrupt));
}

#[test]
fn bad_magic_is_corrupt() {
    let mut b = blob(CORE, BASE, GEN);
    b[0] ^= 0xFF; // corrupt the magic
    let d = RestoreDecision::decide(Some(&b), &CORE, &BASE, GEN);
    assert_eq!(d, RestoreDecision::ColdBoot(ColdBootReason::Corrupt));
}

#[test]
fn wrong_version_is_corrupt() {
    let mut b = blob(CORE, BASE, GEN);
    b[8] = 0xFE; // bump format_version (LE low byte) to an unsupported value
    let d = RestoreDecision::decide(Some(&b), &CORE, &BASE, GEN);
    assert_eq!(d, RestoreDecision::ColdBoot(ColdBootReason::Corrupt));
}

#[test]
fn coherence_precedence_matches_validate_for() {
    // When build, image AND generation all differ, the decision reports the FIRST guard
    // (build) — the same precedence load_resume's validate_for enforces.
    let b = blob([0x11; 32], [0x22; 32], GEN + 1);
    let d = RestoreDecision::decide(Some(&b), &CORE, &BASE, GEN);
    assert_eq!(d, RestoreDecision::ColdBoot(ColdBootReason::ForeignBuild));
}

#[test]
fn snapshot_error_maps_onto_reason_space() {
    // The restore path (load_resume) can fail AFTER a Resume verdict on a section-level defect; those
    // errors must land in the same typed reason space so the fallback reason is uniform.
    assert_eq!(
        ColdBootReason::from_snapshot_error(&SnapshotError::CoreHashMismatch),
        ColdBootReason::ForeignBuild
    );
    assert_eq!(
        ColdBootReason::from_snapshot_error(&SnapshotError::BaseImageMismatch),
        ColdBootReason::ForeignImage
    );
    assert_eq!(
        ColdBootReason::from_snapshot_error(&SnapshotError::OverlayGenerationMismatch {
            snapshot: 2,
            current: 5
        }),
        ColdBootReason::Stale {
            snapshot: 2,
            current: 5
        }
    );
    // Everything non-coherence collapses to Corrupt.
    for err in [
        SnapshotError::Truncated,
        SnapshotError::BadMagic,
        SnapshotError::VersionMismatch {
            found: 9,
            supported: 1,
        },
        SnapshotError::UnknownSection { tag: 99 },
        SnapshotError::UnsupportedSection { tag: 10 },
        SnapshotError::SectionLengthOverflow { tag: 2 },
        SnapshotError::BadSparseEncoding,
        SnapshotError::SparseRunExceedsTotal,
        SnapshotError::BadComponentState { tag: 1 },
    ] {
        assert_eq!(
            ColdBootReason::from_snapshot_error(&err),
            ColdBootReason::Corrupt,
            "{err:?} should map to Corrupt"
        );
    }
}
