//! E3-T12d durable **resume-snapshot** store schema — the `meta` record, DB namespacing, and the
//! chunking/reassembly codec shared by the browser IndexedDB snapshot backend. Browser-agnostic +
//! native-tested, exactly like [`crate::dbmeta`] is for the overlay store.
//!
//! A resume snapshot (the [`wasm_vm_core::resume`] container blob) is large (tens of MiB for a booted
//! Alpine) and must be persisted WITHOUT ever holding a second whole-blob copy: the save side streams
//! it as fixed-size chunks into batched transactions, and the load side reassembles exactly one copy.
//! The `meta` record binds the stored chunk set to its base image, records the total length + chunk
//! count, and lets [`reassemble`] detect a torn / half-published store (a missing or short chunk) as a
//! typed error so the caller falls back to a cold boot rather than resuming a truncated blob.

use crate::OverlayError;
use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;

/// The snapshot IndexedDB schema version (`onupgradeneeded` version) — independent of the record's own
/// [`SNAPSHOT_META_FORMAT`] and of the overlay DB version.
pub const SNAPSHOT_DB_VERSION: u32 = 1;

/// The `meta`-record format version (the byte layout below). Bumped on a layout change.
pub const SNAPSHOT_META_FORMAT: u32 = 1;

/// The streaming chunk size: 1 MiB. Large enough that a ~60 MiB snapshot is ~60 puts (cheap), small
/// enough that a single chunk (and the per-put JS copy) is a bounded, modest allocation — never the
/// whole blob. The last chunk may be shorter; every other chunk is exactly this size.
pub const SNAPSHOT_CHUNK: usize = 1 << 20;

const META_MAGIC: &[u8; 4] = b"wvsn";
/// Serialized [`SnapshotMeta`]: magic(4) + format(4) + chunk_size(4) + total_len(8) + chunk_count(8) + binding(32).
const META_LEN: usize = 4 + 4 + 4 + 8 + 8 + 32;

/// A typed failure reassembling a stored snapshot from its chunks — always a reason to cold-boot,
/// never a panic. Distinct from a coherence rejection (that is decided from the blob header once
/// reassembled): these are *storage-integrity* faults in the chunk set itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotStoreError {
    /// The `meta` record has bad magic, the wrong length, or an unsupported format version.
    BadMeta,
    /// A chunk index in `[0, chunk_count)` is missing from the store, or its length is wrong (not
    /// exactly `chunk_size`, or — for the final chunk — not the exact remainder). A half-published or
    /// truncated store. `index` names the first offending chunk.
    TornChunk { index: u64 },
    /// The reassembled length did not equal the meta's `total_len` (an internally inconsistent meta).
    LengthMismatch { expected: u64, actual: u64 },
}

impl From<SnapshotStoreError> for OverlayError {
    fn from(_: SnapshotStoreError) -> OverlayError {
        // Snapshot-store faults are surfaced through the same durable-store error channel as overlay
        // meta faults where a shared type is needed; the snapshot layer keeps the precise variant.
        OverlayError::BadMeta
    }
}

/// The persisted snapshot's identity + shape record (stored under the `meta` store's single key).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SnapshotMeta {
    /// The record's own format version ([`SNAPSHOT_META_FORMAT`]).
    pub format_version: u32,
    /// The chunk size the blob was split at ([`SNAPSHOT_CHUNK`] when written).
    pub chunk_size: u32,
    /// Total snapshot blob length in bytes.
    pub total_len: u64,
    /// Number of chunks: `ceil(total_len / chunk_size)` (0 for an empty blob).
    pub chunk_count: u64,
    /// The base image binding ([`crate::ImageManifest::base_hash`]) this snapshot rides — the same
    /// namespacing as the overlay store, so a snapshot can never be reassembled against a foreign base.
    pub base_binding: [u8; 32],
}

impl SnapshotMeta {
    /// The meta for a blob of `total_len` bytes chunked at [`SNAPSHOT_CHUNK`] for `base_binding`.
    pub fn new(total_len: u64, base_binding: [u8; 32]) -> SnapshotMeta {
        SnapshotMeta {
            format_version: SNAPSHOT_META_FORMAT,
            chunk_size: SNAPSHOT_CHUNK as u32,
            total_len,
            chunk_count: chunk_count_for(total_len, SNAPSHOT_CHUNK as u64),
            base_binding,
        }
    }

