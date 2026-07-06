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
use serde::Deserialize;
use sha2::{Digest, Sha256};

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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    /// One immutable, content-addressed file per chunk: `chunks/{sha256}.bin` (CDN/cache friendly).
    Split,
    /// A single file addressed by HTTP Range: `[chunk_index * chunk_size, +chunk_len)`.
    Blob,
}

/// The parsed manifest. Deserialized from JSON; unknown fields are ignored (forward-compat). Use
/// [`ImageManifest::from_json`] (which also validates) rather than deserializing directly.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ImageManifest {
    /// Format version — must equal [`FORMAT_VERSION`].
    pub version: u32,
    /// Total image length in bytes.
    pub image_len: u64,
    /// Fixed chunk size in bytes (power of two; the last chunk may be shorter).
    pub chunk_size: u32,
    /// Chunk storage layout.
    pub layout: Layout,
    /// Ordered lowercase-hex SHA-256 of each chunk. `chunks.len()` must equal the derived count.
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
            if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
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
        let idx = self.index();
        if chunk as u64 >= idx.chunk_count {
            return Err(ImageError::ChunkIndexOutOfRange {
                chunk,
                count: idx.chunk_count,
            });
        }
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
        if offset >= self.image_len {
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
}

/// `ceil(image_len / chunk_size)` — chunk_size is a nonzero power of two here, so no overflow.
fn derived_chunk_count(image_len: u64, chunk_size: u64) -> u64 {
    if image_len == 0 {
        0
    } else {
        image_len.div_ceil(chunk_size)
    }
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
