//! E3-T05/T06 durable-overlay schema scaffolding — the `meta` record and DB namespacing shared by the
//! IndexedDB (T05) and OPFS (T06) backends. Browser-agnostic + native-tested: the async store glue in
//! the wasm layer serializes this record into its `meta` store and derives its DB/file name from it.
//!
//! The meta record binds a persisted write layer to an EXACT base image (by [`ImageManifest::base_hash`])
//! and to a format version. On reopen the backend loads the record and [`OverlayMeta::check`]s it against
//! the manifest it is about to attach — a version mismatch or a wrong base is a typed error, NEVER a
//! silent reuse (the block indices would map to the wrong offsets under a different geometry).

use crate::{ImageManifest, OVERLAY_BLOCK, OVERLAY_FORMAT_VERSION, OverlayError};
use alloc::string::String;
use alloc::vec::Vec;

/// The IndexedDB schema version (the `onupgradeneeded` version). Bumped when the object-store layout
/// changes; independent of [`OVERLAY_FORMAT_VERSION`] (the record's own format).
pub const OVERLAY_DB_VERSION: u32 = 1;

const META_MAGIC: &[u8; 4] = b"wvov";
/// Serialized [`OverlayMeta`] length: magic(4) + format(4) + block_size(4) + image_len(8) + binding(32).
const META_LEN: usize = 4 + 4 + 4 + 8 + 32;

/// The persisted overlay's identity record (stored in the durable backend's `meta` store).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverlayMeta {
    /// The overlay on-storage format version ([`OVERLAY_FORMAT_VERSION`]).
    pub format_version: u32,
    /// Overlay block size ([`OVERLAY_BLOCK`]).
    pub block_size: u32,
    /// Total image length (== base `image_len`).
    pub image_len: u64,
    /// The base image binding ([`ImageManifest::base_hash`]).
    pub base_binding: [u8; 32],
}

impl OverlayMeta {
    /// The meta for a fresh overlay over `manifest`'s base (current format/block size).
    pub fn new(manifest: &ImageManifest) -> OverlayMeta {
        OverlayMeta {
            format_version: OVERLAY_FORMAT_VERSION,
            block_size: OVERLAY_BLOCK as u32,
            image_len: manifest.image_len,
            base_binding: manifest.base_hash(),
        }
    }

    /// Fixed-layout serialization for the durable `meta` store (little-endian scalars).
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut b = Vec::with_capacity(META_LEN);
        b.extend_from_slice(META_MAGIC);
        b.extend_from_slice(&self.format_version.to_le_bytes());
        b.extend_from_slice(&self.block_size.to_le_bytes());
        b.extend_from_slice(&self.image_len.to_le_bytes());
        b.extend_from_slice(&self.base_binding);
        b
    }

    /// Parse a meta record. Bad magic / wrong length is [`OverlayError::BadMeta`]; an unknown format
    /// version is [`OverlayError::UnsupportedFormat`] (refuse, never reinterpret).
    pub fn from_bytes(bytes: &[u8]) -> Result<OverlayMeta, OverlayError> {
        if bytes.len() != META_LEN || &bytes[0..4] != META_MAGIC {
            return Err(OverlayError::BadMeta);
        }
        let format_version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        if format_version != OVERLAY_FORMAT_VERSION {
            return Err(OverlayError::UnsupportedFormat {
                found: format_version,
            });
        }
        let block_size = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        let image_len = u64::from_le_bytes(bytes[12..20].try_into().unwrap());
        let mut base_binding = [0u8; 32];
        base_binding.copy_from_slice(&bytes[20..52]);
        Ok(OverlayMeta {
            format_version,
            block_size,
            image_len,
            base_binding,
        })
    }

    /// Validate a loaded meta against the `manifest` being attached: block size + image length must
    /// match the current build, and the base binding must match the manifest. Any mismatch is a typed
    /// error before any block is read — an overlay must never ride the wrong base/geometry (E3-T04).
    pub fn check(&self, manifest: &ImageManifest) -> Result<(), OverlayError> {
        if self.format_version != OVERLAY_FORMAT_VERSION {
            return Err(OverlayError::UnsupportedFormat {
                found: self.format_version,
            });
        }
        if self.block_size != OVERLAY_BLOCK as u32 || self.image_len != manifest.image_len {
            return Err(OverlayError::BadMeta);
        }
        if self.base_binding != manifest.base_hash() {
            return Err(OverlayError::BaseMismatch);
        }
        Ok(())
    }
}

/// The durable store name for an image's overlay — namespaced by the base binding so two different
/// images (different `base_hash`) get two independent stores and never see each other's writes
/// (E3-T05 acceptance). `wvov-<64 hex>`; a valid IndexedDB name and OPFS filename stem.
pub fn overlay_store_name(base_binding: &[u8; 32]) -> String {
    let mut s = String::with_capacity(5 + 64);
    s.push_str("wvov-");
    for b in base_binding {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        s.push(char::from_digit((b & 0xf) as u32, 16).unwrap());
    }
    s
}

#[cfg(test)]
mod tests;
