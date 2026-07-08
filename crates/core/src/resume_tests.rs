//! Resume-format tests: header round-trip + magic/version checks, the coherence guards
//! (core-hash / base-image / overlay-generation mismatch → typed refusal), TLV section iteration
//! with unknown-section fail-loud and length-overflow rejection, parser fuzz (no panic on any
//! truncation/flip), and the RAM zero-elision codec (round-trip, compaction, malformed rejection).

use super::{
    FORMAT_VERSION, MAGIC, SectionReader, SnapshotError, SnapshotHeader, SnapshotWriter,
    decode_sparse, encode_sparse, section,
};
use alloc::vec;
use alloc::vec::Vec;

const CORE: [u8; 32] = [0xC0; 32];
const BASE: [u8; 32] = [0xBA; 32];

fn sample_blob() -> Vec<u8> {
    let mut w = SnapshotWriter::new(&CORE, &BASE, 7);
    w.section(section::CPU, b"cpu-state");
    w.section(section::RAM, b"ram-state");
    w.finish()
}

#[test]
fn header_round_trips_and_sections_read_back_in_order() {
    let blob = sample_blob();
    let (header, reader) = SectionReader::new(&blob).unwrap();
    assert_eq!(header.format_version, FORMAT_VERSION);
    assert_eq!(header.core_hash, CORE);
    assert_eq!(header.base_image_hash, BASE);
    assert_eq!(header.overlay_generation, 7);

    let sections: Vec<_> = reader.map(|r| r.unwrap()).collect();
    assert_eq!(sections.len(), 2);
    assert_eq!(sections[0].tag, section::CPU);
    assert_eq!(sections[0].payload, b"cpu-state");
    assert_eq!(sections[1].tag, section::RAM);
    assert_eq!(sections[1].payload, b"ram-state");
}

#[test]
fn a_bad_magic_is_rejected() {
    let mut blob = sample_blob();
    blob[0] ^= 0xff;
    assert_eq!(SnapshotHeader::parse(&blob), Err(SnapshotError::BadMagic));
}

#[test]
fn a_version_mismatch_is_rejected() {
    let mut blob = sample_blob();
    // Bump the version field (bytes 8..12).
    blob[8..12].copy_from_slice(&(FORMAT_VERSION + 1).to_le_bytes());
    assert_eq!(
        SnapshotHeader::parse(&blob),
        Err(SnapshotError::VersionMismatch {
            found: FORMAT_VERSION + 1,
            supported: FORMAT_VERSION
        })
    );
}

#[test]
fn a_too_short_blob_is_truncated_not_a_panic() {
    assert_eq!(SnapshotHeader::parse(&[]), Err(SnapshotError::Truncated));
    assert_eq!(SnapshotHeader::parse(&MAGIC), Err(SnapshotError::Truncated));
}

#[test]
fn the_coherence_guards_refuse_a_mismatch() {
    let blob = sample_blob();
    let (header, _) = SectionReader::new(&blob).unwrap();
    // Matching build + image + generation → safe to restore.
    assert_eq!(header.validate_for(&CORE, &BASE, 7), Ok(()));
    // A different emulator build.
    assert_eq!(
        header.validate_for(&[0xAA; 32], &BASE, 7),
        Err(SnapshotError::CoreHashMismatch)
    );
    // A different base disk image.
    assert_eq!(
        header.validate_for(&CORE, &[0xAA; 32], 7),
        Err(SnapshotError::BaseImageMismatch)
    );
    // The disk moved on since the snapshot (guest wrote after snapshotting) — the corruption case.
    assert_eq!(
        header.validate_for(&CORE, &BASE, 9),
        Err(SnapshotError::OverlayGenerationMismatch {
            snapshot: 7,
            current: 9
        })
    );
}

#[test]
fn an_unknown_section_fails_loudly() {
    let mut w = SnapshotWriter::new(&CORE, &BASE, 0);
    w.section(section::CPU, b"ok");
    w.section(0xDEAD_BEEF, b"from a newer build"); // a tag this build doesn't know
    let blob = w.finish();
    let (_, reader) = SectionReader::new(&blob).unwrap();
    let results: Vec<_> = reader.collect();
    assert_eq!(results[0].as_ref().unwrap().tag, section::CPU);
    assert_eq!(
        results[1],
        Err(SnapshotError::UnknownSection { tag: 0xDEAD_BEEF })
    );
}

#[test]
fn a_section_length_past_the_end_is_rejected_not_over_read() {
    let mut blob = SnapshotWriter::new(&CORE, &BASE, 0).finish();
    // Append a section header claiming 1000 payload bytes, but provide none.
    blob.extend_from_slice(&section::RAM.to_le_bytes());
    blob.extend_from_slice(&1000u32.to_le_bytes());
    let (_, reader) = SectionReader::new(&blob).unwrap();
    let results: Vec<_> = reader.collect();
    assert_eq!(
        results[0],
        Err(SnapshotError::SectionLengthOverflow { tag: section::RAM })
    );
}

#[test]
fn a_partial_trailing_section_header_is_truncated() {
    let mut blob = SnapshotWriter::new(&CORE, &BASE, 0).finish();
    blob.extend_from_slice(&[1, 2, 3]); // < 8 bytes of a section header
    let (_, reader) = SectionReader::new(&blob).unwrap();
    let results: Vec<_> = reader.collect();
    assert_eq!(results[0], Err(SnapshotError::Truncated));
}

