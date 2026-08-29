//! E4 Alpine restore-on-load: the shipped **overlay-delta** artifact — the set of 4 KiB disk blocks a
//! build-time boot dirtied relative to the pristine chunked base, captured in lockstep with the RAM
//! snapshot. Seeding these into the browser's IndexedDB copy-on-write overlay (over the chunked base)
//! makes a restored guest's cache-miss disk reads return the *post-boot* block content, so the restore
//! is byte-exact on disk (see evidence/epic-3.6/alpine-snapshot-native.md).
//!
//! On-wire format (little-endian), a single self-describing blob (then gzip-compressed for shipping):
//!
//! ```text
//!   magic         5   b"WVOD1"
//!   block_size    4   u32   == OVERLAY_BLOCK (4096); a mismatch is rejected
//!   image_len     8   u64   base image length in bytes (binds to the image size)
//!   base_binding 32   the chunk manifest's base_hash — binds the delta to the EXACT chunked base
//!   generation    8   u64   the overlay commit generation this delta (and the paired RAM snapshot) ride
//!   count         4   u32   number of blocks that follow
//!   blocks    count × (u64 block_index  +  block_size bytes)
//! ```
//!
//! The `base_binding` + `generation` are the coherence bindings: the browser seeds the delta only into
//! the overlay store for the matching base image, and the paired RAM snapshot must share `generation`
//! (the E3-T12d overlay-generation stale-guard) or the restore falls back to a cold boot.

use crate::{ImageManifest, OVERLAY_BLOCK, OverlayMeta};
use alloc::collections::{BTreeMap, BTreeSet};
use alloc::vec::Vec;

/// Magic prefix identifying a `WVOD1` overlay-delta blob.
pub const OVERLAY_DELTA_MAGIC: &[u8; 5] = b"WVOD1";

/// A parsed overlay-delta artifact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverlayDelta {
    /// Base image length in bytes (must equal the manifest's `image_len`).
    pub image_len: u64,
    /// The chunk manifest's `base_hash` this delta binds to.
    pub base_binding: [u8; 32],
    /// The overlay commit generation the delta (and paired RAM snapshot) ride.
    pub generation: u64,
    /// `(block_index, 4096-byte block)` pairs — the post-boot content of every dirtied block.
    pub blocks: Vec<(u64, [u8; OVERLAY_BLOCK])>,
}

/// Why an overlay-delta blob could not be parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverlayDeltaError {
    /// The blob is shorter than a valid header / a declared block is truncated.
    Truncated,
    /// The magic prefix is not `WVOD1`.
    BadMagic,
    /// `block_size` is not [`OVERLAY_BLOCK`].
    BadBlockSize(u32),
}

/// Whether a shipped overlay delta may initialize or reuse the durable overlay store.
///
/// A RAM snapshot is safe to restore only when its paired disk delta is the *entire* durable
/// overlay. Existing user state is therefore reusable only when both its metadata and every
/// block/index pair exactly match the delta; any difference is preserved and forces a cold boot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlaySeedDecision {
    /// No metadata and no blocks exist, so the delta may initialize this brand-new store.
    SeedFresh,
    /// The existing store is a byte-exact copy of the supplied delta and may reuse its RAM snapshot.
    ReuseExact,
    /// Existing or malformed state must be preserved and the paired RAM snapshot must not be used.
    PreserveExisting,
}

/// Fixed header length: magic(5) + block_size(4) + image_len(8) + base_binding(32) + generation(8) +
/// count(4).
const HEADER_LEN: usize = 5 + 4 + 8 + 32 + 8 + 4;

