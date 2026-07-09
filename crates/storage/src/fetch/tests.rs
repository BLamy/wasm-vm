//! E3-T02 pass 3 tests: URL/Range derivation, response classification (incl. the 200-not-206
//! adversarial case), retry-policy math, the verify-on-insert cache, and in-flight dedup.
use super::*;
use crate::{FORMAT_VERSION, ImageError, ImageManifest, Layout};
use alloc::collections::BTreeSet;
use alloc::string::String;
use alloc::vec::Vec;
use alloc::{format, vec};
use sha2::{Digest, Sha256};

/// Lowercase-hex SHA-256 of `bytes`.
fn sha_hex(bytes: &[u8]) -> String {
    let d = Sha256::digest(bytes);
    let mut s = String::with_capacity(64);
    for b in d {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// A valid manifest built by actually chunking `data` at `chunk_size`, in `layout`.
fn manifest(data: &[u8], chunk_size: u32, layout: Layout) -> ImageManifest {
    let chunks: Vec<String> = data.chunks(chunk_size as usize).map(sha_hex).collect();
    let m = ImageManifest {
        version: FORMAT_VERSION,
        image_len: data.len() as u64,
        chunk_size,
        layout,
        chunks,
    };
    assert_eq!(m.validate(), Ok(()));
    m
}

#[test]
fn split_request_is_content_addressed_url_no_range() {
    let data: Vec<u8> = (0..10u8).collect(); // chunks [4,4,2]
    let m = manifest(&data, 4, Layout::Split);
    let r = m.chunk_request("https://cdn.example/img/", 1).unwrap();
    assert_eq!(
        r.url,
        format!("https://cdn.example/img/chunks/{}.bin", m.chunks[1])
    );
    assert_eq!(r.range, None, "split fetches the whole per-chunk file");
}

#[test]
fn blob_request_is_inclusive_byte_range_over_single_file() {
    let data: Vec<u8> = (0..10u8).collect(); // chunk_size 4 → chunks [4,4,2]
    let m = manifest(&data, 4, Layout::Blob);
    // Chunk 0: bytes [0,4) → inclusive 0..=3.
    let r0 = m.chunk_request("https://cdn.example/img/", 0).unwrap();
    assert_eq!(r0.url, "https://cdn.example/img/image.blob");
    assert_eq!(r0.range, Some((0, 3)));
    // Chunk 1: bytes [4,8) → 4..=7.
    assert_eq!(m.chunk_request("b/", 1).unwrap().range, Some((4, 7)));
    // Tail chunk 2 is SHORT (2 bytes): bytes [8,10) → inclusive 8..=9, not 8..=11.
    assert_eq!(m.chunk_request("b/", 2).unwrap().range, Some((8, 9)));
}

#[test]
fn chunk_request_out_of_range_and_bad_chunk_size_are_typed_errors() {
    let m = manifest(&[0u8; 10], 4, Layout::Blob);
    assert_eq!(
        m.chunk_request("b/", 3),
        Err(ImageError::ChunkIndexOutOfRange { chunk: 3, count: 3 })
    );
    // Unvalidated hand-built manifest with chunk_size 0 must not divide-by-zero / panic.
    let bad = ImageManifest {
        version: FORMAT_VERSION,
        image_len: 10,
        chunk_size: 0,
        layout: Layout::Blob,
        chunks: vec![String::from("ab").repeat(32)],
    };
    assert_eq!(bad.chunk_request("b/", 0), Err(ImageError::BadChunkSize(0)));

    // Critic pass-3 FINDING 2: an INCONSISTENT unvalidated manifest — image_len 0 (derived count 0)
    // but a non-empty `chunks` — must be a typed error, not a `start + len - 1` underflow panic.
    let inconsistent = ImageManifest {
        version: FORMAT_VERSION,
        image_len: 0,
        chunk_size: 4,
        layout: Layout::Blob,
        chunks: vec![String::from("ab").repeat(32)],
    };
    assert_eq!(
        inconsistent.chunk_request("b/", 0),
        Err(ImageError::ChunkIndexOutOfRange { chunk: 0, count: 0 })
    );
}

#[test]
fn classify_response_covers_206_200_and_the_range_ignored_case() {
    // The adversarial bar: a blob-layout 200 means the server ignored Range → full-image download.
    assert_eq!(
        classify_response(Layout::Blob, 200),
        ResponseAction::Fail(FetchFailure::RangeIgnored { status: 200 })
    );
    assert_eq!(classify_response(Layout::Blob, 206), ResponseAction::Accept);
    // split fetches a whole (chunk-sized) file, so 200 is correct and 206 is also fine.
    assert_eq!(
        classify_response(Layout::Split, 200),
        ResponseAction::Accept
    );
    assert_eq!(
        classify_response(Layout::Split, 206),
        ResponseAction::Accept
    );
}

#[test]
fn classify_response_retryable_vs_permanent_statuses() {
    for s in [500u16, 502, 503, 504, 408, 429] {
        assert_eq!(
            classify_response(Layout::Split, s),
            ResponseAction::Retry,
            "status {s} should retry"
        );
    }
    for s in [404u16, 403, 400, 401, 410] {
        assert_eq!(
            classify_response(Layout::Split, s),
            ResponseAction::Fail(FetchFailure::HttpStatus { status: s }),
            "status {s} should be permanent"
        );
    }
}

#[test]
fn retry_policy_bounds_and_backoff_never_overflow() {
    let p = RetryPolicy::DEFAULT;
    assert!(p.should_retry(0));
    assert!(p.should_retry(3));
    assert!(!p.should_retry(4), "4 retries max → attempt 4 stops");
    assert!(!p.should_retry(100));
    // Exponential from base, capped.
    assert_eq!(p.backoff_ms(0), 100);
    assert_eq!(p.backoff_ms(1), 200);
    assert_eq!(p.backoff_ms(2), 400);
    assert_eq!(p.backoff_ms(3), 800);
    // A huge attempt must saturate to the cap, not overflow (checked_shl → None → cap).
    assert_eq!(p.backoff_ms(64), p.cap_ms);
    assert_eq!(p.backoff_ms(1000), p.cap_ms);
    assert!(p.backoff_ms(20) <= p.cap_ms);
}

#[test]
fn chunk_store_caches_only_verified_bytes() {
    let data: Vec<u8> = (0..10u8).collect(); // chunks [4,4,2]
    let m = manifest(&data, 4, Layout::Split);
    let mut store = ChunkStore::new();

    // A correct chunk is accepted and becomes readable.
    assert_eq!(store.provide(&m, 0, data[0..4].to_vec()), Ok(()));
    assert!(store.contains(0));
    assert_eq!(store.get(0), Some(&data[0..4]));
    assert_eq!(store.resident_count(), 1);

    // A hash-mismatched chunk is REJECTED and never cached (would otherwise complete a read with
    // corrupt data — the adversarial "silently wrong data" refutation).
    let mut corrupt = data[4..8].to_vec();
    corrupt[0] ^= 0xff;
    assert_eq!(
        store.provide(&m, 1, corrupt),
        Err(ImageError::HashMismatch { chunk: 1 })
    );
    assert!(!store.contains(1), "corrupt bytes must not be cached");
    assert_eq!(store.get(1), None);

    // A truncated chunk is rejected before hashing.
    assert!(matches!(
        store.provide(&m, 1, data[4..7].to_vec()),
        Err(ImageError::TruncatedChunk { chunk: 1, .. })
    ));
    assert!(!store.contains(1));

    // Out-of-range chunk index is a typed error, not a panic.
    assert_eq!(
        store.provide(&m, 9, vec![]),
        Err(ImageError::ChunkIndexOutOfRange { chunk: 9, count: 3 })
    );

    // The correct chunk 1 (tail-preceding, full size) then succeeds; provide is idempotent.
    assert_eq!(store.provide(&m, 1, data[4..8].to_vec()), Ok(()));
    assert_eq!(store.provide(&m, 1, data[4..8].to_vec()), Ok(()));
    assert_eq!(store.resident_count(), 2);
}

#[test]
fn plan_fetches_dedups_resident_inflight_and_repeats() {
    let data: Vec<u8> = (0..16u8).collect(); // chunk_size 4 → 4 chunks
    let m = manifest(&data, 4, Layout::Split);
    let mut store = ChunkStore::new();
    store.provide(&m, 2, data[8..12].to_vec()).unwrap(); // chunk 2 resident

    let mut in_flight = BTreeSet::new();
    in_flight.insert(1usize); // chunk 1 already being fetched

    // Pending lists 0,1,2,3,0 (a duplicate 0). Resident 2 and in-flight 1 are skipped; the repeat
    // of 0 is planned once. Order preserved: [0, 3].
    let plan = plan_fetches(&[0, 1, 2, 3, 0], |c| store.contains(c), &in_flight);
    assert_eq!(plan, vec![0, 3]);

    // Two simultaneous reads of the same absent chunk → exactly one planned fetch (dedup within one
    // call), then zero once it is marked in-flight.
    assert_eq!(
        plan_fetches(&[3, 3, 3], |c| store.contains(c), &in_flight),
        vec![3]
    );
    in_flight.insert(3);
    assert!(plan_fetches(&[3, 3, 3], |c| store.contains(c), &in_flight).is_empty());
}
