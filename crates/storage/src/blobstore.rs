//! Content-addressed blob store (E3.5-T04) — the native, `no_std` core of the browser OCI layer
//! cache. Blobs are immutable and content-addressed (their sha256 digest IS the key), which is the
//! easy case: put-once / get-forever, **verified-on-read** (re-hash on load; a corrupted stored blob
//! is evicted and never trusted), **deduped** across images (a digest already present is stored
//! once), and **LRU-evicted over UNPINNED blobs** under a byte budget (a pinned image — one the user
//! ran — stays runnable offline).
//!
//! This is backend-agnostic: the browser leg plugs an IndexedDB [`BlobBackend`] and adds the
//! reload-survival + JS `cacheStats` surface (deferred). The store's index (sizes, pin state, LRU
//! order, hit/miss counters) lives here and is exhaustively unit-testable with the in-memory
//! [`MemBlobBackend`]. Access recency uses a **logical clock** (a monotonic tick), not wall-clock —
//! the crate is `no_std` and must stay deterministic.

use alloc::collections::BTreeMap;
use alloc::vec::Vec;
use sha2::{Digest, Sha256};

/// A blob's identity: its raw sha256 digest.
pub type BlobId = [u8; 32];

/// Compute the content address of `bytes`.
pub fn blob_id(bytes: &[u8]) -> BlobId {
    Sha256::digest(bytes).into()
}

/// A rejected store operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlobError {
    /// The bytes offered for `expected` did not hash to it — refused (never stored unverified).
    DigestMismatch { expected: BlobId, actual: BlobId },
}

/// A pluggable byte store keyed by [`BlobId`]. The browser impl is IndexedDB; tests use
/// [`MemBlobBackend`]. It stores raw bytes only — all verification/accounting lives in [`BlobStore`],
/// so a backend that returns wrong/tampered bytes is still caught on read.
pub trait BlobBackend {
    /// Store `bytes` under `id` (overwrites — the caller has already content-verified).
    fn put(&mut self, id: &BlobId, bytes: &[u8]);
    /// Fetch the bytes stored under `id`, if any.
    fn get(&self, id: &BlobId) -> Option<Vec<u8>>;
    /// Remove `id` if present.
    fn delete(&mut self, id: &BlobId);
}

/// Per-blob index entry (bytes live in the backend).
#[derive(Debug, Clone, Copy)]
struct BlobMeta {
    size: usize,
    pinned: bool,
    /// Logical time of last access — the LRU key.
    last_access: u64,
}

/// The content-addressed store over a [`BlobBackend`].
#[derive(Debug)]
pub struct BlobStore<B: BlobBackend> {
    backend: B,
    index: BTreeMap<BlobId, BlobMeta>,
    total_bytes: usize,
    clock: u64,
    hits: u64,
    misses: u64,
}

