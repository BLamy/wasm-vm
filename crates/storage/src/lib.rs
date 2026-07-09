//! E3-T01: the chunked disk-image format — a versioned, hash-verified layout that replaces Epic 2's
//! monolithic image download as the base layer for streaming (T02), caching (T03), and copy-on-write
//! (T04). This crate is PURE types + math + SHA-256 verification: browser-agnostic by construction
//! (no `web-sys`/`js-sys`/fetch), `no_std` + `alloc` so it compiles for `wasm32-unknown-unknown`.
//!
//! An image of `image_len` bytes is cut into `ceil(image_len / chunk_size)` fixed-size chunks (the
//! last one — the "tail" — is short when `image_len` is not a multiple of `chunk_size`). The
//! [`ImageManifest`] carries the format version, image length, chunk size, layout, and the ordered
//! per-chunk SHA-256 hashes. [`ChunkIndex`] does the guest-offset ↔ chunk math. See
//! `docs/design/chunked-image.md`.
#![no_std]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

mod cache;
mod dbmeta;
mod fetch;
pub mod oci;
mod overlay;
mod prefetch;
mod writeback;
pub use cache::{BlockCache, CacheMetrics};
pub use dbmeta::{OVERLAY_DB_VERSION, OverlayMeta, overlay_store_name};
pub use fetch::{
    ChunkRequest, ChunkStore, FetchFailure, ResponseAction, RetryPolicy, classify_response,
    plan_fetches,
};
pub use overlay::{
    MemOverlay, OVERLAY_BLOCK, OVERLAY_FORMAT_VERSION, OverlayBackend, OverlayDisk, OverlayError,
    OverlayOutcome,
};
pub use prefetch::{PrefetchTracker, Readahead, boot_prefetch};
pub use writeback::{PersistQueue, SharedPersistQueue, WriteBackOverlay};

/// The one format version this reader understands. Bumped only on an incompatible change; unknown
/// *fields* are ignored (forward-compatible), but an unknown *version* is a hard error.
pub const FORMAT_VERSION: u32 = 1;

/// Errors from parsing/validating a manifest or verifying a chunk. Every failure is one of these —
/// never a panic (the adversarial bar: hand-edited manifests and flipped bytes must be typed errors).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageError {
    /// The manifest JSON did not parse (message from serde_json).
    Json(String),
    /// `version` is not [`FORMAT_VERSION`].
    VersionMismatch { found: u32, supported: u32 },
    /// `chunk_size` is zero or not a power of two.
    BadChunkSize(u32),
    /// The layout string is not `"split"` or `"blob"`.
    UnsupportedLayout(String),
    /// `chunks.len()` does not equal the count derived from `image_len` and `chunk_size`.
    ChunkCountMismatch { declared: usize, derived: u64 },
    /// A chunk hash is not 64 lowercase/uppercase hex characters.
    BadHashHex { chunk: usize },
    /// A chunk index is past the end of the image.
    ChunkIndexOutOfRange { chunk: usize, count: u64 },
    /// A chunk's byte length does not match its expected (possibly tail) size.
    TruncatedChunk {
        chunk: usize,
        expected: u64,
        got: u64,
    },
    /// A chunk's bytes hash to something other than the manifest's declared hash.
    HashMismatch { chunk: usize },
    /// A byte offset is at or beyond `image_len`.
    OffsetOutOfRange { offset: u64, image_len: u64 },
}

/// How the chunks are stored. Both are representable in the manifest; the reader here is layout-
/// agnostic (it only does math + verification) — the fetch layer (T02) chooses how to load bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    /// One immutable, content-addressed file per chunk: `chunks/{sha256}.bin` (CDN/cache friendly).
    Split,
    /// A single file addressed by HTTP Range: `[chunk_index * chunk_size, +chunk_len)`.
    Blob,
}

/// The parsed manifest. Deserialized from JSON; unknown fields are ignored (forward-compat). Use
/// [`ImageManifest::from_json`] (which also validates) rather than deserializing directly.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct ImageManifest {
    /// Format version — must equal [`FORMAT_VERSION`].
    pub version: u32,
    /// Total image length in bytes.
    pub image_len: u64,
    /// Fixed chunk size in bytes (power of two; the last chunk may be shorter).
    pub chunk_size: u32,
    /// Chunk storage layout.
    pub layout: Layout,
    /// Ordered hex SHA-256 of each chunk (producers write lowercase; the reader accepts either
    /// case). `chunks.len()` must equal the count derived from `image_len` and `chunk_size`.
    pub chunks: Vec<String>,
}

