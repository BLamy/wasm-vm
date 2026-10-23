//! Versioned, reference-bearing exact witnesses. Page payloads stay outside the manifest.
use crate::session::{
    BlobRef, ExactU64, MAX_INDEX_ENTRIES, Phase, Position, RecordingMode, SessionError,
    SessionManifest,
};
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

pub const KIND: &str = "e9-exact-witness-pages-v2";
pub const INITIAL_KIND: &str = "e9-exact-initial-witness-v1";
pub const MAX_PAGE_BYTES: usize = 8192;
pub const PAGE_ROWS: usize = 16;
// A separate, bounded v2 index. None of the v1 manifest/replay limits change.
pub const MAX_PAGES: usize = MAX_INDEX_ENTRIES;
pub const MAX_WITNESSES: usize = PAGE_ROWS * MAX_PAGES;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Witness {
    pub transition: ExactU64,
    pub phase: Phase,
    pub ordinal: u32,
    pub sequence: ExactU64,
    pub retired: ExactU64,
    pub digest: [u8; 32],
}
impl Witness {
    pub fn position(&self) -> Position {
        Position {
            transition: self.transition,
            phase: self.phase,
            ordinal: self.ordinal,
            sequence: self.sequence,
            retired: self.retired,
        }
    }
    fn validate(&self) -> Result<(), SessionError> {
        if self.retired > self.transition
            || !matches!(self.phase, Phase::Before | Phase::Observe)
            || (self.phase == Phase::Observe && self.ordinal == 0)
        {
            return Err(SessionError::Invalid("witness position"));
        }
        Ok(())
    }
    pub fn strictly_follows(&self, previous: &Self) -> bool {
        self.position().follows(previous.position())
            && (self.transition, self.phase, self.ordinal, self.sequence)
                != (
                    previous.transition,
                    previous.phase,
                    previous.ordinal,
                    previous.sequence,
                )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WitnessPage {
    pub version: u16,
    pub previous: Option<BlobRef>,
    pub before: u32,
    pub rows: Vec<Witness>,
}
impl WitnessPage {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, SessionError> {
        if bytes.len() > MAX_PAGE_BYTES {
            return Err(SessionError::TooLarge("witness page"));
        }
        let page: Self = serde_json::from_slice(bytes)
            .map_err(|_| SessionError::Invalid("witness page encoding"))?;
        page.validate()?;
        if page.to_bytes()? != bytes {
            return Err(SessionError::Invalid("noncanonical witness page"));
        }
        Ok(page)
    }
    pub fn to_bytes(&self) -> Result<Vec<u8>, SessionError> {
        self.validate()?;
        let bytes =
            serde_json::to_vec(self).map_err(|_| SessionError::Invalid("witness page encoding"))?;
        if bytes.len() > MAX_PAGE_BYTES {
            return Err(SessionError::TooLarge("witness page"));
        }
        Ok(bytes)
    }
    fn validate(&self) -> Result<(), SessionError> {
        if self.version != 2
            || self.rows.is_empty()
            || self.rows.len() > PAGE_ROWS
            || self.before as usize > MAX_WITNESSES - self.rows.len()
            || (self.before == 0) != self.previous.is_none()
        {
            return Err(SessionError::Invalid("witness page shape"));
        }
        if let Some(previous) = &self.previous {
            page_reference(previous)?;
        }
        for row in &self.rows {
            row.validate()?;
        }
        if !self.rows.windows(2).all(|p| p[1].strictly_follows(&p[0])) {
            return Err(SessionError::IndexOrder);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WitnessCommitment {
    pub version: u16,
    pub count: u32,
    pub pages: u32,
    pub tail: BlobRef,
    pub first: Witness,
    pub last: Witness,
    pub finished: bool,
}
fn page_reference(value: &BlobRef) -> Result<(), SessionError> {
    value.validate()?;
    if value.length.0 > MAX_PAGE_BYTES as u64 {
        return Err(SessionError::TooLarge("witness page reference"));
    }
    Ok(())
}
impl WitnessCommitment {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, SessionError> {
        if bytes.len() > MAX_PAGE_BYTES {
            return Err(SessionError::TooLarge("witness commitment"));
        }
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|_| SessionError::Invalid("witness commitment encoding"))?;
        value.validate()?;
        if value.to_bytes()? != bytes {
            return Err(SessionError::Invalid("noncanonical witness commitment"));
        }
        Ok(value)
    }
    pub fn to_bytes(&self) -> Result<Vec<u8>, SessionError> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| SessionError::Invalid("witness commitment encoding"))
    }
    fn validate(&self) -> Result<(), SessionError> {
        page_reference(&self.tail)?;
        self.first.validate()?;
        self.last.validate()?;
        if self.version != 2
            || self.pages == 0
            || self.pages as usize > MAX_PAGES
            || self.count < self.pages
            || self.count as usize > self.pages as usize * PAGE_ROWS
            || (self.count == 1 && (self.first != self.last || self.finished))
            || (self.count > 1 && !self.last.strictly_follows(&self.first))
        {
            return Err(SessionError::Invalid("witness commitment shape"));
        }
        Ok(())
    }
}

/// Metadata admission only. Callers must authenticate every linked page before publication.
/// Required=true makes older clients refuse the manifest before GC can lose its descendants.
pub fn commitment(manifest: &SessionManifest) -> Result<Option<WitnessCommitment>, SessionError> {
    let Some(extension) = manifest.extensions.iter().find(|e| e.kind == KIND) else {
        return Ok(None);
    };
    if manifest.policy.mode != RecordingMode::ExactReplay
        || manifest.extensions.len() != 2
        || manifest.extensions[0].kind != INITIAL_KIND
        || manifest.extensions[0].required
        || manifest.extensions[1].kind != KIND
        || !extension.required
    {
        return Err(SessionError::Invalid("paged witness extensions"));
    }
    let initial: Vec<Witness> = serde_json::from_slice(&manifest.extensions[0].bytes)
        .map_err(|_| SessionError::Invalid("paged initial witness"))?;
    let value = WitnessCommitment::from_bytes(&extension.bytes)?;
    if initial.len() != 1
        || initial[0] != value.first
        || value.first.position() != manifest.begin
        || !manifest.end.follows(value.last.position())
        || (value.finished && value.last.position() != manifest.end)
    {
        return Err(SessionError::IdentityMismatch("witness endpoints"));
    }
    Ok(Some(value))
}

/// Scalar append checks. The durable store additionally proves that the old tail is
/// an exact ancestor at its old count; increasing counters alone is never sufficient.
pub fn check_append(previous: &SessionManifest, candidate: &SessionManifest) -> bool {
    let Ok(Some(next)) = commitment(candidate) else {
        return false;
    };
    if previous.extensions.first() != candidate.extensions.first() {
        return false;
    }
    match commitment(previous) {
        Ok(Some(old)) if old.finished => previous == candidate,
        Ok(Some(old)) => {
            next.first == old.first
                && next.last.position().follows(old.last.position())
                && if next.count == old.count {
                    next.pages == old.pages && next.tail == old.tail && next.last == old.last
                } else {
                    next.count > old.count
                        && next.pages > old.pages
                        && next.tail != old.tail
                        && next.last.strictly_follows(&old.last)
                }
        }
        Ok(None) => false, // Paged mode must exist in the first publication.
        Err(_) => false,
    }
}
