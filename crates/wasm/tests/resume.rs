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
    // CPU landed in E3-T12b; the virtio sections are still reserved-but-unimplemented.
    assert!(!is_supported_section(section::VIRTIO_RNG));
    let mut w = SnapshotWriter::new(&[0xC0; 32], &[0xBA; 32], 1);
    w.section(section::RAM, b"ok");
    w.section(section::VIRTIO_RNG, b"reserved");
    let blob = w.finish();
    let (_, reader) = SectionReader::new(&blob).unwrap();
    let results: Vec<_> = reader.collect();
    assert_eq!(results[0].as_ref().unwrap().tag, section::RAM);
    assert_eq!(
        results[1],
        Err(SnapshotError::UnsupportedSection { tag: section::VIRTIO_RNG })
    );
}

/// E3-T12b AC3: the wasm32 build accepts the SAME versioned CPU payload — the fixed-LE encoding is
/// host-width-independent by construction, proven by execution here, not assertion. Poke distinct
/// architectural state (pc, an x-reg, an f-reg, a held reservation), round-trip through
/// save_resume/load_resume into a dirty machine, and confirm the CPU section restores byte-identically.
#[wasm_bindgen_test]
fn cpu_section_round_trips_on_wasm32() {
    assert!(is_supported_section(section::CPU));
    let mut a = wasm_vm_core::Machine::new(1 << 16);
    a.hart_mut().regs.pc = 0x8020_1234;
    a.hart_mut().regs.write(5, 0xdead_beef_0000_0007);
    a.hart_mut().fregs.write_raw(3, 0x4009_21fb_5444_2d18);
    a.hart_mut().resv = Some((0x8000_0040, 8));
    let blob = a.save_resume();
    let cpu = a.hart().to_snapshot();

    let mut b = wasm_vm_core::Machine::new(1 << 16);
    b.hart_mut().regs.write(5, 0x1); // dirty target
    b.load_resume(&blob).unwrap();
    assert_eq!(b.hart().to_snapshot(), cpu);
    assert_eq!(b.hart().regs.pc, 0x8020_1234);
    assert_eq!(b.hart().regs.read(5), 0xdead_beef_0000_0007);
    assert_eq!(b.hart().resv, Some((0x8000_0040, 8)));
}

/// E3-T12c1: the VIRTIO_BLK section round-trips on real wasm32 too (same fixed-LE codec). Enable
/// virtio-blk, poke the transport status via one MMIO write so it is non-default, save→load into a
/// fresh machine, and re-serialize byte-identically.
#[wasm_bindgen_test]
fn virtio_blk_section_round_trips_on_wasm32() {
    use wasm_vm_core::block::MemBackend;
    use wasm_vm_core::bus::Bus;
    assert!(is_supported_section(section::VIRTIO_BLK));
    let build = || {
        let mut m = wasm_vm_core::Machine::new(1 << 16);
        m.enable_clint(10);
        let _ = m.enable_plic();
        let _ = m.enable_virtio_blk(Box::new(MemBackend::new(vec![0u8; 4096])));
        m
    };
    let mut a = build();
    a.bus_mut().store32(0x1000_1000 + 0x70, 1).unwrap(); // STATUS=ACKNOWLEDGE → non-default transport
    let blob = a.save_resume();

    let mut b = build();
    b.load_resume(&blob).unwrap();
    assert_eq!(b.save_resume(), blob, "VIRTIO_BLK section round-trips on wasm32");
}