impl ImageManifest {
    /// Parse a manifest from JSON and fully validate it (version, chunk size, chunk count vs
    /// `image_len`, hash-hex shape). Unknown JSON fields are ignored.
    pub fn from_json(s: &str) -> Result<ImageManifest, ImageError> {
        let m: ImageManifest =
            serde_json::from_str(s).map_err(|e| ImageError::Json(alloc::format!("{e}")))?;
        m.validate()?;
        Ok(m)
    }

    /// Build a manifest by chunking `image` at `chunk_size` (SHA-256 per chunk). The producer side of
    /// the format (E3-T02 pass 4 tooling): the CLI writes these hashes as `chunks/{hash}.bin` (split)
    /// or the caller keeps `image` as one blob. `chunk_size` must be a non-zero power of two — the
    /// returned manifest satisfies [`Self::validate`]. The last chunk is short when `image.len()` is
    /// not a multiple of `chunk_size`.
    pub fn from_image(
        image: &[u8],
        chunk_size: u32,
        layout: Layout,
    ) -> Result<ImageManifest, ImageError> {
        if chunk_size == 0 || !chunk_size.is_power_of_two() {
            return Err(ImageError::BadChunkSize(chunk_size));
        }
        let chunks: Vec<String> = image
            .chunks(chunk_size as usize)
            .map(|c| encode_hex32(&Sha256::digest(c)))
            .collect();
        let m = ImageManifest {
            version: FORMAT_VERSION,
            image_len: image.len() as u64,
            chunk_size,
            layout,
            chunks,
        };
        // A well-formed input always yields a valid manifest; validate defends against a future bug.
        m.validate()?;
        Ok(m)
    }

    /// A stable 32-byte identity for this exact base image — SHA-256 of the canonical manifest JSON,
    /// which folds in the version, length, **chunk size**, layout, and every chunk hash. A copy-on-write
    /// overlay records this and refuses to attach to any other base (E3-T04): a re-chunked image (same
    /// bytes, different `chunk_size`) hashes differently, so an overlay cannot silently ride the wrong
    /// geometry. Not a security boundary — a collision-resistant binding, not an auth token.
    pub fn base_hash(&self) -> [u8; 32] {
        Sha256::digest(self.to_json().as_bytes()).into()
    }

    /// Serialize to compact JSON (the manifest a `newChunkedDisk` boot loads). Round-trips through
    /// [`Self::from_json`].
    pub fn to_json(&self) -> String {
        // The manifest is plain scalars + a string vec — serialization cannot fail; fall back to an
        // empty object on the impossible error rather than panicking.
        serde_json::to_string(self).unwrap_or_else(|_| String::from("{}"))
    }

    /// Validate all internal invariants. Called by [`Self::from_json`]; also usable on a
    /// hand-constructed manifest.
    pub fn validate(&self) -> Result<(), ImageError> {
        if self.version != FORMAT_VERSION {
            return Err(ImageError::VersionMismatch {
                found: self.version,
                supported: FORMAT_VERSION,
            });
        }
        if self.chunk_size == 0 || !self.chunk_size.is_power_of_two() {
            return Err(ImageError::BadChunkSize(self.chunk_size));
        }
        let derived = derived_chunk_count(self.image_len, self.chunk_size as u64);
        if self.chunks.len() as u64 != derived {
            return Err(ImageError::ChunkCountMismatch {
                declared: self.chunks.len(),
                derived,
            });
        }
        for (i, h) in self.chunks.iter().enumerate() {
            // Sweep-critic (E3-T01 LOW): LOWERCASE hex only. `base_hash` hashes these strings
            // as-is, so an uppercase variant of the same digest would bind persisted overlays
            // to a different base identity (safe direction — refuse-to-attach — but an
            // orphaning hazard). Both producers emit lowercase; the reader now enforces it.
            if h.len() != 64
                || !h
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            {
                return Err(ImageError::BadHashHex { chunk: i });
            }
        }
        Ok(())
    }

