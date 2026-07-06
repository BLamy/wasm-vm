//! E3-T01 tests: offset math edge cases, manifest validation, chunk verification, and a proptest
//! that reassembly + offset-location round-trip against a flat reference buffer for random sizes.
use super::*;
use alloc::string::String;
use alloc::vec::Vec;
use alloc::{format, vec};

/// Lowercase-hex SHA-256 of `bytes`.
fn sha_hex(bytes: &[u8]) -> String {
    let d = Sha256::digest(bytes);
    let mut s = String::with_capacity(64);
    for b in d {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Build a valid split-layout manifest by actually chunking `data`.
fn manifest_for(data: &[u8], chunk_size: u32) -> ImageManifest {
    let chunks: Vec<String> = data.chunks(chunk_size as usize).map(sha_hex).collect();
    ImageManifest {
        version: FORMAT_VERSION,
        image_len: data.len() as u64,
        chunk_size,
        layout: Layout::Split,
        chunks,
    }
}

#[test]
fn offset_math_edge_cases() {
    // 10 bytes, 4-byte chunks → chunks [4,4,2]; tail is short.
    let idx = manifest_for(&[0u8; 10], 4).index();
    assert_eq!(idx.chunk_count(), 3);
    assert_eq!(idx.chunk_len(0), 4);
    assert_eq!(idx.chunk_len(1), 4);
    assert_eq!(idx.chunk_len(2), 2); // tail
    assert_eq!(idx.locate(0), Ok((0, 0))); // first byte
    assert_eq!(idx.locate(3), Ok((0, 3)));
    assert_eq!(idx.locate(4), Ok((1, 0))); // chunk boundary
    assert_eq!(idx.locate(9), Ok((2, 1))); // last byte
    assert_eq!(
        idx.locate(10),
        Err(ImageError::OffsetOutOfRange {
            offset: 10,
            image_len: 10
        })
    );

    // Exact multiple: 8 bytes, 4-byte chunks → [4,4], last chunk is FULL, not short.
    let idx = manifest_for(&[0u8; 8], 4).index();
    assert_eq!(idx.chunk_count(), 2);
    assert_eq!(idx.chunk_len(1), 4);

    // Single-chunk image (smaller than chunk_size).
    let idx = manifest_for(&[0u8; 3], 4).index();
    assert_eq!(idx.chunk_count(), 1);
    assert_eq!(idx.chunk_len(0), 3);
    assert_eq!(idx.locate(2), Ok((0, 2)));

    // 1-byte image.
    let idx = manifest_for(&[0u8; 1], 4).index();
    assert_eq!(idx.chunk_count(), 1);
    assert_eq!(idx.chunk_len(0), 1);

    // 0-byte image: no chunks, every offset is out of range.
    let idx = manifest_for(&[], 4).index();
    assert_eq!(idx.chunk_count(), 0);
    assert_eq!(
        idx.locate(0),
        Err(ImageError::OffsetOutOfRange {
            offset: 0,
            image_len: 0
        })
    );
}

#[test]
fn verify_chunk_accepts_correct_and_rejects_corruption() {
    let data: Vec<u8> = (0..10u8).collect();
    let m = manifest_for(&data, 4);
    // Correct chunks verify.
    assert_eq!(m.verify_chunk(0, &data[0..4]), Ok(()));
    assert_eq!(m.verify_chunk(2, &data[8..10]), Ok(())); // tail
    // A flipped byte → HashMismatch (not a panic).
    let mut bad = data[0..4].to_vec();
    bad[1] ^= 0xff;
    assert_eq!(
        m.verify_chunk(0, &bad),
        Err(ImageError::HashMismatch { chunk: 0 })
    );
    // Wrong length (truncated / over-long) → TruncatedChunk before hashing.
    assert_eq!(
        m.verify_chunk(0, &data[0..3]),
        Err(ImageError::TruncatedChunk {
            chunk: 0,
            expected: 4,
            got: 3
        })
    );
    // Out-of-range chunk index.
    assert_eq!(
        m.verify_chunk(3, &[]),
        Err(ImageError::ChunkIndexOutOfRange { chunk: 3, count: 3 })
    );
}

#[test]
fn manifest_validation_rejects_hostile_edits() {
    let good = manifest_for(&[7u8; 10], 4);
    assert_eq!(good.validate(), Ok(()));

    // Wrong version.
    let mut m = good.clone();
    m.version = 2;
    assert_eq!(
        m.validate(),
        Err(ImageError::VersionMismatch {
            found: 2,
            supported: 1
        })
    );

    // chunk_size 0 and non-power-of-two.
    let mut m = good.clone();
    m.chunk_size = 0;
    assert_eq!(m.validate(), Err(ImageError::BadChunkSize(0)));
    let mut m = good.clone();
    m.chunk_size = 6;
    assert_eq!(m.validate(), Err(ImageError::BadChunkSize(6)));

    // Declare image_len larger than the chunks cover → derived count != declared.
    let mut m = good.clone();
    m.image_len = 100; // derived ceil(100/4)=25, declared chunks.len()=3
    assert!(matches!(
        m.validate(),
        Err(ImageError::ChunkCountMismatch {
            declared: 3,
            derived: 25
        })
    ));

    // Reorder/wrong count of chunk hashes.
    let mut m = good.clone();
    m.chunks.pop();
    assert!(matches!(
        m.validate(),
        Err(ImageError::ChunkCountMismatch {
            declared: 2,
            derived: 3
        })
    ));

    // Malformed hash hex (wrong length / non-hex).
    let mut m = good.clone();
    m.chunks[1] = String::from("nothex");
    assert_eq!(m.validate(), Err(ImageError::BadHashHex { chunk: 1 }));
    let mut m = good.clone();
    m.chunks[0] = "zz".repeat(32); // 64 chars but non-hex
    assert_eq!(m.validate(), Err(ImageError::BadHashHex { chunk: 0 }));
}

#[test]
fn from_json_parses_ignores_unknown_fields_and_errors_typed() {
    let data: Vec<u8> = (0..6u8).collect();
    let m = manifest_for(&data, 4);
    let json = format!(
        r#"{{ "version":1, "image_len":6, "chunk_size":4, "layout":"split",
             "chunks":["{}","{}"], "generated_by":"tool-we-dont-know", "extra":42 }}"#,
        m.chunks[0], m.chunks[1]
    );
    let parsed = ImageManifest::from_json(&json).expect("unknown fields ignored");
    assert_eq!(parsed.image_len, 6);
    assert_eq!(parsed.layout, Layout::Split);

    // Garbage JSON → typed Json error, not a panic.
    assert!(matches!(
        ImageManifest::from_json("{not json"),
        Err(ImageError::Json(_))
    ));
    // Valid JSON but failing validation → the validation error.
    let bad = r#"{"version":1,"image_len":6,"chunk_size":3,"layout":"blob","chunks":[]}"#;
    assert_eq!(
        ImageManifest::from_json(bad),
        Err(ImageError::BadChunkSize(3))
    );
}

