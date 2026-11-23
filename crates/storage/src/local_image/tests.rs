//! E5-T34a tests: whole-image admission (size), chunk extents (incl. the short tail chunk), local
//! hits, and the permanent hash-mismatch failure.
use super::*;
use crate::{FORMAT_VERSION, Layout};
use alloc::string::String;
use alloc::vec::Vec;
use alloc::{format, vec};
use sha2::{Digest, Sha256};

fn sha_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(64);
    for b in Sha256::digest(bytes) {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn manifest(data: &[u8], chunk_size: u32) -> ImageManifest {
    let m = ImageManifest {
        version: FORMAT_VERSION,
        image_len: data.len() as u64,
        chunk_size,
        layout: Layout::Split,
        chunks: data.chunks(chunk_size as usize).map(sha_hex).collect(),
    };
    m.validate().expect("valid manifest");
    m
}

/// 2.5 chunks of distinct bytes: chunk 2 is a short tail.
fn image() -> Vec<u8> {
    (0..(64 * 2 + 32)).map(|i| (i * 7 + 3) as u8).collect()
}

#[test]
fn admits_exact_size_only() {
    let img = image();
    let m = manifest(&img, 64);
    assert!(LocalImage::admit(&m, img.len() as u64).is_ok());
    assert_eq!(
        LocalImage::admit(&m, img.len() as u64 - 1),
        Err(LocalImageError::SizeMismatch {
            expected: img.len() as u64,
            got: img.len() as u64 - 1
        })
    );
    assert_eq!(
        LocalImage::admit(&m, img.len() as u64 + 1),
        Err(LocalImageError::SizeMismatch {
            expected: img.len() as u64,
            got: img.len() as u64 + 1
        })
    );
    assert!(matches!(
        LocalImage::admit(&m, 0),
        Err(LocalImageError::SizeMismatch { .. })
    ));
}

#[test]
fn refuses_images_beyond_u32_offsets() {
    // A manifest claiming a 4 GiB + 1 image (validated chunk count) — admission must refuse rather
    // than truncate typed-array offsets.
    let len = u64::from(u32::MAX) + 1;
    let count = len.div_ceil(1 << 20) as usize;
    let m = ImageManifest {
        version: FORMAT_VERSION,
        image_len: len,
        chunk_size: 1 << 20,
        layout: Layout::Split,
        chunks: vec![sha_hex(b""); count],
    };
    m.validate().expect("valid manifest");
    assert_eq!(
        LocalImage::admit(&m, len),
        Err(LocalImageError::TooLarge { image_len: len })
    );
}

#[test]
fn chunk_ranges_match_the_manifest_extents() {
    let img = image();
    let m = manifest(&img, 64);
    let li = LocalImage::admit(&m, img.len() as u64).unwrap();
    assert_eq!(li.chunk_range(&m, 0), Ok((0, 64)));
    assert_eq!(li.chunk_range(&m, 1), Ok((64, 128)));
    // The short tail: exactly the remainder, the length verify_chunk expects.
    assert_eq!(li.chunk_range(&m, 2), Ok((128, 160)));
    assert_eq!(
        li.chunk_range(&m, 3),
        Err(FetchFailure::LocalImageCorrupt { chunk: 3 })
    );
}

#[test]
fn local_hit_serves_verified_bytes_for_every_chunk() {
    let img = image();
    let m = manifest(&img, 64);
    let li = LocalImage::admit(&m, img.len() as u64).unwrap();
    let mut rebuilt = Vec::new();
    for c in 0..m.chunks.len() {
        let bytes = li.serve(&m, &img, c).expect("local hit");
        m.verify_chunk(c, &bytes).expect("verified");
        rebuilt.extend_from_slice(&bytes);
    }
    assert_eq!(rebuilt, img);
}

#[test]
fn hash_mismatch_is_a_permanent_local_failure() {
    let img = image();
    let m = manifest(&img, 64);
    let li = LocalImage::admit(&m, img.len() as u64).unwrap();
    for flip in [0usize, 70, 159] {
        let mut bad = img.clone();
        bad[flip] ^= 0x01;
        let chunk = flip / 64;
        assert_eq!(
            li.serve(&m, &bad, chunk),
            Err(FetchFailure::LocalImageCorrupt { chunk })
        );
        // Untouched chunks still serve.
        let other = (chunk + 1) % 3;
        assert!(li.serve(&m, &bad, other).is_ok());
    }
    // A truncated slice handed to verify is also corrupt (never a network retry).
    assert_eq!(
        li.verify(&m, 1, &img[64..100]),
        Err(FetchFailure::LocalImageCorrupt { chunk: 1 })
    );
}

#[test]
fn short_buffer_cannot_be_served_even_if_admission_were_bypassed() {
    let img = image();
    let m = manifest(&img, 64);
    let li = LocalImage::admit(&m, img.len() as u64).unwrap();
    assert_eq!(
        li.serve(&m, &img[..100], 2),
        Err(FetchFailure::LocalImageCorrupt { chunk: 2 })
    );
}
