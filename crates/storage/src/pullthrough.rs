//! Pull-through layer cache (E3.5-T04) — the native wiring that checks the content-addressed
//! [`BlobStore`] **before** any network fetch, so re-pulling anything already cached transfers zero
//! bytes and layers shared between images are fetched once. The fetch path is a [`LayerFetcher`]
//! trait, so this is exhaustively testable headlessly (a mock counting fetcher); the browser leg
//! plugs the real HTTP/`fetch` layer and its own IndexedDB backend. Deterministic `no_std`.
//!
//! A cache *hit* is a **verified** read: a stored layer is re-hashed (via [`BlobStore::get`]) before
//! it counts as a hit, so a tampered/lost cached layer becomes a miss and is refetched — never
//! trusted. A fetched layer is stored via [`BlobStore::put_expected`], which refuses bytes that don't
//! hash to the requested digest (a poisoned source can't populate the cache).

use crate::blobstore::{BlobBackend, BlobId, BlobStore};
use alloc::vec::Vec;

/// Fetches a layer's raw (compressed) bytes by digest — the network path.
pub trait LayerFetcher {
    type Error;
    fn fetch(&mut self, id: &BlobId) -> Result<Vec<u8>, Self::Error>;
}

/// The outcome of a pull — the `cacheStats` surface + the dedupe/savings proof.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PullReport {
    /// Layers requested.
    pub layers: usize,
    /// Layers served from cache (0 network bytes).
    pub hits: usize,
    /// Layers fetched over the network.
    pub misses: usize,
    /// Network bytes transferred (sum of fetched layer sizes).
    pub bytes_fetched: usize,
    /// Bytes served from cache instead of the network (the savings / dedupe measure).
    pub bytes_from_cache: usize,
}

/// A pull failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullError<E> {
    /// The fetcher (network) failed.
    Fetch(E),
    /// A fetched layer did not hash to the digest requested — a poisoned/wrong source; nothing was
    /// stored.
    Corrupt { id: BlobId },
}

/// Pull `layers` (by digest) through the cache: each layer is served from `store` if present and
/// valid, else fetched, verified, and cached. Returns the [`PullReport`]. The order of `layers` is
/// preserved for deterministic accounting; a duplicate digest within one call is a hit after the
/// first occurrence (deduped).
pub fn pull_through<B, F>(
    store: &mut BlobStore<B>,
    fetcher: &mut F,
    layers: &[BlobId],
) -> Result<PullReport, PullError<F::Error>>
where
    B: BlobBackend,
    F: LayerFetcher,
{
    let mut report = PullReport {
        layers: layers.len(),
        ..PullReport::default()
    };
    for id in layers {
        // A verified cache read: `get` re-hashes and evicts on mismatch, so a hit is trustworthy and
        // a corrupted/lost cached layer falls through to a refetch.
        if let Some(bytes) = store.get(id) {
            report.hits += 1;
            report.bytes_from_cache += bytes.len();
            continue;
        }
        let bytes = fetcher.fetch(id).map_err(PullError::Fetch)?;
        // The source's bytes must hash to the digest we asked for, or the cache stays clean.
        store
            .put_expected(id, &bytes)
            .map_err(|_| PullError::Corrupt { id: *id })?;
        report.misses += 1;
        report.bytes_fetched += bytes.len();
    }
    Ok(report)
}

#[cfg(test)]
#[path = "pullthrough_tests.rs"]
mod pullthrough_tests;