    /// A validated [`ChunkIndex`] for the offset↔chunk math.
    pub fn index(&self) -> ChunkIndex {
        // validate() (run by from_json) guarantees chunk_size is a valid power of two.
        ChunkIndex {
            image_len: self.image_len,
            chunk_size: self.chunk_size as u64,
            chunk_count: derived_chunk_count(self.image_len, self.chunk_size as u64),
        }
    }

    /// Verify that `bytes` is exactly chunk `chunk` of this image: correct length (short for the
    /// tail chunk) AND SHA-256 matching the manifest. A flipped byte or truncated chunk is a typed
    /// error, never a panic.
    pub fn verify_chunk(&self, chunk: usize, bytes: &[u8]) -> Result<(), ImageError> {
        // Bounds-check against the ACTUAL hash vector (not the derived count) so `self.chunks[chunk]`
        // below can never OOB-panic, even on an unvalidated manifest whose declared count and
        // `chunks.len()` disagree.
        if chunk >= self.chunks.len() {
            return Err(ImageError::ChunkIndexOutOfRange {
                chunk,
                count: self.chunks.len() as u64,
            });
        }
        // A 0 chunk_size (only from an unvalidated manifest) is a bad manifest, not a panic.
        if self.chunk_size == 0 {
            return Err(ImageError::BadChunkSize(0));
        }
        let idx = self.index();
        let expected = idx.chunk_len(chunk);
        if bytes.len() as u64 != expected {
            return Err(ImageError::TruncatedChunk {
                chunk,
                expected,
                got: bytes.len() as u64,
            });
        }
        let want = decode_hex32(&self.chunks[chunk]).ok_or(ImageError::BadHashHex { chunk })?;
        let got = Sha256::digest(bytes);
        if got.as_slice() != want {
            return Err(ImageError::HashMismatch { chunk });
        }
        Ok(())
    }
}

/// Maps guest byte offsets to `(chunk index, intra-chunk offset)` and reports per-chunk lengths.
/// Constructed from a validated manifest via [`ImageManifest::index`], so its `chunk_size` is a
/// valid power of two and `chunk_count` matches the manifest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChunkIndex {
    image_len: u64,
    chunk_size: u64,
    chunk_count: u64,
}

impl ChunkIndex {
    /// Total image length in bytes.
    pub fn image_len(&self) -> u64 {
        self.image_len
    }
    /// Fixed chunk size in bytes.
    pub fn chunk_size(&self) -> u64 {
        self.chunk_size
    }
    /// Number of chunks (0 for a 0-byte image).
    pub fn chunk_count(&self) -> u64 {
        self.chunk_count
    }

    /// The chunk index and intra-chunk offset holding byte `offset`. `offset >= image_len` (which
    /// includes every offset of a 0-byte image) is [`ImageError::OffsetOutOfRange`].
    pub fn locate(&self, offset: u64) -> Result<(usize, u64), ImageError> {
        // `chunk_size == 0` (only from an unvalidated manifest) means no addressable bytes; guard it
        // so the division below can never panic.
        if self.chunk_size == 0 || offset >= self.image_len {
            return Err(ImageError::OffsetOutOfRange {
                offset,
                image_len: self.image_len,
            });
        }
        Ok((
            (offset / self.chunk_size) as usize,
            offset % self.chunk_size,
        ))
    }

    /// The byte length of chunk `chunk`: `chunk_size` for every chunk but the last (tail) one, which
    /// is `image_len - (chunk_count-1)*chunk_size`. Returns 0 for an out-of-range chunk.
    pub fn chunk_len(&self, chunk: usize) -> u64 {
        let c = chunk as u64;
        if c >= self.chunk_count {
            return 0;
        }
        if c + 1 < self.chunk_count {
            self.chunk_size
        } else {
            // Last chunk: the remainder, or a full chunk when image_len is an exact multiple.
            self.image_len - c * self.chunk_size
        }
    }

