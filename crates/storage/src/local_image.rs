//! E5-T34a: the whole-image prefill source. When the loader has already downloaded (and SHA-256
//! checked) the entire raw base image into a host-side buffer, the fetch layer serves every chunk
//! from that buffer instead of the network. PURE by construction, like [`crate::fetch`]: the wasm
//! glue only slices the JS buffer and drives these decisions.
//!
//! * [`LocalImage::admit`] — accept a buffer only if its length is exactly `manifest.image_len`
//!   (and addressable by the 32-bit typed-array view the browser hands over).
//! * [`LocalImage::chunk_range`] — the half-open byte range `[start, end)` of chunk `i`, derived
//!   from the SAME [`crate::ChunkIndex::chunk_len`] that [`ImageManifest::verify_chunk`] checks
//!   against (so the slice and the verifier can never disagree about a short tail chunk).
//! * [`LocalImage::verify`] — hash-verify the sliced bytes; a mismatch is a PERMANENT
//!   [`FetchFailure::LocalImageCorrupt`]. The fetch layer never falls back to the network for a
//!   corrupt local image: the same bytes would be served again, and silently mixing sources would
//!   hide the corruption.

use crate::{FetchFailure, ImageManifest};
use alloc::vec::Vec;

/// Why a whole-image buffer was refused at admission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalImageError {
    /// The buffer length is not the manifest's `image_len`.
    SizeMismatch { expected: u64, got: u64 },
    /// The image is larger than a 32-bit typed-array offset can address.
    TooLarge { image_len: u64 },
}

/// An admitted whole-image source: proof that its length matched the manifest. Holds no bytes —
/// the bytes stay wherever the host keeps them (JS memory in the browser, a slice in tests).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalImage {
    image_len: u64,
}

impl LocalImage {
    /// Admit a whole-image buffer of `len` bytes for `manifest`. Refuses any length other than
    /// `image_len`, and any image a `u32` typed-array offset cannot address.
    pub fn admit(manifest: &ImageManifest, len: u64) -> Result<LocalImage, LocalImageError> {
        if len != manifest.image_len {
            return Err(LocalImageError::SizeMismatch {
                expected: manifest.image_len,
                got: len,
            });
        }
        if manifest.image_len > u64::from(u32::MAX) {
            return Err(LocalImageError::TooLarge {
                image_len: manifest.image_len,
            });
        }
        Ok(LocalImage {
            image_len: manifest.image_len,
        })
    }

    /// The admitted image length.
    pub fn image_len(&self) -> u64 {
        self.image_len
    }

    /// The half-open byte range `[start, end)` of `chunk` within the whole image. An out-of-range
    /// chunk is a permanent failure (a malformed request, never a reason to touch the network).
    pub fn chunk_range(
        &self,
        manifest: &ImageManifest,
        chunk: usize,
    ) -> Result<(u32, u32), FetchFailure> {
        let idx = manifest.index();
        let len = idx.chunk_len(chunk);
        if len == 0 || chunk >= manifest.chunks.len() {
            return Err(FetchFailure::LocalImageCorrupt { chunk });
        }
        let start = chunk as u64 * idx.chunk_size();
        let end = start + len;
        if end > self.image_len {
            return Err(FetchFailure::LocalImageCorrupt { chunk });
        }
        // admit() bounded image_len to u32, so both fit.
        Ok((start as u32, end as u32))
    }

    /// Verify the sliced bytes of `chunk` against the manifest hash. Any mismatch (hash or
    /// length) is a permanent [`FetchFailure::LocalImageCorrupt`].
    pub fn verify(
        &self,
        manifest: &ImageManifest,
        chunk: usize,
        bytes: &[u8],
    ) -> Result<(), FetchFailure> {
        manifest
            .verify_chunk(chunk, bytes)
            .map_err(|_| FetchFailure::LocalImageCorrupt { chunk })
    }

    /// Slice + verify `chunk` out of an in-memory `image` (the native composition of
    /// [`Self::chunk_range`] and [`Self::verify`] — the wasm glue performs the same two steps
    /// against a JS `Uint8Array`).
    pub fn serve(
        &self,
        manifest: &ImageManifest,
        image: &[u8],
        chunk: usize,
    ) -> Result<Vec<u8>, FetchFailure> {
        let (start, end) = self.chunk_range(manifest, chunk)?;
        let bytes = image
            .get(start as usize..end as usize)
            .ok_or(FetchFailure::LocalImageCorrupt { chunk })?;
        self.verify(manifest, chunk, bytes)?;
        Ok(bytes.to_vec())
    }
}

#[cfg(test)]
mod tests;