impl<B: BlobBackend> BlobStore<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            index: BTreeMap::new(),
            total_bytes: 0,
            clock: 0,
            hits: 0,
            misses: 0,
        }
    }

    fn tick(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    /// Store `bytes`, returning its content address. Idempotent: a digest already present is **not**
    /// re-stored (dedupe) — its size counts once — but its access recency is refreshed.
    pub fn put(&mut self, bytes: &[u8]) -> BlobId {
        let id = blob_id(bytes);
        let now = self.tick();
        if let Some(meta) = self.index.get_mut(&id) {
            meta.last_access = now; // dedupe hit — already stored, just touch
        } else {
            self.backend.put(&id, bytes);
            self.total_bytes += bytes.len();
            self.index.insert(
                id,
                BlobMeta {
                    size: bytes.len(),
                    pinned: false,
                    last_access: now,
                },
            );
        }
        id
    }

    /// Store bytes fetched for an **expected** digest (the pull-through path). The bytes are verified
    /// to hash to `expected` before anything is stored — wrong bytes under a correct key are refused,
    /// so the store never holds unverified content, even transiently.
    pub fn put_expected(&mut self, expected: &BlobId, bytes: &[u8]) -> Result<(), BlobError> {
        let actual = blob_id(bytes);
        if actual != *expected {
            return Err(BlobError::DigestMismatch {
                expected: *expected,
                actual,
            });
        }
        self.put(bytes);
        Ok(())
    }

    /// Fetch and **verify** a blob. The stored bytes are re-hashed; if they don't match the key
    /// (tampering, truncation, wrong bytes under a correct key), the blob is **evicted and `None`
    /// returned** — corrupt content is never handed back to be unpacked. A hit refreshes recency.
    pub fn get(&mut self, id: &BlobId) -> Option<Vec<u8>> {
        if !self.index.contains_key(id) {
            self.misses += 1;
            return None;
        }
        match self.backend.get(id) {
            Some(bytes) if blob_id(&bytes) == *id => {
                let now = self.tick();
                if let Some(meta) = self.index.get_mut(id) {
                    meta.last_access = now;
                }
                self.hits += 1;
                Some(bytes)
            }
            _ => {
                // Missing, tampered, or truncated → drop it; the caller must refetch.
                self.remove(id);
                self.misses += 1;
                None
            }
        }
    }

    /// Is a (still-indexed) blob present? Does not verify — use [`Self::get`] to trust the bytes.
    pub fn has(&self, id: &BlobId) -> bool {
        self.index.contains_key(id)
    }

    /// Remove a blob from the store (backend + index), adjusting the size accounting.
    pub fn remove(&mut self, id: &BlobId) -> bool {
        if let Some(meta) = self.index.remove(id) {
            self.total_bytes -= meta.size;
            self.backend.delete(id);
            true
        } else {
            false
        }
    }

    /// Pin a blob so it is never LRU-evicted (a running/used image). No-op if absent.
    pub fn pin(&mut self, id: &BlobId) {
        if let Some(meta) = self.index.get_mut(id) {
            meta.pinned = true;
        }
    }

    /// Unpin a blob, making it eligible for eviction again.
    pub fn unpin(&mut self, id: &BlobId) {
        if let Some(meta) = self.index.get_mut(id) {
            meta.pinned = false;
        }
    }

    pub fn is_pinned(&self, id: &BlobId) -> bool {
        self.index.get(id).is_some_and(|m| m.pinned)
    }

    /// Evict UNPINNED blobs, least-recently-accessed first, until the total is within `budget` bytes.
    /// Pinned blobs are never evicted — so if only pinned blobs remain the total may exceed `budget`
    /// (offline-runnable images are kept at the cost of the budget). Returns the evicted ids in
    /// eviction order.
    pub fn evict_to(&mut self, budget: usize) -> Vec<BlobId> {
        let mut evicted = Vec::new();
        while self.total_bytes > budget {
            // Find the unpinned blob with the smallest last_access.
            let victim = self
                .index
                .iter()
                .filter(|(_, m)| !m.pinned)
                .min_by_key(|(_, m)| m.last_access)
                .map(|(id, _)| *id);
            match victim {
                Some(id) => {
                    self.remove(&id);
                    evicted.push(id);
                }
                None => break, // only pinned blobs left — cannot shrink further
            }
        }
        evicted
    }

    /// Total bytes currently stored (the dedupe-aware cache size).
    pub fn total_bytes(&self) -> usize {
        self.total_bytes
    }
    /// Number of distinct blobs stored.
    pub fn len(&self) -> usize {
        self.index.len()
    }
    pub fn is_empty(&self) -> bool {
        self.index.is_empty()
    }
    /// Verified-read hits (for the `cacheStats` surface).
    pub fn hits(&self) -> u64 {
        self.hits
    }
    /// Misses + verification failures.
    pub fn misses(&self) -> u64 {
        self.misses
    }

    /// Test-only: reach the backend to model an attacker tampering with the underlying store.
    #[cfg(test)]
    fn backend_mut(&mut self) -> &mut B {
        &mut self.backend
    }
}

/// An in-memory [`BlobBackend`] (tests, and a browser fallback when persistence is unavailable).
#[derive(Debug, Default)]
pub struct MemBlobBackend {
    map: BTreeMap<BlobId, Vec<u8>>,
}

impl MemBlobBackend {
    pub fn new() -> Self {
        Self::default()
    }
    /// Test/adversarial hook: write raw bytes under a key WITHOUT going through the store — models an
    /// attacker tampering with the underlying IndexedDB (wrong/truncated bytes under a correct key).
    pub fn tamper(&mut self, id: &BlobId, bytes: &[u8]) {
        self.map.insert(*id, bytes.to_vec());
    }
    /// Raw backend read (bypasses store verification) — for asserting what physically remains.
    pub fn raw_len(&self) -> usize {
        self.map.len()
    }
}

impl BlobBackend for MemBlobBackend {
    fn put(&mut self, id: &BlobId, bytes: &[u8]) {
        self.map.insert(*id, bytes.to_vec());
    }
    fn get(&self, id: &BlobId) -> Option<Vec<u8>> {
        self.map.get(id).cloned()
    }
    fn delete(&mut self, id: &BlobId) {
        self.map.remove(id);
    }
}

#[cfg(test)]
#[path = "blobstore_tests.rs"]
mod blobstore_tests;