impl OverlayDelta {
    /// Classify a durable overlay before seeding or reusing this delta's paired RAM snapshot.
    ///
    /// `SeedFresh` requires an entirely empty store (no metadata *and* no orphan blocks).
    /// `ReuseExact` requires valid metadata for `manifest` plus the exact same block-index/value set.
    /// Added, removed, changed, duplicate-delta, malformed-meta, and foreign-base cases all fail
    /// closed as `PreserveExisting` without changing the caller's store.
    pub fn seed_decision(
        &self,
        manifest: &ImageManifest,
        meta_bytes: Option<&[u8]>,
        stored_blocks: &BTreeMap<u64, [u8; OVERLAY_BLOCK]>,
    ) -> OverlaySeedDecision {
        if self.base_binding != manifest.base_hash() || self.image_len != manifest.image_len {
            return OverlaySeedDecision::PreserveExisting;
        }
        let mut delta_indices = BTreeSet::new();
        if self
            .blocks
            .iter()
            .any(|(index, _)| !delta_indices.insert(*index))
        {
            return OverlaySeedDecision::PreserveExisting;
        }

        let Some(meta_bytes) = meta_bytes else {
            return if stored_blocks.is_empty() {
                OverlaySeedDecision::SeedFresh
            } else {
                OverlaySeedDecision::PreserveExisting
            };
        };

        let Ok(meta) = OverlayMeta::from_bytes(meta_bytes) else {
            return OverlaySeedDecision::PreserveExisting;
        };
        if meta.check(manifest).is_err() || stored_blocks.len() != delta_indices.len() {
            return OverlaySeedDecision::PreserveExisting;
        }
        if self
            .blocks
            .iter()
            .all(|(index, bytes)| stored_blocks.get(index) == Some(bytes))
        {
            OverlaySeedDecision::ReuseExact
        } else {
            OverlaySeedDecision::PreserveExisting
        }
    }

