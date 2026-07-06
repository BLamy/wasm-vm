//! E3-T02 pass 3: the browser-agnostic fetch-protocol logic that the wasm `HttpChunkSource`
//! drives. PURE by construction — no `web-sys`/`fetch`/async here (the actual network call is the
//! wasm layer's job); this module owns everything about *what* to fetch and *whether to accept it*
//! so it can be exhaustively unit-tested natively:
//!
//! * [`ImageManifest::chunk_request`] — the URL (split) or byte Range (blob) for a chunk.
//! * [`classify_response`] — the accept/retry/fail decision for an HTTP status, including the
//!   adversarial 200-instead-of-206 case (a server that ignored `Range` must NOT be silently
//!   buffered as a full-image download).
//! * [`RetryPolicy`] — deterministic bounded retry with exponential backoff (no wall-clock, no rand).
//! * [`ChunkStore`] — the verify-on-insert cache backing [`ChunkSource`]: bytes enter ONLY after
//!   [`ImageManifest::verify_chunk`] passes, so a read can never complete with unverified data.
//! * [`plan_fetches`] — dedup: which pending chunks to *newly* fetch given what's resident/in-flight.

use crate::{ChunkSource, ImageError, ImageManifest, Layout};
use alloc::collections::{BTreeMap, BTreeSet};
use alloc::string::String;
use alloc::vec::Vec;

/// How to fetch one chunk over HTTP. For `split` layout it's a content-addressed URL; for `blob`
/// layout it's the single image URL plus an **inclusive** byte range for an `HTTP Range` header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkRequest {
    /// The URL to fetch (already joined onto the manifest's base URL).
    pub url: String,
    /// `Some((first, last))` — an inclusive byte range for `Range: bytes=first-last` (blob layout).
    /// `None` — fetch the whole resource (split layout: the file *is* exactly the chunk).
    pub range: Option<(u64, u64)>,
}

impl ImageManifest {
    /// The [`ChunkRequest`] for chunk `chunk`, relative to `base_url` (which must end in `/`; it is
    /// the directory the manifest was loaded from). `split` → `{base_url}chunks/{hash}.bin`;
    /// `blob` → `{base_url}image.blob` with an inclusive Range covering the (possibly short tail)
    /// chunk. Out-of-range chunk or an unvalidated `chunk_size == 0` is a typed error, never a panic.
    pub fn chunk_request(&self, base_url: &str, chunk: usize) -> Result<ChunkRequest, ImageError> {
        if chunk >= self.chunks.len() {
            return Err(ImageError::ChunkIndexOutOfRange {
                chunk,
                count: self.chunks.len() as u64,
            });
        }
        if self.chunk_size == 0 {
            return Err(ImageError::BadChunkSize(0));
        }
        match self.layout {
            Layout::Split => {
                // Content-addressed: the hash IS the filename, so a corrupted CDN entry can't
                // masquerade as a different chunk. verify_chunk re-checks on arrival regardless.
                let hash = &self.chunks[chunk];
                let mut url = String::with_capacity(base_url.len() + 7 + hash.len() + 4);
                url.push_str(base_url);
                url.push_str("chunks/");
                url.push_str(hash);
                url.push_str(".bin");
                Ok(ChunkRequest { url, range: None })
            }
            Layout::Blob => {
                let idx = self.index();
                let start = chunk as u64 * idx.chunk_size();
                let len = idx.chunk_len(chunk);
                // Inclusive end (HTTP Range semantics); len >= 1 for every in-range chunk of a
                // non-empty image, so `start + len - 1` never underflows.
                let last = start + len - 1;
                let mut url = String::with_capacity(base_url.len() + 10);
                url.push_str(base_url);
                url.push_str("image.blob");
                Ok(ChunkRequest {
                    url,
                    range: Some((start, last)),
                })
            }
        }
    }
}

/// What to do with an HTTP response for a chunk fetch, decided from its status code and the layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResponseAction {
    /// The body is the chunk bytes — hand it to [`ChunkStore::provide`] for hash verification.
    Accept,
    /// A transient failure (5xx, 408, 429, or a network error mapped by the caller) — retry per
    /// [`RetryPolicy`], do not treat as fatal yet.
    Retry,
    /// A permanent failure — surface a typed error to the guest (I/O error). Includes the critical
    /// `blob`-layout 200-instead-of-206 case: the server ignored `Range` and would stream the whole
    /// image, which we refuse to buffer.
    Fail(FetchFailure),
}

/// Why a chunk fetch permanently failed (surfaced to the guest as an I/O error; never a panic/hang).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchFailure {
    /// `blob` layout: expected `206 Partial Content`, got `200 OK` — the server ignored the Range
    /// request and would return the entire image. Refuse (never silently buffer a full download).
    RangeIgnored { status: u16 },
    /// A non-retryable HTTP status (e.g. 404, 403, other 4xx).
    HttpStatus { status: u16 },
    /// Retries were exhausted for a chunk (network/5xx/hash mismatch that never resolved).
    RetriesExhausted { chunk: usize },
}