#[test]
fn unvalidated_manifest_never_panics() {
    // The public API must be panic-free even on a hand-constructed manifest that skipped validate()
    // (the `pub` fields allow it). Critic C2 footgun: chunk_size=0 div-by-zero + OOB index.
    let bad_cs = ImageManifest {
        version: FORMAT_VERSION,
        image_len: 10,
        chunk_size: 0,
        layout: Layout::Split,
        chunks: alloc::vec![String::from("ab").repeat(32)],
    };
    assert_eq!(
        bad_cs.verify_chunk(0, &[]),
        Err(ImageError::BadChunkSize(0))
    );
    let idx = bad_cs.index(); // no div-by-zero
    assert_eq!(idx.chunk_count(), 0);
    assert!(idx.locate(0).is_err()); // no div-by-zero
    assert_eq!(idx.chunk_len(0), 0);
    // The lazy read-path (E3-T02) must inherit the same guard — chunk_span/read divide by
    // chunk_size (critic round-2 BUG 2).
    assert!(idx.chunk_span(0, 4).is_err()); // no div-by-zero
    let src = MockSource {
        chunks: alloc::vec![],
    };
    assert!(idx.read(&src, 0, 4).is_err()); // no div-by-zero

    // Declared image_len implies 250 chunks but the vector is empty → bounds-check must use the
    // vector length, not the derived count, so `chunks[5]` cannot panic.
    let empty = ImageManifest {
        version: FORMAT_VERSION,
        image_len: 1000,
        chunk_size: 4,
        layout: Layout::Blob,
        chunks: alloc::vec![],
    };
    assert_eq!(
        empty.verify_chunk(5, &[0u8; 4]),
        Err(ImageError::ChunkIndexOutOfRange { chunk: 5, count: 0 })
    );
}