    /// The set of chunk indices a read of `[offset, offset+len)` touches — `[first, last]`. `Err` if
    /// the range is out of bounds. A read spanning a chunk boundary needs every chunk in the span.
    pub fn chunk_span(&self, offset: u64, len: u64) -> Result<(usize, usize), ImageError> {
        let end = offset
            .checked_add(len)
            .ok_or(ImageError::OffsetOutOfRange {
                offset,
                image_len: self.image_len,
            })?;
        // `chunk_size == 0` (only from an unvalidated manifest) means no addressable bytes; guard it
        // so the divisions below can never panic — mirroring `locate` (critic round-2 BUG 2).
        if self.chunk_size == 0 || len == 0 || end > self.image_len {
            // A zero-length read touches nothing; a past-the-end read is invalid.
            return Err(ImageError::OffsetOutOfRange {
                offset,
                image_len: self.image_len,
            });
        }
        let first = (offset / self.chunk_size) as usize;
        let last = ((end - 1) / self.chunk_size) as usize;
        Ok((first, last))
    }

    /// The deterministic lazy read-path: assemble `[offset, offset+len)` from `source`, or report the
    /// FIRST chunk that is not yet available so the caller (the async fetch layer) can fetch it and
    /// retry. Pure and synchronous — the async I/O lives entirely in the fetch layer; this is the
    /// core logic the device model's deferred-completion path (E3-T02) drives.
    pub fn read<S: ChunkSource>(
        &self,
        source: &S,
        offset: u64,
        len: u64,
    ) -> Result<ReadOutcome, ImageError> {
        let (first, last) = self.chunk_span(offset, len)?;
        // A read never crosses more than a handful of chunks; collect its bytes chunk by chunk.
        let mut out = Vec::with_capacity(len as usize);
        for c in first..=last {
            let Some(chunk) = source.get(c) else {
                return Ok(ReadOutcome::NeedChunk(c));
            };
            // Guard against a source handing back a wrong-length chunk (never trust the fetch layer).
            if chunk.len() as u64 != self.chunk_len(c) {
                return Err(ImageError::TruncatedChunk {
                    chunk: c,
                    expected: self.chunk_len(c),
                    got: chunk.len() as u64,
                });
            }
            let base = c as u64 * self.chunk_size;
            let lo = offset.saturating_sub(base).min(chunk.len() as u64) as usize;
            let hi = (offset + len).saturating_sub(base).min(chunk.len() as u64) as usize;
            out.extend_from_slice(&chunk[lo..hi]);
        }
        Ok(ReadOutcome::Ready(out))
    }
}

/// A source of (already-fetched, already-hash-verified) chunk bytes. `get` returns the bytes if the
/// chunk is resident, or `None` if it must still be fetched. Synchronous by design: the async fetch,
/// hash-verify (E3-T01 `verify_chunk`), and caching all live in the wasm layer, which populates
/// whatever backs this source, so `crates/storage` stays browser-agnostic. A read of an absent chunk
/// yields [`ReadOutcome::NeedChunk`] so the caller can fetch and retry (deferred virtio-blk completion).
pub trait ChunkSource {
    /// The bytes of chunk `chunk` if resident, else `None`.
    fn get(&self, chunk: usize) -> Option<&[u8]>;
}

/// The outcome of [`ChunkIndex::read`]: either the requested bytes, or the first chunk that must be
/// fetched before the read can complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadOutcome {
    /// All touched chunks were resident; here are the `[offset, offset+len)` bytes.
    Ready(Vec<u8>),
    /// Chunk `usize` is not yet resident — fetch it, then retry the read.
    NeedChunk(usize),
}

/// `ceil(image_len / chunk_size)`. Guards `chunk_size == 0` (→ 0) so it never divides by zero even
/// on an unvalidated, hand-constructed manifest — every public method must be panic-free.
fn derived_chunk_count(image_len: u64, chunk_size: u64) -> u64 {
    if image_len == 0 || chunk_size == 0 {
        0
    } else {
        image_len.div_ceil(chunk_size)
    }
}

/// Encode 32 bytes as 64 lowercase hex chars (the manifest's per-chunk hash form).
fn encode_hex32(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

/// Decode exactly 64 hex chars into 32 bytes; `None` on a wrong length or a non-hex character.
fn decode_hex32(s: &str) -> Option<[u8; 32]> {
    let b = s.as_bytes();
    if b.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, pair) in b.chunks_exact(2).enumerate() {
        let hi = (pair[0] as char).to_digit(16)?;
        let lo = (pair[1] as char).to_digit(16)?;
        out[i] = ((hi << 4) | lo) as u8;
    }
    Some(out)
}

#[cfg(test)]
mod tests;
