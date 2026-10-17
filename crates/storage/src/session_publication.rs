//! E9-T03: the manifest boundary used by the browser's append-only session store.
//! IndexedDB owns durability; these pure checks own append/identity and reference discovery.
use crate::session::{BlobRef, ContentHash, EventPayload, SessionError, SessionManifest};
use alloc::collections::BTreeMap;
use alloc::vec::Vec;
use serde::Serialize;

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct PublicationRefs {
    /// All directly indexed runtime, machine/GPU checkpoint and event-chunk objects.
    pub blobs: Vec<BlobRef>,
    /// Root objects carry their length in the durable object descriptor (T04 owns root contents).
    pub roots: Vec<ContentHash>,
}

fn insert(refs: &mut BTreeMap<ContentHash, BlobRef>, value: &BlobRef) -> Result<(), SessionError> {
    value.validate()?;
    if let Some(previous) = refs.get(&value.sha256)
        && previous.length != value.length
    {
        return Err(SessionError::LengthMismatch {
            expected: previous.length.0,
            actual: value.length.0,
        });
    }
    refs.insert(value.sha256, value.clone());
    Ok(())
}

pub fn references(manifest: &SessionManifest) -> Result<PublicationRefs, SessionError> {
    manifest.validate()?;
    let mut refs = BTreeMap::new();
    let mut roots = Vec::new();
    for asset in &manifest.assets {
        insert(&mut refs, &asset.content)?;
    }
    for chunk in &manifest.events {
        insert(&mut refs, &chunk.content)?;
    }
    for checkpoint in &manifest.checkpoints {
        insert(&mut refs, &checkpoint.machine)?;
        if let Some(gpu) = &checkpoint.gpu {
            insert(&mut refs, gpu)?;
        }
        roots.push(checkpoint.disk_root);
    }
    roots.sort_unstable();
    roots.dedup();
    Ok(PublicationRefs {
        blobs: refs.into_values().collect(),
        roots,
    })
}

/// Validate a listed event chunk and discover its out-of-line payloads before publication.
pub fn event_references(
    manifest: &SessionManifest,
    bytes: &[u8],
) -> Result<Vec<BlobRef>, SessionError> {
    manifest.validate()?;
    if bytes.len() > crate::session::MAX_CHUNK_BYTES as usize {
        return Err(SessionError::TooLarge("event chunk"));
    }
    let hash = ContentHash::of(bytes);
    let index = manifest
        .events
        .iter()
        .find(|entry| entry.content.sha256 == hash)
        .ok_or(SessionError::Invalid("unindexed event chunk"))?;
    let records = index.decode_records(bytes)?;
    let mut refs = BTreeMap::new();
    for record in records {
        if let EventPayload::Blob { content } = record.payload {
            insert(&mut refs, &content)?;
        }
    }
    Ok(refs.into_values().collect())
}

/// Publication may extend the committed history, never replace an identity or old prefix.
pub fn check_append(
    previous: &SessionManifest,
    candidate: &SessionManifest,
) -> Result<(), SessionError> {
    previous.validate()?;
    candidate.validate()?;
    if previous.id != candidate.id
        || previous.machine != candidate.machine
        || previous.policy != candidate.policy
        || previous.assets != candidate.assets
        || previous.begin != candidate.begin
        || previous.extensions != candidate.extensions
    {
        return Err(SessionError::IdentityMismatch("session publication"));
    }
    if !candidate.events.starts_with(&previous.events)
        || !candidate.checkpoints.starts_with(&previous.checkpoints)
        || !candidate.end.follows(previous.end)
    {
        return Err(SessionError::Invalid("committed history prefix"));
    }
    Ok(())
}

pub fn references_json(bytes: &[u8]) -> Result<Vec<u8>, SessionError> {
    let manifest = SessionManifest::from_bytes(bytes)?;
    serde_json::to_vec(&references(&manifest)?)
        .map_err(|_| SessionError::Invalid("reference encoding"))
}

pub fn event_references_json(manifest: &[u8], chunk: &[u8]) -> Result<Vec<u8>, SessionError> {
    let manifest = SessionManifest::from_bytes(manifest)?;
    serde_json::to_vec(&event_references(&manifest, chunk)?)
        .map_err(|_| SessionError::Invalid("reference encoding"))
}