#[test]
fn the_parser_never_panics_on_any_truncation_or_flip() {
    let blob = sample_blob();
    // Every truncation.
    for cut in 0..=blob.len() {
        if let Ok((_, reader)) = SectionReader::new(&blob[..cut]) {
            for r in reader {
                let _ = r; // Ok or typed Err — just no panic
            }
        }
    }
    // Every single-byte flip.
    for i in 0..blob.len() {
        let mut m = blob.clone();
        m[i] ^= 0xff;
        if let Ok((_, reader)) = SectionReader::new(&m) {
            for r in reader {
                let _ = r;
            }
        }
    }
    // Structured-random junk (deterministic xorshift).
    let mut seed = 0x9E37_79B9u32;
    let mut rng = || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed
    };
    for _ in 0..20_000 {
        let len = (rng() as usize) % 120;
        let junk: Vec<u8> = (0..len).map(|_| (rng() & 0xff) as u8).collect();
        if let Ok((_, reader)) = SectionReader::new(&junk) {
            for r in reader {
                let _ = r;
            }
        }
    }
}

// ── zero-elision codec ───────────────────────────────────────────────────────

#[test]
fn zero_elision_round_trips_for_every_shape() {
    let cases: [Vec<u8>; 5] = [
        vec![],
        vec![0u8; 1000], // all zero
        vec![7u8; 1000], // all data
        {
            let mut v = vec![0u8; 1000];
            v[500] = 1;
            v[501] = 2;
            v
        }, // sparse
        (0..255u16).map(|n| n as u8).collect(), // dense-ish
    ];
    for original in cases {
        let enc = encode_sparse(&original);
        assert_eq!(
            decode_sparse(&enc, original.len()).unwrap(),
            original,
            "round-trip"
        );
    }
}

#[test]
fn a_mostly_zero_buffer_compresses_far_under_ram_size() {
    // AC #4 logic: a mostly-idle 1 MiB region with a few small non-zero spans must be well under 15%.
    let mut ram = vec![0u8; 1 << 20];
    for span in [0usize, 4096, 900_000] {
        for k in 0..256 {
            ram[span + k] = (k as u8) | 1;
        }
    }
    let enc = encode_sparse(&ram);
    assert_eq!(decode_sparse(&enc, ram.len()).unwrap(), ram);
    let pct = enc.len() * 100 / ram.len();
    assert!(
        pct < 15,
        "mostly-zero RAM elided to {pct}% (< 15% required)"
    );
}

#[test]
fn decode_sparse_rejects_malformed_payloads() {
    // A data chunk claiming more bytes than are present.
    let mut bad = vec![1u8]; // CHUNK_DATA
    bad.extend_from_slice(&100u32.to_le_bytes()); // len 100
    bad.extend_from_slice(b"short"); // only 5 bytes
    assert_eq!(
        decode_sparse(&bad, 100),
        Err(SnapshotError::BadSparseEncoding)
    );

    // An unknown chunk kind.
    let mut bad_kind = vec![9u8];
    bad_kind.extend_from_slice(&0u32.to_le_bytes());
    assert_eq!(
        decode_sparse(&bad_kind, 0),
        Err(SnapshotError::BadSparseEncoding)
    );

    // A truncated chunk header (< 5 bytes).
    assert_eq!(
        decode_sparse(&[0, 0, 0], 0),
        Err(SnapshotError::BadSparseEncoding)
    );

    // A well-formed payload but the wrong expected length.
    let enc = encode_sparse(&vec![0u8; 10]);
    assert_eq!(
        decode_sparse(&enc, 11),
        Err(SnapshotError::BadSparseEncoding)
    );
    assert_eq!(
        decode_sparse(&enc, 9),
        Err(SnapshotError::BadSparseEncoding)
    );
}

#[test]
fn a_huge_zero_run_length_is_rejected_without_allocating() {
    // The fuzz-surfaced DoS: a hostile zero-chunk claiming a ~4 GiB run must be refused by the
    // pre-allocation bound (checked against expected_len BEFORE resize), not trigger a multi-
    // gigabyte allocation. This returns instantly; without the bound it OOMs / hangs.
    let mut bad = vec![0u8]; // CHUNK_ZERO
    bad.extend_from_slice(&u32::MAX.to_le_bytes()); // len ~4 GiB, no payload
    assert_eq!(
        decode_sparse(&bad, 64),
        Err(SnapshotError::BadSparseEncoding)
    );
    // Also a data-chunk with a huge declared len (but the input is short) is bounded by both guards.
    let mut bad2 = vec![1u8];
    bad2.extend_from_slice(&u32::MAX.to_le_bytes());
    assert_eq!(
        decode_sparse(&bad2, 64),
        Err(SnapshotError::BadSparseEncoding)
    );
}

#[test]
fn decode_sparse_never_panics_on_random_input() {
    let mut seed = 0x1234_5678u32;
    let mut rng = || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed
    };
    for _ in 0..20_000 {
        let len = (rng() as usize) % 64;
        let junk: Vec<u8> = (0..len).map(|_| (rng() & 0xff) as u8).collect();
        let expected = (rng() as usize) % 128;
        let _ = decode_sparse(&junk, expected); // Ok or typed Err — never panic
    }
}
