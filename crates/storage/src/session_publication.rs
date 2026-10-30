//! E9-T03: the manifest boundary used by the browser's append-only session store.
//! IndexedDB owns durability; these pure checks own append/identity and reference discovery.
use crate::session::{
    BlobRef, ContentHash, EventPayload, ExactU64, Phase, Position, RecordingMode, SessionError,
    SessionManifest,
};
use alloc::collections::BTreeMap;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ExactStateWitness {
    transition: ExactU64,
    phase: Phase,
    ordinal: u32,
    sequence: ExactU64,
    retired: ExactU64,
    digest: Vec<u8>,
}

impl ExactStateWitness {
    fn position(&self) -> Position {
        Position {
            transition: self.transition,
            phase: self.phase,
            ordinal: self.ordinal,
            sequence: self.sequence,
            retired: self.retired,
        }
    }
}

/// A live exact recording may commit its initial state before the final state exists. The
/// final witness list is the only extension that may be added later, and only once.
fn exact_completion_append(previous: &SessionManifest, candidate: &SessionManifest) -> bool {
    if previous.policy.mode != RecordingMode::ExactReplay
        || previous.extensions.len() != 1
        || candidate.extensions.len() != 2
        || candidate.extensions[0] != previous.extensions[0]
        || previous.extensions[0].kind != "e9-exact-initial-witness-v1"
        || candidate.extensions[1].kind != "e9-exact-state-witnesses-v1"
        || previous.extensions[0].required
        || candidate.extensions[1].required
    {
        return false;
    }
    let Ok(initial) =
        serde_json::from_slice::<Vec<ExactStateWitness>>(&previous.extensions[0].bytes)
    else {
        return false;
    };
    let Ok(final_witnesses) =
        serde_json::from_slice::<Vec<ExactStateWitness>>(&candidate.extensions[1].bytes)
    else {
        return false;
    };
    initial.len() == 1
        && initial[0].digest.len() == 32
        && initial[0].position() == previous.begin
        && (2..=64).contains(&final_witnesses.len())
        && final_witnesses[0] == initial[0]
        && final_witnesses
            .iter()
            .all(|witness| witness.digest.len() == 32)
        && final_witnesses
            .windows(2)
            .all(|pair| pair[1].position().follows(pair[0].position()))
        && final_witnesses
            .last()
            .is_some_and(|last| last.position() == candidate.end)
}

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
    collect_references(manifest)
}

pub fn references_local(manifest: &SessionManifest) -> Result<PublicationRefs, SessionError> {
    manifest.validate_local()?;
    collect_references(manifest)
}

fn collect_references(manifest: &SessionManifest) -> Result<PublicationRefs, SessionError> {
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
    if let Some(commitment) = crate::session_witness::commitment(manifest)? {
        insert(&mut refs, &commitment.tail)?;
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
    collect_event_references(manifest, bytes)
}

pub fn event_references_local(
    manifest: &SessionManifest,
    bytes: &[u8],
) -> Result<Vec<BlobRef>, SessionError> {
    manifest.validate_local()?;
    collect_event_references(manifest, bytes)
}

fn collect_event_references(
    manifest: &SessionManifest,
    bytes: &[u8],
) -> Result<Vec<BlobRef>, SessionError> {
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
    check_append_identity(previous, candidate)
}

pub fn check_append_local(
    previous: &SessionManifest,
    candidate: &SessionManifest,
) -> Result<(), SessionError> {
    previous.validate_local()?;
    candidate.validate_local()?;
    check_append_identity(previous, candidate)
}

fn check_append_identity(
    previous: &SessionManifest,
    candidate: &SessionManifest,
) -> Result<(), SessionError> {
    if previous.id != candidate.id
        || previous.machine != candidate.machine
        || previous.policy != candidate.policy
        || previous.assets != candidate.assets
        || previous.begin != candidate.begin
        || (previous.extensions != candidate.extensions
            && !exact_completion_append(previous, candidate)
            && !crate::session_witness::check_append(previous, candidate))
    {
        return Err(SessionError::IdentityMismatch("session publication"));
    }
    if crate::session_witness::commitment(previous)?.is_some_and(|value| value.finished)
        && previous != candidate
    {
        return Err(SessionError::Invalid("finished paged history"));
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

/// Local variants are opt-in: portable callers continue through the 4 GiB codec.
pub fn references_json_local(bytes: &[u8]) -> Result<Vec<u8>, SessionError> {
    let manifest = SessionManifest::from_bytes_local(bytes)?;
    serde_json::to_vec(&references_local(&manifest)?)
        .map_err(|_| SessionError::Invalid("reference encoding"))
}

pub fn event_references_json_local(manifest: &[u8], chunk: &[u8]) -> Result<Vec<u8>, SessionError> {
    let manifest = SessionManifest::from_bytes_local(manifest)?;
    serde_json::to_vec(&event_references_local(&manifest, chunk)?)
        .map_err(|_| SessionError::Invalid("reference encoding"))
}
