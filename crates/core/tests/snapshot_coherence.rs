//! E3-T12c3 — overlay-generation snapshot coherence and stale-restore refusal.
//!
//! A snapshot is bound to the exact base image + overlay generation it was taken against. Restoring
//! it onto a diverged disk (changed base hash, or a bumped overlay generation) is refused BEFORE any
//! component is mutated — a resumed CPU/RAM must never land on an overlay the guest's page cache
//! disagrees with. This proves:
//!   - a matching base+generation restore succeeds and resumes;
//!   - a changed base hash OR a bumped generation fails with the typed error, target unchanged;
//!   - restoring the same snapshot twice is refused the second time if the overlay advanced between.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::platform::virt;
use wasm_vm_core::resume::SnapshotError;

const RAM: usize = 1 << 20;

/// A machine with a distinctive RAM word so a restore's effect (or lack of it) is observable.
fn machine(core: [u8; 32], base: [u8; 32], marker: u64) -> Machine {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.set_snapshot_identity(core, base);
    m.bus_mut()
        .store64(virt::DRAM_BASE + 0x2000, marker)
        .unwrap();
    m
}

fn marker(m: &mut Machine) -> u64 {
    m.bus_mut().load64(virt::DRAM_BASE + 0x2000).unwrap()
}

const CORE: [u8; 32] = [0x11; 32];
const BASE: [u8; 32] = [0x22; 32];

/// AC2: a snapshot restored against a machine bound to the SAME base + generation succeeds, and the
/// restored RAM marker matches the source (the resume actually took effect).
#[test]
fn matching_base_and_generation_restores() {
    let mut src = machine(CORE, BASE, 0xA11CE);
    let blob = src.save_resume().unwrap();

    let mut dst = machine(CORE, BASE, 0xDEAD);
    dst.load_resume(&blob).expect("matching coherence restores");
    assert_eq!(marker(&mut dst), 0xA11CE, "resume applied the source RAM");
}

/// AC1: a restore against a DIFFERENT base image hash is refused with `BaseImageMismatch` before any
/// mutation — the target machine is byte-identical to its pre-restore state.
#[test]
fn changed_base_hash_is_refused_before_mutation() {
    let mut src = machine(CORE, BASE, 0xA11CE);
    let blob = src.save_resume().unwrap();

    let other_base = [0x99; 32];
    let mut dst = machine(CORE, other_base, 0xDEAD);
    let before = marker(&mut dst);
    assert_eq!(
        dst.load_resume(&blob),
        Err(SnapshotError::BaseImageMismatch),
        "a foreign base image is refused"
    );
    assert_eq!(marker(&mut dst), before, "target RAM untouched on refusal");
    assert_eq!(before, 0xDEAD);
}

/// AC1: a restore against a BUMPED overlay generation is refused with `OverlayGenerationMismatch`
/// before any mutation — the resumed CPU/RAM must not land on a newer overlay.
#[test]
fn bumped_overlay_generation_is_refused_before_mutation() {
    let mut src = machine(CORE, BASE, 0xA11CE); // generation 0 at save time
    let blob = src.save_resume().unwrap();

    let mut dst = machine(CORE, BASE, 0xDEAD);
    dst.advance_overlay_generation(); // the overlay committed since the snapshot → now generation 1
    assert_eq!(dst.overlay_generation(), 1);
    let before = marker(&mut dst);
    assert_eq!(
        dst.load_resume(&blob),
        Err(SnapshotError::OverlayGenerationMismatch {
            snapshot: 0,
            current: 1,
        }),
        "a stale-overlay resume is refused"
    );
    assert_eq!(marker(&mut dst), before, "target RAM untouched on refusal");
}

/// AC3: restoring the same snapshot twice is refused the second time if the overlay advanced in
/// between — the generation binding is monotonic, so a pre-commit snapshot can't reapply post-commit.
#[test]
fn same_snapshot_refused_after_overlay_advances() {
    let mut m = machine(CORE, BASE, 0xA11CE);
    let blob = m.save_resume().unwrap();

    // First restore (generation still 0) succeeds.
    m.load_resume(&blob)
        .expect("first restore at matching generation");

    // The overlay commits → generation advances. The SAME blob (bound to generation 0) is now stale.
    m.advance_overlay_generation();
    assert_eq!(
        m.load_resume(&blob),
        Err(SnapshotError::OverlayGenerationMismatch {
            snapshot: 0,
            current: 1,
        }),
        "the second restore is refused once the overlay advanced"
    );
}

/// The generation counter is monotonic and saturating — it only ever advances.
#[test]
fn overlay_generation_is_monotonic() {
    let mut m = machine(CORE, BASE, 0);
    assert_eq!(m.overlay_generation(), 0);
    assert_eq!(m.advance_overlay_generation(), 1);
    assert_eq!(m.advance_overlay_generation(), 2);
    assert_eq!(m.overlay_generation(), 2);
}