    /// Serialize to the `WVOD1` wire format.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut b = Vec::with_capacity(HEADER_LEN + self.blocks.len() * (8 + OVERLAY_BLOCK));
        b.extend_from_slice(OVERLAY_DELTA_MAGIC);
        b.extend_from_slice(&(OVERLAY_BLOCK as u32).to_le_bytes());
        b.extend_from_slice(&self.image_len.to_le_bytes());
        b.extend_from_slice(&self.base_binding);
        b.extend_from_slice(&self.generation.to_le_bytes());
        b.extend_from_slice(&(self.blocks.len() as u32).to_le_bytes());
        for (index, bytes) in &self.blocks {
            b.extend_from_slice(&index.to_le_bytes());
            b.extend_from_slice(bytes);
        }
        b
    }

    /// Parse a `WVOD1` blob. Total, allocation-bounded, never panics.
    pub fn from_bytes(buf: &[u8]) -> Result<OverlayDelta, OverlayDeltaError> {
        if buf.len() < HEADER_LEN {
            return Err(OverlayDeltaError::Truncated);
        }
        if &buf[0..5] != OVERLAY_DELTA_MAGIC {
            return Err(OverlayDeltaError::BadMagic);
        }
        let block_size = u32::from_le_bytes(buf[5..9].try_into().unwrap());
        if block_size as usize != OVERLAY_BLOCK {
            return Err(OverlayDeltaError::BadBlockSize(block_size));
        }
        let image_len = u64::from_le_bytes(buf[9..17].try_into().unwrap());
        let mut base_binding = [0u8; 32];
        base_binding.copy_from_slice(&buf[17..49]);
        let generation = u64::from_le_bytes(buf[49..57].try_into().unwrap());
        let count = u32::from_le_bytes(buf[57..61].try_into().unwrap()) as usize;

        let entry = 8 + OVERLAY_BLOCK;
        let need = HEADER_LEN
            .checked_add(
                count
                    .checked_mul(entry)
                    .ok_or(OverlayDeltaError::Truncated)?,
            )
            .ok_or(OverlayDeltaError::Truncated)?;
        if buf.len() < need {
            return Err(OverlayDeltaError::Truncated);
        }
        let mut blocks = Vec::with_capacity(count);
        let mut off = HEADER_LEN;
        for _ in 0..count {
            let index = u64::from_le_bytes(buf[off..off + 8].try_into().unwrap());
            let mut block = [0u8; OVERLAY_BLOCK];
            block.copy_from_slice(&buf[off + 8..off + 8 + OVERLAY_BLOCK]);
            blocks.push((index, block));
            off += entry;
        }
        Ok(OverlayDelta {
            image_len,
            base_binding,
            generation,
            blocks,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Layout;
    use alloc::vec;

    fn manifest() -> ImageManifest {
        ImageManifest::from_image(
            &[0x5au8; OVERLAY_BLOCK * 3],
            OVERLAY_BLOCK as u32,
            Layout::Split,
        )
        .unwrap()
    }

    fn delta(manifest: &ImageManifest) -> OverlayDelta {
        OverlayDelta {
            image_len: manifest.image_len,
            base_binding: manifest.base_hash(),
            generation: 0,
            blocks: vec![(1, [0x11; OVERLAY_BLOCK]), (2, [0x22; OVERLAY_BLOCK])],
        }
    }

    fn exact_blocks(delta: &OverlayDelta) -> BTreeMap<u64, [u8; OVERLAY_BLOCK]> {
        delta.blocks.iter().copied().collect()
    }

    #[test]
    fn round_trips() {
        let d = OverlayDelta {
            image_len: 805306368,
            base_binding: [7u8; 32],
            generation: 0,
            blocks: vec![(0, [0xABu8; OVERLAY_BLOCK]), (199, [0xCDu8; OVERLAY_BLOCK])],
        };
        let bytes = d.to_bytes();
        assert_eq!(OverlayDelta::from_bytes(&bytes).unwrap(), d);
    }

    #[test]
    fn rejects_bad_magic() {
        let mut bytes = OverlayDelta {
            image_len: 1,
            base_binding: [0u8; 32],
            generation: 0,
            blocks: vec![],
        }
        .to_bytes();
        bytes[0] = b'X';
        assert_eq!(
            OverlayDelta::from_bytes(&bytes),
            Err(OverlayDeltaError::BadMagic)
        );
    }

    #[test]
    fn rejects_truncated() {
        let bytes = OverlayDelta {
            image_len: 1,
            base_binding: [0u8; 32],
            generation: 0,
            blocks: vec![(3, [1u8; OVERLAY_BLOCK])],
        }
        .to_bytes();
        assert_eq!(
            OverlayDelta::from_bytes(&bytes[..bytes.len() - 10]),
            Err(OverlayDeltaError::Truncated)
        );
    }

    #[test]
    fn seed_decision_allows_fresh_empty_store() {
        let manifest = manifest();
        let delta = delta(&manifest);
        assert_eq!(
            delta.seed_decision(&manifest, None, &BTreeMap::new()),
            OverlaySeedDecision::SeedFresh
        );
    }

    #[test]
    fn seed_decision_reuses_only_exact_repeat() {
        let manifest = manifest();
        let delta = delta(&manifest);
        let meta = OverlayMeta::new(&manifest).to_bytes();
        assert_eq!(
            delta.seed_decision(&manifest, Some(&meta), &exact_blocks(&delta)),
            OverlaySeedDecision::ReuseExact
        );
    }

    #[test]
    fn seed_decision_rejects_changed_extra_and_missing_blocks() {
        let manifest = manifest();
        let delta = delta(&manifest);
        let meta = OverlayMeta::new(&manifest).to_bytes();

        let mut changed = exact_blocks(&delta);
        changed.get_mut(&1).unwrap()[0] ^= 0xff;
        assert_eq!(
            delta.seed_decision(&manifest, Some(&meta), &changed),
            OverlaySeedDecision::PreserveExisting
        );

        let mut extra = exact_blocks(&delta);
        extra.insert(0, [0x33; OVERLAY_BLOCK]);
        assert_eq!(
            delta.seed_decision(&manifest, Some(&meta), &extra),
            OverlaySeedDecision::PreserveExisting
        );

        let mut missing = exact_blocks(&delta);
        missing.remove(&2);
        assert_eq!(
            delta.seed_decision(&manifest, Some(&meta), &missing),
            OverlaySeedDecision::PreserveExisting
        );
    }

    #[test]
    fn seed_decision_rejects_invalid_meta_and_orphan_blocks() {
        let manifest = manifest();
        let delta = delta(&manifest);
        assert_eq!(
            delta.seed_decision(&manifest, Some(b"bad-meta"), &exact_blocks(&delta)),
            OverlaySeedDecision::PreserveExisting
        );
        assert_eq!(
            delta.seed_decision(&manifest, None, &exact_blocks(&delta)),
            OverlaySeedDecision::PreserveExisting
        );

        let mut duplicate = delta.clone();
        duplicate.blocks.push(duplicate.blocks[0]);
        assert_eq!(
            duplicate.seed_decision(
                &manifest,
                Some(&OverlayMeta::new(&manifest).to_bytes()),
                &exact_blocks(&delta)
            ),
            OverlaySeedDecision::PreserveExisting
        );
    }
}