/// Decide what to do with a response `status` for the given `layout`.
///
/// * `blob` + `200` → [`FetchFailure::RangeIgnored`] (the adversarial "server ignored Range" case).
/// * `blob` + `206`, or `split` + `200`/`206` → [`ResponseAction::Accept`].
/// * `408`/`429`/`5xx` → [`ResponseAction::Retry`].
/// * any other 4xx (or an unexpected `3xx`/`1xx`) → permanent [`FetchFailure::HttpStatus`].
pub fn classify_response(layout: Layout, status: u16) -> ResponseAction {
    match status {
        206 => ResponseAction::Accept,
        200 => match layout {
            // The whole point of a Range request is a partial body; a 200 means the server sent
            // (or would send) everything. For blob that is a full-image download — refuse it.
            Layout::Blob => ResponseAction::Fail(FetchFailure::RangeIgnored { status }),
            // split fetches the whole (chunk-sized) file, so 200 is exactly right.
            Layout::Split => ResponseAction::Accept,
        },
        408 | 429 | 500..=599 => ResponseAction::Retry,
        other => ResponseAction::Fail(FetchFailure::HttpStatus { status: other }),
    }
}

/// Deterministic bounded retry with exponential backoff. No wall-clock and no randomness — the
/// backoff schedule is a pure function of the attempt number, so behaviour is reproducible (the
/// wasm layer turns `backoff_ms` into an actual timer).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    /// Maximum number of *retries* after the first attempt (so total attempts = `max_retries + 1`).
    pub max_retries: u32,
    /// Backoff for the first retry, in milliseconds; each subsequent retry doubles it up to `cap_ms`.
    pub base_ms: u64,
    /// Upper bound on any single backoff delay.
    pub cap_ms: u64,
}

impl RetryPolicy {
    /// A sensible default: 4 retries (5 attempts total), 100 ms → 200 → 400 → 800, capped at 5 s.
    pub const DEFAULT: RetryPolicy = RetryPolicy {
        max_retries: 4,
        base_ms: 100,
        cap_ms: 5_000,
    };

    /// Whether an `attempt`-th failure (0-based: 0 = the first try failed) should be retried.
    pub fn should_retry(&self, attempt: u32) -> bool {
        attempt < self.max_retries
    }

    /// The backoff before the retry that follows the `attempt`-th failure (0-based). `base_ms << attempt`,
    /// saturating and capped at `cap_ms`, so a large `attempt` can never overflow or wait forever.
    pub fn backoff_ms(&self, attempt: u32) -> u64 {
        let shifted = self
            .base_ms
            .checked_shl(attempt)
            .unwrap_or(self.cap_ms)
            .min(self.cap_ms);
        shifted.min(self.cap_ms)
    }
}

/// The verify-on-insert chunk cache backing [`ChunkSource`]. Bytes enter ONLY through
/// [`Self::provide`], which runs [`ImageManifest::verify_chunk`] first — so a hash-mismatched or
/// truncated chunk is rejected with a typed error and never becomes readable. This is the guarantee
/// that a parked virtio-blk read is never completed with unverified/corrupt data.
#[derive(Debug, Default)]
pub struct ChunkStore {
    resident: BTreeMap<usize, Vec<u8>>,
}

impl ChunkStore {
    /// An empty store.
    pub fn new() -> ChunkStore {
        ChunkStore {
            resident: BTreeMap::new(),
        }
    }

    /// Verify `bytes` against `manifest` for chunk `chunk` and, only if it passes, cache it. Returns
    /// the manifest error (`HashMismatch`, `TruncatedChunk`, `ChunkIndexOutOfRange`, …) on failure —
    /// the store is left unchanged, so corrupt bytes are never served. Idempotent for a valid chunk.
    pub fn provide(
        &mut self,
        manifest: &ImageManifest,
        chunk: usize,
        bytes: Vec<u8>,
    ) -> Result<(), ImageError> {
        manifest.verify_chunk(chunk, &bytes)?;
        self.resident.insert(chunk, bytes);
        Ok(())
    }

    /// Whether chunk `chunk` is resident.
    pub fn contains(&self, chunk: usize) -> bool {
        self.resident.contains_key(&chunk)
    }

    /// How many chunks are resident (for instrumentation / tests).
    pub fn resident_count(&self) -> usize {
        self.resident.len()
    }
}

impl ChunkSource for ChunkStore {
    fn get(&self, chunk: usize) -> Option<&[u8]> {
        self.resident.get(&chunk).map(|v| v.as_slice())
    }
}

/// In-flight fetch dedup: which of `pending` chunks should be *newly* fetched, skipping those already
/// resident in `store` or already `in_flight`. This is the "two simultaneous reads of the same absent
/// chunk cause exactly one fetch" guarantee — the caller records each returned chunk as in-flight
/// before awaiting, so a later `plan_fetches` in the same tick won't re-issue it. Order-preserving
/// and de-duplicated (a chunk listed twice in `pending` is planned at most once).
pub fn plan_fetches(
    pending: &[usize],
    store: &ChunkStore,
    in_flight: &BTreeSet<usize>,
) -> Vec<usize> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for &c in pending {
        if store.contains(c) || in_flight.contains(&c) || seen.contains(&c) {
            continue;
        }
        seen.insert(c);
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests;