/// A mock chunk source: `chunks[i] = Some(bytes)` if resident, `None` if not yet fetched.
struct MockSource {
    chunks: Vec<Option<Vec<u8>>>,
}
impl ChunkSource for MockSource {
    fn get(&self, chunk: usize) -> Option<&[u8]> {
        self.chunks.get(chunk).and_then(|c| c.as_deref())
    }
}

#[test]
fn lazy_read_assembles_present_chunks_and_reports_first_missing() {
    let data: Vec<u8> = (0..10u8).collect();
    let m = manifest_for(&data, 4); // chunks [4,4,2]
    let idx = m.index();

    // All resident → a cross-chunk read returns exactly the requested slice.
    let all = MockSource {
        chunks: data.chunks(4).map(|c| Some(c.to_vec())).collect(),
    };
    assert_eq!(
        idx.read(&all, 2, 5),
        Ok(ReadOutcome::Ready(data[2..7].to_vec()))
    ); // spans chunk 0+1
    assert_eq!(idx.read(&all, 0, 10), Ok(ReadOutcome::Ready(data.clone()))); // whole image, all 3 chunks
    assert_eq!(idx.read(&all, 9, 1), Ok(ReadOutcome::Ready(vec![9]))); // last byte, tail chunk

    // Chunk 1 absent → the read reports NeedChunk(1) (the FIRST missing one it hits), not partial data.
    let missing1 = MockSource {
        chunks: vec![Some(data[0..4].to_vec()), None, Some(data[8..10].to_vec())],
    };
    assert_eq!(idx.read(&missing1, 0, 10), Ok(ReadOutcome::NeedChunk(1)));
    assert_eq!(
        idx.read(&missing1, 0, 4),
        Ok(ReadOutcome::Ready(data[0..4].to_vec()))
    ); // chunk 0 alone is fine
    assert_eq!(idx.read(&missing1, 5, 1), Ok(ReadOutcome::NeedChunk(1)));

    // Out-of-bounds and zero-length reads are errors, never a partial/empty Ready.
    assert!(idx.read(&all, 10, 1).is_err());
    assert!(idx.read(&all, 8, 5).is_err()); // runs past image_len
    assert!(idx.read(&all, 0, 0).is_err()); // zero length

    // A source handing back a wrong-length chunk is rejected (never trust the fetch layer).
    let bad = MockSource {
        chunks: vec![
            Some(vec![0u8; 3]),
            Some(data[4..8].to_vec()),
            Some(data[8..10].to_vec()),
        ],
    };
    assert_eq!(
        idx.read(&bad, 0, 4),
        Err(ImageError::TruncatedChunk {
            chunk: 0,
            expected: 4,
            got: 3
        })
    );
}

proptest::proptest! {
    // Reassembling chunk-by-chunk per the index reproduces the image byte-for-byte, and every
    // offset locates to the right (chunk, intra) — for random sizes around chunk-size multiples.
    #[test]
    fn chunk_math_roundtrips(len in 0usize..2048, shift in 0u32..6) {
        let chunk_size = 1u32 << shift; // 1..32, always a power of two
        let data: Vec<u8> = (0..len).map(|i| (i * 31 + 7) as u8).collect();
        let m = manifest_for(&data, chunk_size);
        m.validate().unwrap();
        let idx = m.index();

        // Reassemble from the per-chunk lengths → identical to the flat buffer.
        let mut reasm = Vec::with_capacity(len);
        let mut off = 0u64;
        for c in 0..idx.chunk_count() {
            let n = idx.chunk_len(c as usize);
            reasm.extend_from_slice(&data[off as usize..(off + n) as usize]);
            // Each chunk verifies against its own hash.
            m.verify_chunk(c as usize, &data[off as usize..(off + n) as usize]).unwrap();
            off += n;
        }
        proptest::prop_assert_eq!(&reasm, &data);
        proptest::prop_assert_eq!(off, len as u64);

        // Every valid offset round-trips.
        for o in 0..len as u64 {
            let (c, intra) = idx.locate(o).unwrap();
            proptest::prop_assert_eq!(c as u64 * chunk_size as u64 + intra, o);
        }
        proptest::prop_assert!(idx.locate(len as u64).is_err());
    }
}