    /// Fixed-layout little-endian serialization for the durable `meta` store.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut b = Vec::with_capacity(META_LEN);
        b.extend_from_slice(META_MAGIC);
        b.extend_from_slice(&self.format_version.to_le_bytes());
        b.extend_from_slice(&self.chunk_size.to_le_bytes());
        b.extend_from_slice(&self.total_len.to_le_bytes());
        b.extend_from_slice(&self.chunk_count.to_le_bytes());
        b.extend_from_slice(&self.base_binding);
        b
    }

    /// Parse a meta record. Bad magic / wrong length / unsupported format / a chunk_count that does not
    /// match total_len ÷ chunk_size is [`SnapshotStoreError::BadMeta`] — never reinterpreted.
    pub fn from_bytes(bytes: &[u8]) -> Result<SnapshotMeta, SnapshotStoreError> {
        if bytes.len() != META_LEN || &bytes[0..4] != META_MAGIC {
            return Err(SnapshotStoreError::BadMeta);
        }
        let format_version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        if format_version != SNAPSHOT_META_FORMAT {
            return Err(SnapshotStoreError::BadMeta);
        }
        let chunk_size = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        let total_len = u64::from_le_bytes(bytes[12..20].try_into().unwrap());
        let chunk_count = u64::from_le_bytes(bytes[20..28].try_into().unwrap());
        let mut base_binding = [0u8; 32];
        base_binding.copy_from_slice(&bytes[28..60]);
        // A zero chunk_size can't describe any layout; and the count must be exactly what the length
        // implies — a doctored meta that disagrees is refused before we trust it to bound a read.
        if chunk_size == 0 || chunk_count != chunk_count_for(total_len, chunk_size as u64) {
            return Err(SnapshotStoreError::BadMeta);
        }
        Ok(SnapshotMeta {
            format_version,
            chunk_size,
            total_len,
            chunk_count,
            base_binding,
        })
    }

    /// The exact expected byte length of chunk `index` under this meta: `chunk_size` for every chunk
    /// except the last, which is the remainder. `None` if `index` is out of range.
    pub fn expected_chunk_len(&self, index: u64) -> Option<usize> {
        if index >= self.chunk_count {
            return None;
        }
        let cs = self.chunk_size as u64;
        let start = index * cs;
        let remaining = self.total_len - start;
        Some(remaining.min(cs) as usize)
    }
}

/// `ceil(total_len / chunk_size)`, saturating and division-by-zero-safe (0 → 0).
pub fn chunk_count_for(total_len: u64, chunk_size: u64) -> u64 {
    if chunk_size == 0 || total_len == 0 {
        return 0;
    }
    total_len.div_ceil(chunk_size)
}

/// The durable store name for an image's snapshot — namespaced by the base binding so two images get
/// independent snapshot stores (never cross-contaminating), mirroring [`crate::overlay_store_name`].
/// `wvsn-<64 hex>`; a valid IndexedDB name.
pub fn snapshot_store_name(base_binding: &[u8; 32]) -> String {
    let mut s = String::with_capacity(5 + 64);
    s.push_str("wvsn-");
    for b in base_binding {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        s.push(char::from_digit((b & 0xf) as u32, 16).unwrap());
    }
    s
}

/// Reassemble the snapshot blob from its stored chunks, validating completeness against `meta`. Every
/// index in `[0, chunk_count)` must be present with EXACTLY its expected length ([`SnapshotMeta::
/// expected_chunk_len`]); a missing or wrong-length chunk is a typed [`SnapshotStoreError::TornChunk`]
/// (a half-published / truncated store → cold boot). Produces exactly one `Vec` of `total_len` bytes —
/// no whole-blob duplication (the chunk map is consumed as it is copied out).
pub fn reassemble(
    meta: &SnapshotMeta,
    mut chunks: BTreeMap<u64, Vec<u8>>,
) -> Result<Vec<u8>, SnapshotStoreError> {
    let mut out = Vec::with_capacity(meta.total_len as usize);
    for index in 0..meta.chunk_count {
        let expected = meta
            .expected_chunk_len(index)
            .ok_or(SnapshotStoreError::TornChunk { index })?;
        let chunk = chunks
            .remove(&index)
            .ok_or(SnapshotStoreError::TornChunk { index })?;
        if chunk.len() != expected {
            return Err(SnapshotStoreError::TornChunk { index });
        }
        out.extend_from_slice(&chunk);
    }
    if out.len() as u64 != meta.total_len {
        return Err(SnapshotStoreError::LengthMismatch {
            expected: meta.total_len,
            actual: out.len() as u64,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests;
