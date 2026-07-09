//! Pull-through tests: first-pull-fetches / re-pull-is-zero-bytes (the cacheStats property),
//! dedupe across images and within a call, a poisoned source refused, a corrupted cache layer
//! refetched, and fetch-error propagation — all with a mock counting registry.

use super::{LayerFetcher, PullError, pull_through};
use crate::blobstore::{BlobId, BlobStore, MemBlobBackend, blob_id};
use alloc::collections::BTreeMap;
use alloc::vec;
use alloc::vec::Vec;

/// A mock registry: serves registered blobs by digest, counts fetches, can be poisoned or made to
/// fail.
#[derive(Default)]
struct MockRegistry {
    blobs: BTreeMap<BlobId, Vec<u8>>,
    fetch_count: usize,
    fail: bool,
}

impl MockRegistry {
    /// Register a well-formed layer (served under its true digest). Returns its digest.
    fn add(&mut self, bytes: Vec<u8>) -> BlobId {
        let id = blob_id(&bytes);
        self.blobs.insert(id, bytes);
        id
    }
    /// Register a POISONED layer: `wrong` bytes served under `claimed` (which is not their digest).
    fn add_poisoned(&mut self, claimed: BlobId, wrong: Vec<u8>) {
        self.blobs.insert(claimed, wrong);
    }
}

impl LayerFetcher for MockRegistry {
    type Error = ();
    fn fetch(&mut self, id: &BlobId) -> Result<Vec<u8>, ()> {
        self.fetch_count += 1;
        if self.fail {
            return Err(());
        }
        self.blobs.get(id).cloned().ok_or(())
    }
}

fn blob(tag: u8, len: usize) -> Vec<u8> {
    let mut v = vec![tag; len];
    v[0] = tag;
    v
}

fn store() -> BlobStore<MemBlobBackend> {
    BlobStore::new(MemBlobBackend::new())
}

#[test]
fn first_pull_fetches_all_layers() {
    let mut reg = MockRegistry::default();
    let a = reg.add(blob(1, 100));
    let b = reg.add(blob(2, 200));
    let mut s = store();

    let r = pull_through(&mut s, &mut reg, &[a, b]).unwrap();
    assert_eq!(r.layers, 2);
    assert_eq!(r.misses, 2);
    assert_eq!(r.hits, 0);
    assert_eq!(r.bytes_fetched, 300);
    assert_eq!(reg.fetch_count, 2);
    assert!(s.has(&a) && s.has(&b));
}

#[test]
fn a_re_pull_is_all_hits_and_zero_network_bytes() {
    // The AC #1 property (minus the tab reload): the second pull of anything cached fetches 0 bytes.
    let mut reg = MockRegistry::default();
    let a = reg.add(blob(1, 100));
    let b = reg.add(blob(2, 200));
    let mut s = store();

    pull_through(&mut s, &mut reg, &[a, b]).unwrap();
    let fetches_after_first = reg.fetch_count;

    let r = pull_through(&mut s, &mut reg, &[a, b]).unwrap();
    assert_eq!(r.hits, 2);
    assert_eq!(r.misses, 0);
    assert_eq!(r.bytes_fetched, 0, "zero network bytes on re-pull");
    assert_eq!(r.bytes_from_cache, 300);
    assert_eq!(reg.fetch_count, fetches_after_first, "no new fetches");
}

#[test]
fn shared_layers_are_fetched_once_across_images() {
    // Image A = [base, a_layer]; Image B = [base, b_layer]. Pulling B fetches only b_layer.
    let mut reg = MockRegistry::default();
    let base = reg.add(blob(0, 500));
    let a_layer = reg.add(blob(1, 50));
    let b_layer = reg.add(blob(2, 60));
    let mut s = store();

    pull_through(&mut s, &mut reg, &[base, a_layer]).unwrap();
    let after_a = reg.fetch_count;

    let r = pull_through(&mut s, &mut reg, &[base, b_layer]).unwrap();
    assert_eq!(r.hits, 1, "base was already cached");
    assert_eq!(r.misses, 1, "only b_layer fetched");
    assert_eq!(r.bytes_fetched, 60);
    assert_eq!(
        reg.fetch_count - after_a,
        1,
        "exactly one new network fetch"
    );
}

#[test]
fn a_duplicate_digest_within_one_pull_is_deduped() {
    let mut reg = MockRegistry::default();
    let a = reg.add(blob(1, 100));
    let mut s = store();

    let r = pull_through(&mut s, &mut reg, &[a, a]).unwrap();
    assert_eq!(r.misses, 1, "fetched once");
    assert_eq!(r.hits, 1, "second occurrence served from cache");
    assert_eq!(reg.fetch_count, 1);
}

#[test]
fn a_poisoned_source_is_refused_and_caches_nothing() {
    // The registry serves the WRONG bytes under a requested digest → put_expected rejects it.
    let mut reg = MockRegistry::default();
    let real = blob(1, 100);
    let claimed = blob_id(&real);
    reg.add_poisoned(claimed, blob(9, 100)); // wrong bytes under the real digest
    let mut s = store();

    let err = pull_through(&mut s, &mut reg, &[claimed]).unwrap_err();
    assert_eq!(err, PullError::Corrupt { id: claimed });
    assert!(!s.has(&claimed), "nothing cached from a poisoned source");
    assert_eq!(s.len(), 0);
}

#[test]
fn a_corrupted_cache_layer_is_refetched_not_trusted() {
    // AC #3 at the pull layer: a cached layer tampered in the backend is detected on the verified
    // read, evicted, and refetched from the source.
    let mut reg = MockRegistry::default();
    let a = reg.add(blob(1, 128));
    let mut s = store();
    pull_through(&mut s, &mut reg, &[a]).unwrap();
    let after_first = reg.fetch_count;

    // Tamper the cached bytes under the correct key.
    s.backend_mut().tamper(&a, &blob(9, 128));

    let r = pull_through(&mut s, &mut reg, &[a]).unwrap();
    assert_eq!(r.misses, 1, "corrupt cache entry forced a refetch");
    assert_eq!(r.hits, 0);
    assert_eq!(reg.fetch_count - after_first, 1);
    // And the good bytes are cached again + retrievable.
    assert_eq!(s.get(&a).as_deref(), Some(blob(1, 128).as_slice()));
}

#[test]
fn a_fetch_error_propagates() {
    let mut reg = MockRegistry {
        fail: true,
        ..MockRegistry::default()
    };
    let missing = blob_id(&blob(1, 10));
    let mut s = store();
    assert_eq!(
        pull_through(&mut s, &mut reg, &[missing]),
        Err(PullError::Fetch(()))
    );
}

#[test]
fn an_empty_pull_fetches_nothing() {
    let mut reg = MockRegistry::default();
    let mut s = store();
    let r = pull_through(&mut s, &mut reg, &[]).unwrap();
    assert_eq!(r, super::PullReport::default());
    assert_eq!(reg.fetch_count, 0);
}
