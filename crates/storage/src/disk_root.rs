//! E9-T04: immutable COW block maps. Restores allocate private overlays, never write a live store.
//!
//! Roots contain the complete write set. They share content-addressed block objects, rather than
//! depending on mutable parent pointers or replaying a chain of deltas. Retention marks the union
//! of every surviving root's references before reclaiming anything (E9-T07).
use crate::session::{BlobRef, ContentHash, ExactU64, SessionError, Version};
use crate::{ImageManifest, MemOverlay, OVERLAY_BLOCK, OverlayBackend, OverlayDelta};
use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::ToString;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

pub const MAX_DISK_ROOT_BLOCKS: usize = 65_536;
pub const MAX_DISK_ROOT_BYTES: usize = 12 << 20;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiskBlock {
    pub index: ExactU64,
    pub sha256: ContentHash,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiskRoot {
    pub version: Version,
    /// Canonical ImageManifest::base_hash(), not the raw image or original JSON text's hash.
    pub base: ContentHash,
    pub image_len: ExactU64,
    pub generation: ExactU64,
    pub blocks: Vec<DiskBlock>,
}

impl DiskRoot {
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.version != Version::V1 {
            return Err(SessionError::Version {
                section: "disk root",
                major: self.version.major,
                minor: self.version.minor,
            });
        }
        if self.image_len.0 == 0 {
            return Err(SessionError::Invalid("disk image length"));
        }
        if self.blocks.len() > MAX_DISK_ROOT_BLOCKS {
            return Err(SessionError::TooLarge("disk root blocks"));
        }
        let count = (self.image_len.0 - 1) / OVERLAY_BLOCK as u64 + 1;
        let mut previous = None;
        for block in &self.blocks {
            if block.index.0 >= count {
                return Err(SessionError::Invalid("disk block index"));
            }
            if previous.is_some_and(|index| index >= block.index) {
                return Err(SessionError::IndexOrder);
            }
            previous = Some(block.index);
        }
        Ok(())
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, SessionError> {
        self.validate()?;
        let bytes =
            serde_json::to_vec(self).map_err(|_| SessionError::Invalid("disk root encoding"))?;
        if bytes.len() > MAX_DISK_ROOT_BYTES {
            return Err(SessionError::TooLarge("disk root"));
        }
        Ok(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, SessionError> {
        if bytes.len() > MAX_DISK_ROOT_BYTES {
            return Err(SessionError::TooLarge("disk root"));
        }
        let root: Self =
            serde_json::from_slice(bytes).map_err(|e| SessionError::Malformed(e.to_string()))?;
        if root.to_bytes()? != bytes {
            return Err(SessionError::Invalid("noncanonical disk root"));
        }
        Ok(root)
    }

    pub fn from_delta(delta: &OverlayDelta) -> Result<Self, SessionError> {
        if delta.blocks.len() > MAX_DISK_ROOT_BLOCKS {
            return Err(SessionError::TooLarge("disk root blocks"));
        }
        let root = Self {
            version: Version::V1,
            base: ContentHash(delta.base_binding),
            image_len: ExactU64(delta.image_len),
            generation: ExactU64(delta.generation),
            blocks: delta
                .blocks
                .iter()
                .map(|(index, bytes)| DiskBlock {
                    index: ExactU64(*index),
                    sha256: ContentHash::of(bytes),
                })
                .collect(),
        };
        root.validate()?;
        Ok(root)
    }

    /// Check every identity before loading block payloads or constructing a replacement backend.
    pub fn admit(&self, manifest: &ImageManifest, generation: u64) -> Result<(), SessionError> {
        self.validate()?;
        manifest
            .validate()
            .map_err(|e| SessionError::Malformed(format!("disk base: {e:?}")))?;
        if self.base.0 != manifest.base_hash() || self.image_len.0 != manifest.image_len {
            return Err(SessionError::IdentityMismatch("disk base"));
        }
        if self.generation.0 != generation {
            return Err(SessionError::IdentityMismatch("disk generation"));
        }
        Ok(())
    }

    pub fn references(&self) -> Result<Vec<BlobRef>, SessionError> {
        self.validate()?;
        let refs: BTreeMap<_, _> = self
            .blocks
            .iter()
            .map(|block| {
                (
                    block.sha256,
                    BlobRef {
                        sha256: block.sha256,
                        length: ExactU64(OVERLAY_BLOCK as u64),
                    },
                )
            })
            .collect();
        Ok(refs.into_values().collect())
    }

    /// Fully authenticate a fresh owned delta. Failure cannot expose a partially restored disk.
    pub fn materialize(
        &self,
        manifest: &ImageManifest,
        generation: u64,
        mut load: impl FnMut(&BlobRef) -> Result<Vec<u8>, SessionError>,
    ) -> Result<OverlayDelta, SessionError> {
        self.admit(manifest, generation)?;
        let mut blocks = Vec::with_capacity(self.blocks.len());
        for block in &self.blocks {
            let reference = BlobRef {
                sha256: block.sha256,
                length: ExactU64(OVERLAY_BLOCK as u64),
            };
            let bytes = load(&reference)?;
            reference.verify(&bytes)?;
            let mut owned = [0; OVERLAY_BLOCK];
            owned.copy_from_slice(&bytes);
            blocks.push((block.index.0, owned));
        }
        Ok(OverlayDelta {
            image_len: self.image_len.0,
            base_binding: self.base.0,
            generation: self.generation.0,
            blocks,
        })
    }

    pub fn private_overlay(
        &self,
        manifest: &ImageManifest,
        generation: u64,
        load: impl FnMut(&BlobRef) -> Result<Vec<u8>, SessionError>,
    ) -> Result<MemOverlay, SessionError> {
        let delta = self.materialize(manifest, generation, load)?;
        let mut overlay = MemOverlay::new(manifest);
        for (index, bytes) in delta.blocks {
            overlay.write_block(index, bytes);
        }
        Ok(overlay)
    }
}

/// Mark both root metadata and shared data. Removing one root never unmarks a surviving root's
/// blocks. This is a pure reachability operation; deletion policy belongs to E9-T07.
pub fn live_references(roots: &[DiskRoot]) -> Result<Vec<BlobRef>, SessionError> {
    let mut refs = BTreeMap::new();
    let mut insert = |reference: BlobRef| -> Result<(), SessionError> {
        if let Some(previous) = refs.insert(reference.sha256, reference.clone())
            && previous.length != reference.length
        {
            return Err(SessionError::LengthMismatch {
                expected: previous.length.0,
                actual: reference.length.0,
            });
        }
        Ok(())
    };
    for root in roots {
        let bytes = root.to_bytes()?;
        let reference = BlobRef::of(&bytes);
        insert(reference)?;
        for reference in root.references()? {
            insert(reference)?;
        }
    }
    Ok(refs.into_values().collect())
}

pub fn admit_json(bytes: &[u8], image: &str, generation: &str) -> Result<Vec<u8>, SessionError> {
    let root = DiskRoot::from_bytes(bytes)?;
    let manifest = ImageManifest::from_json(image)
        .map_err(|e| SessionError::Malformed(format!("disk base: {e:?}")))?;
    let generation: ExactU64 = serde_json::from_value(serde_json::Value::String(generation.into()))
        .map_err(|e| SessionError::Malformed(e.to_string()))?;
    root.admit(&manifest, generation.0)?;
    root.to_bytes()
}

pub fn references_json(bytes: &[u8]) -> Result<Vec<u8>, SessionError> {
    serde_json::to_vec(&DiskRoot::from_bytes(bytes)?.references()?)
        .map_err(|_| SessionError::Invalid("disk reference encoding"))
}
