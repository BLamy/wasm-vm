//! BlobStore tests: content-addressing + dedupe accounting, verified-on-read against the charter's
//! tampering (wrong bytes / truncated / wrong key), `put_expected` refusal with no partial state,
//! LRU eviction over unpinned blobs, pinning, and hit/miss stats.

use super::{BlobError, BlobStore, MemBlobBackend, blob_id};
use alloc::vec;
use alloc::vec::Vec;

fn store() -> BlobStore<MemBlobBackend> {
    BlobStore::new(MemBlobBackend::new())
}

/// A deterministic blob of `len` bytes tagged by `tag` (distinct tags → distinct digests).
fn blob(tag: u8, len: usize) -> Vec<u8> {
    let mut v = vec![tag; len];
    if !v.is_empty() {
        v[0] = tag;
    }
    v
}

#[test]
fn put_then_get_round_trips_by_content_address() {
    let mut s = store();
    let bytes = blob(1, 64);
    let id = s.put(&bytes);
    assert_eq!(id, blob_id(&bytes), "the key IS the content digest");
    assert!(s.has(&id));
    assert_eq!(s.get(&id).as_deref(), Some(bytes.as_slice()));
    assert_eq!(s.hits(), 1);
    assert_eq!(s.total_bytes(), 64);
    assert_eq!(s.len(), 1);
}

#[test]
fn a_repeated_digest_is_stored_once_dedupe() {
    let mut s = store();
    let bytes = blob(7, 100);
    let a = s.put(&bytes);
    let b = s.put(&bytes); // same content → same id, stored once
    assert_eq!(a, b);
    assert_eq!(s.len(), 1, "deduped");
    assert_eq!(s.total_bytes(), 100, "size counted once");
}

#[test]
fn two_images_sharing_a_layer_store_it_once() {
    // Dedupe proof: two "images" each reference a shared base layer + one unique layer.
    let mut s = store();
    let base = blob(0, 200);
    let img_a_layer = blob(1, 50);
    let img_b_layer = blob(2, 50);
    for l in [&base, &img_a_layer] {
        s.put(l);
    }
    for l in [&base, &img_b_layer] {
        s.put(l); // base is already present → not re-stored
    }
    assert_eq!(
        s.len(),
        3,
        "base shared, two unique — three blobs, not four"
    );
    assert_eq!(s.total_bytes(), 300, "shared base counted once");
}

#[test]
fn put_expected_refuses_wrong_bytes_and_stores_nothing() {
    let mut s = store();
    let good = blob(1, 32);
    let expected = blob_id(&good);
    let wrong = blob(2, 32);
    // Bytes that don't hash to `expected` are refused — no partial/unverified state.
    let err = s.put_expected(&expected, &wrong).unwrap_err();
    assert!(matches!(err, BlobError::DigestMismatch { .. }));
    assert!(!s.has(&expected));
    assert_eq!(s.len(), 0, "a rejected put stores nothing");
    // The correct bytes are accepted.
    s.put_expected(&expected, &good).unwrap();
    assert!(s.has(&expected));
}

#[test]
fn verified_on_read_evicts_wrong_bytes_under_a_correct_key() {
    // The charter's headline tamper: right key, wrong bytes injected straight into the backend.
    let mut s = store();
    let bytes = blob(1, 128);
    let id = s.put(&bytes);
    // Attacker overwrites the stored value with garbage under the same key.
    s.backend_mut().tamper(&id, &blob(9, 128));
    // The re-hash on read catches it: no corrupt bytes returned, and the blob is evicted.
    assert_eq!(s.get(&id), None, "tampered bytes are never returned");
    assert!(!s.has(&id), "corrupt blob evicted → caller must refetch");
    assert_eq!(s.misses(), 1);
}

#[test]
fn verified_on_read_catches_truncation() {
    let mut s = store();
    let bytes = blob(3, 256);
    let id = s.put(&bytes);
    s.backend_mut().tamper(&id, &bytes[..100]); // truncated value
    assert_eq!(s.get(&id), None);
    assert!(!s.has(&id));
}

#[test]
fn right_bytes_under_a_wrong_key_do_not_verify() {
    // Bytes stored (physically) under a key that is NOT their digest → get(that key) re-hashes and
    // rejects them.
    let mut s = store();
    let real = blob(1, 64);
    let real_id = s.put(&real);
    let wrong_id = blob_id(&blob(2, 64)); // a different digest
    // Physically place the real bytes under the wrong key + index it (simulating a corrupt index).
    s.backend_mut().tamper(&wrong_id, &real);
    // has() is index-only, but get() verifies: the bytes under wrong_id hash to real_id != wrong_id.
    assert_eq!(
        s.get(&wrong_id),
        None,
        "content doesn't match the key it's filed under"
    );
    assert!(s.has(&real_id), "the correctly-keyed blob is untouched");
}

#[test]
fn lru_eviction_removes_least_recently_used_unpinned_first() {
    let mut s = store();
    let a = s.put(&blob(1, 100));
    let b = s.put(&blob(2, 100));
    let c = s.put(&blob(3, 100));
    // Touch `a` so `b` becomes the least-recently-used.
    assert!(s.get(&a).is_some());
    // Budget for two blobs (200) → evict exactly one: the LRU, which is `b`.
    let evicted = s.evict_to(200);
    assert_eq!(evicted, vec![b], "the least-recently-used blob is evicted");
    assert!(s.has(&a) && s.has(&c) && !s.has(&b));
    assert_eq!(s.total_bytes(), 200);
}

#[test]
fn pinned_blobs_are_never_evicted_even_over_budget() {
    let mut s = store();
    let a = s.put(&blob(1, 100));
    let b = s.put(&blob(2, 100));
    let c = s.put(&blob(3, 100));
    s.pin(&a); // a running image — must stay offline-runnable
    assert!(s.is_pinned(&a));
    // Budget of 0 → evict everything evictable; only the pinned `a` survives.
    let evicted = s.evict_to(0);
    assert_eq!(evicted.len(), 2);
    assert!(s.has(&a), "pinned blob kept even though over budget");
    assert!(!s.has(&b) && !s.has(&c));
    assert_eq!(
        s.total_bytes(),
        100,
        "only the pinned blob remains, over the 0 budget"
    );
    // Unpinning makes it evictable again.
    s.unpin(&a);
    assert_eq!(s.evict_to(0), vec![a]);
    assert!(s.is_empty());
}

#[test]
fn eviction_stops_cleanly_when_only_pinned_blobs_remain() {
    let mut s = store();
    let a = s.put(&blob(1, 100));
    s.pin(&a);
    // Budget below the pinned size → cannot shrink; returns empty, does not loop forever.
    assert!(s.evict_to(10).is_empty());
    assert!(s.has(&a));
}

#[test]
fn missing_blob_is_a_miss_not_a_crash() {
    let mut s = store();
    let id = blob_id(&blob(1, 10));
    assert_eq!(s.get(&id), None);
    assert_eq!(s.misses(), 1);
    assert_eq!(s.hits(), 0);
    assert!(!s.remove(&id), "removing an absent blob is a no-op");
}

#[test]
fn a_zero_length_blob_round_trips() {
    let mut s = store();
    let id = s.put(&[]);
    assert_eq!(id, blob_id(&[]));
    assert_eq!(s.get(&id).as_deref(), Some(&[][..]));
    assert_eq!(s.total_bytes(), 0);
    assert_eq!(s.len(), 1);
}
