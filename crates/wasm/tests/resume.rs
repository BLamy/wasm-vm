//! wasm32 resume-format coverage (E3-T12a). The container parser, the RAM zero-elision codec, and
//! its pre-allocation bound all carry `checked_add` guards written specifically for a 32-bit `usize`
//! (`crates/core/src/resume.rs`), yet the native unit tests only ever exercise them on a 64-bit host.
//! These `wasm_bindgen_test`s run the same code on real wasm32 so the AC's "native/wasm builds"
//! clause is met by execution, not assertion: a RAM snapshot round-trips byte-identically, a hostile
//! run length is refused without allocating, and a reserved-but-unimplemented section fails loudly.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::resume::{
    ComponentSnapshot, SectionReader, SnapshotError, SnapshotWriter, decode_sparse, encode_sparse,
    is_supported_section, section,
};

#[wasm_bindgen_test]
fn ram_snapshot_round_trips_byte_identically_on_wasm32() {
    // Mostly-zero RAM with a few non-zero spans — the realistic snapshot shape. write_slice takes an
    // absolute guest address, so span offsets are added to the RAM base.
    let mut r = Ram::new(1 << 16).unwrap();
    let base = r.base();
    r.write_slice(base + 0x1000, &[1, 2, 3, 4, 5, 6, 7, 8]).unwrap();
    r.write_slice(base + 0xFF00, &[0xAA; 16]).unwrap();

    let snap = r.to_snapshot();
    assert!(snap.len() < r.len() / 4, "zero elision shrank the payload");

    let mut restored = Ram::new(1 << 16).unwrap();
    restored.restore(&snap).unwrap();
    assert_eq!(restored.as_bytes(), r.as_bytes());
    assert_eq!(Ram::SECTION, section::RAM);
}

#[wasm_bindgen_test]
fn sparse_codec_round_trips_and_bounds_a_hostile_run_on_wasm32() {
    for shape in [
        vec![0u8; 4096],
        (0u8..255).collect::<Vec<_>>(),
        [vec![0; 1000], vec![7; 3], vec![0; 500]].concat(),
    ] {
        let dec = decode_sparse(&encode_sparse(&shape), shape.len()).unwrap();
        assert_eq!(dec, shape);
    }

    // A zero-run claiming far more than the declared total must be refused BEFORE the output buffer
    // grows — the 32-bit `checked_add`/bound path this test exists to run.
    let mut enc = vec![0u8]; // CHUNK_ZERO
    enc.extend_from_slice(&u32::MAX.to_le_bytes()); // 4 GiB zero run
    assert_eq!(
        decode_sparse(&enc, 64),
        Err(SnapshotError::SparseRunExceedsTotal)
    );
}

#[wasm_bindgen_test]
fn reserved_section_is_refused_as_unsupported_on_wasm32() {
    assert!(!is_supported_section(section::CPU));
    let mut w = SnapshotWriter::new(&[0xC0; 32], &[0xBA; 32], 1);
    w.section(section::RAM, b"ok");
    w.section(section::CPU, b"reserved");
    let blob = w.finish();
    let (_, reader) = SectionReader::new(&blob).unwrap();
    let results: Vec<_> = reader.collect();
    assert_eq!(results[0].as_ref().unwrap().tag, section::RAM);
    assert_eq!(
        results[1],
        Err(SnapshotError::UnsupportedSection { tag: section::CPU })
    );
}
