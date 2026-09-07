//! E5-T26a: the versioned desktop-device snapshot envelope and its quiesce boundary.
//!
//! This module deliberately owns the *container* contract only.  GPU, input, sound, and agent
//! payloads land in later T26 slices; here they are opaque, versioned sections.  Keeping the
//! framing separate from [`crate::resume`] prevents the browser-facing desktop state from
//! accidentally changing the already-frozen whole-machine resume format.
//!
//! The envelope is canonical and self-authenticating:
//!
//! ```text
//! magic[8] | format:u16 | flags:u16 | boundary:u64 | count:u32 | sections_len:u32
//! section := tag:u16 | version:u16 | payload_len:u32 | payload_digest[32] | payload[payload_len]
//! envelope_digest[32] = SHA-256(all bytes before this trailer)
//! ```
//!
//! Every parser check happens before a caller can obtain a section for restore.  A restore caller
//! therefore parses once, then mutates live device state only from the returned, fully validated
//! value.  Unknown tags, duplicate tags, forward versions, truncation, and either digest mismatch
//! fail closed with a stable machine-readable error code.

use alloc::vec::Vec;
use sha2::{Digest, Sha256};

/// Desktop envelope magic (`WVM` + `DESK` + format-family byte).
pub const MAGIC: [u8; 8] = *b"WVMDESK1";
/// The envelope format version understood by this build.
pub const FORMAT_VERSION: u16 = 1;
/// The maximum number of device sections in one envelope.  This bounds duplicate checking and
/// keeps malformed input from turning the parser into an unbounded work queue.
pub const MAX_SECTIONS: u32 = 64;
/// The default number of device-boundary service passes a snapshot request may consume.
pub const DEFAULT_QUIESCE_PASSES: u32 = 16;

const HEADER_LEN: usize = 8 + 2 + 2 + 8 + 4 + 4;
const SECTION_HEADER_LEN: usize = 2 + 2 + 4 + 32;
const TRAILER_LEN: usize = 32;

/// Reserved desktop component section tags.  The payload codecs are intentionally owned by later
/// slices; T26a only reserves the stable identifiers and version-1 schema slot.
pub mod section {
    /// Virtio-GPU resources, scanouts, cursor, and host shadow state (T26b).
    pub const GPU: u16 = 1;
    /// Virtio-input pending queues and LED state (T26c).
    pub const INPUT: u16 = 2;
    /// Virtio-snd stream/XRUN state (T26d).
    pub const SOUND: u16 = 3;
    /// Agent/host reconciliation state (T26e).
    pub const AGENT: u16 = 4;
}

#[inline]
fn section_is_known(tag: u16) -> bool {
    matches!(
        tag,
        section::GPU | section::INPUT | section::SOUND | section::AGENT
    )
}

#[inline]
fn digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// A malformed or unsupported desktop snapshot.  The enum is intentionally closed: callers can
/// map [`Self::code`] to a persisted diagnostic without parsing a human-readable message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopSnapshotError {
    /// The fixed header, section header, section payload, or digest trailer is incomplete.
    Truncated,
    /// The leading bytes are not [`MAGIC`].
    BadMagic,
    /// The envelope format is newer (or otherwise incompatible) with this reader.
    UnsupportedEnvelopeVersion { found: u16, supported: u16 },
    /// Header flags are reserved and must be zero until a later format version defines them.
    ReservedHeaderFlags { found: u16 },
    /// The section count exceeds the parser's hard bound.
    TooManySections { found: u32, maximum: u32 },
    /// The declared section-table byte length cannot fit in the supplied blob.
    SectionTableLengthOverflow,
    /// The section table contains bytes which do not form exactly `section_count` sections.
    SectionTableLengthMismatch { remaining: u32 },
    /// A tag outside the reserved desktop component set is never skipped.
    UnknownSection { tag: u16 },
    /// A section tag appears more than once; applying either copy would be ambiguous.
    DuplicateSection { tag: u16 },
    /// A component section is newer than the version this build can restore.
    UnsupportedSectionVersion {
        tag: u16,
        found: u16,
        supported: u16,
    },
    /// A section payload length exceeds the section-table boundary.
    SectionLengthOverflow { tag: u16 },
    /// The section's payload digest does not match its bytes.
    ComponentDigestMismatch { tag: u16 },
    /// The canonical bytes do not match the envelope digest trailer.
    EnvelopeDigestMismatch,
    /// A builder was asked to append more than one copy of a section.
    BuilderDuplicateSection { tag: u16 },
    /// A builder was asked to encode a payload too large for the fixed u32 length field.
    PayloadTooLarge { tag: u16 },
    /// A caller attempted to release a quiesce permit that is not active/current.
    InvalidQuiescePermit,
    /// The device did not reach an idle boundary within the fixed service budget.
    QuiesceBudgetExhausted { passes: u32, work: DeviceWork },
    /// A second snapshot request was started while the first one owned the boundary.
    QuiesceAlreadyActive,
}

impl DesktopSnapshotError {
    /// Stable, machine-readable error code for logs and host APIs.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Truncated => "truncated",
            Self::BadMagic => "bad_magic",
            Self::UnsupportedEnvelopeVersion { .. } => "unsupported_envelope_version",
            Self::ReservedHeaderFlags { .. } => "reserved_header_flags",
            Self::TooManySections { .. } => "too_many_sections",
            Self::SectionTableLengthOverflow => "section_table_length_overflow",
            Self::SectionTableLengthMismatch { .. } => "section_table_length_mismatch",
            Self::UnknownSection { .. } => "unknown_section",
            Self::DuplicateSection { .. } => "duplicate_section",
            Self::UnsupportedSectionVersion { .. } => "unsupported_section_version",
            Self::SectionLengthOverflow { .. } => "section_length_overflow",
            Self::ComponentDigestMismatch { .. } => "component_digest_mismatch",
            Self::EnvelopeDigestMismatch => "envelope_digest_mismatch",
            Self::BuilderDuplicateSection { .. } => "builder_duplicate_section",
            Self::PayloadTooLarge { .. } => "payload_too_large",
            Self::InvalidQuiescePermit => "invalid_quiesce_permit",
            Self::QuiesceBudgetExhausted { .. } => "quiesce_budget_exhausted",
            Self::QuiesceAlreadyActive => "quiesce_already_active",
        }
    }
}

/// One fully validated, owned desktop section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopSnapshotSection {
    pub tag: u16,
    pub version: u16,
    pub payload: Vec<u8>,
    pub payload_digest: [u8; 32],
}

impl DesktopSnapshotSection {
    fn new(tag: u16, version: u16, payload: &[u8]) -> Self {
        Self {
            tag,
            version,
            payload: payload.to_vec(),
            payload_digest: digest(payload),
        }
    }
}

/// A parsed, fully validated desktop snapshot envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopSnapshot {
    boundary_id: u64,
    sections: Vec<DesktopSnapshotSection>,
    envelope_digest: [u8; 32],
}

impl DesktopSnapshot {
    /// Parse and validate the entire envelope without mutating any device state.
    pub fn parse(blob: &[u8]) -> Result<Self, DesktopSnapshotError> {
        if blob.len() < HEADER_LEN + TRAILER_LEN {
            return Err(DesktopSnapshotError::Truncated);
        }
        if blob[..MAGIC.len()] != MAGIC {
            return Err(DesktopSnapshotError::BadMagic);
        }
        let format_version = u16_le(&blob[8..10]);
        if format_version != FORMAT_VERSION {
            return Err(DesktopSnapshotError::UnsupportedEnvelopeVersion {
                found: format_version,
                supported: FORMAT_VERSION,
            });
        }
        let flags = u16_le(&blob[10..12]);
        if flags != 0 {
            return Err(DesktopSnapshotError::ReservedHeaderFlags { found: flags });
        }
        let boundary_id = u64_le(&blob[12..20]);
        let section_count = u32_le(&blob[20..24]);
        if section_count > MAX_SECTIONS {
            return Err(DesktopSnapshotError::TooManySections {
                found: section_count,
                maximum: MAX_SECTIONS,
            });
        }
        let sections_len = u32_le(&blob[24..28]) as usize;
        let sections_end = HEADER_LEN
            .checked_add(sections_len)
            .ok_or(DesktopSnapshotError::SectionTableLengthOverflow)?;
        let expected_len = sections_end
            .checked_add(TRAILER_LEN)
            .ok_or(DesktopSnapshotError::SectionTableLengthOverflow)?;
        if expected_len > blob.len() {
            return Err(DesktopSnapshotError::Truncated);
        }
        if expected_len < blob.len() {
            return Err(DesktopSnapshotError::SectionTableLengthMismatch {
                remaining: (blob.len() - expected_len) as u32,
            });
        }

        let mut pos = HEADER_LEN;
        let mut seen = Vec::with_capacity(section_count as usize);
        let mut sections = Vec::with_capacity(section_count as usize);
        for _ in 0..section_count {
            if sections_end.saturating_sub(pos) < SECTION_HEADER_LEN {
                return Err(DesktopSnapshotError::Truncated);
            }
            let tag = u16_le(&blob[pos..pos + 2]);
            let version = u16_le(&blob[pos + 2..pos + 4]);
            let payload_len = u32_le(&blob[pos + 4..pos + 8]) as usize;
            let mut expected_component_digest = [0u8; 32];
            expected_component_digest.copy_from_slice(&blob[pos + 8..pos + 40]);
            pos += SECTION_HEADER_LEN;

            if !section_is_known(tag) {
                return Err(DesktopSnapshotError::UnknownSection { tag });
            }
            if version != FORMAT_VERSION {
                return Err(DesktopSnapshotError::UnsupportedSectionVersion {
                    tag,
                    found: version,
                    supported: FORMAT_VERSION,
                });
            }
            if seen.contains(&tag) {
                return Err(DesktopSnapshotError::DuplicateSection { tag });
            }
            seen.push(tag);
            let end = pos
                .checked_add(payload_len)
                .filter(|end| *end <= sections_end)
                .ok_or(DesktopSnapshotError::SectionLengthOverflow { tag })?;
            let payload = &blob[pos..end];
            if digest(payload) != expected_component_digest {
                return Err(DesktopSnapshotError::ComponentDigestMismatch { tag });
            }
            sections.push(DesktopSnapshotSection {
                tag,
                version,
                payload: payload.to_vec(),
                payload_digest: expected_component_digest,
            });
            pos = end;
        }
        if pos != sections_end {
            return Err(DesktopSnapshotError::SectionTableLengthMismatch {
                remaining: (sections_end - pos) as u32,
            });
        }

        let expected_envelope_digest = digest(&blob[..sections_end]);
        let mut envelope_digest = [0u8; 32];
        envelope_digest.copy_from_slice(&blob[sections_end..]);
        if expected_envelope_digest != envelope_digest {
            return Err(DesktopSnapshotError::EnvelopeDigestMismatch);
        }

        Ok(Self {
            boundary_id,
            sections,
            envelope_digest,
        })
    }

    /// The monotonic host/device boundary identifier supplied by the snapshot requester.
    pub fn boundary_id(&self) -> u64 {
        self.boundary_id
    }

    /// The validated sections in canonical wire order.
    pub fn sections(&self) -> &[DesktopSnapshotSection] {
        &self.sections
    }

    /// Return one validated section by tag.
    pub fn section(&self, tag: u16) -> Option<&DesktopSnapshotSection> {
        self.sections.iter().find(|section| section.tag == tag)
    }

    /// The stable digest over the canonical header and section bytes.
    pub fn envelope_digest(&self) -> [u8; 32] {
        self.envelope_digest
    }

    /// Re-encode the canonical representation. A parsed envelope always round-trips byte-for-byte.
    pub fn encode(&self) -> Vec<u8> {
        let mut builder = DesktopSnapshotBuilder::new(self.boundary_id);
        for section in &self.sections {
            // The parser already validated these values, so this cannot fail unless this module's
            // invariants are changed inconsistently. Avoid an `expect` in the no_std core by
            // building the bytes directly from the owned validated fields.
            builder.sections.push(section.clone());
        }
        builder.finish().unwrap_or_default()
    }
}

/// Canonical desktop-envelope builder.
#[derive(Debug, Clone)]
pub struct DesktopSnapshotBuilder {
    boundary_id: u64,
    sections: Vec<DesktopSnapshotSection>,
}

impl DesktopSnapshotBuilder {
    /// Start an empty envelope for a caller-supplied deterministic boundary identifier.
    pub fn new(boundary_id: u64) -> Self {
        Self {
            boundary_id,
            sections: Vec::new(),
        }
    }

    /// Append one version-1 opaque component payload. Later T26 slices own the meaning of the
    /// payload; the envelope owns its framing, uniqueness, and digest.
    pub fn section(
        &mut self,
        tag: u16,
        version: u16,
        payload: &[u8],
    ) -> Result<&mut Self, DesktopSnapshotError> {
        if !section_is_known(tag) {
            return Err(DesktopSnapshotError::UnknownSection { tag });
        }
        if version != FORMAT_VERSION {
            return Err(DesktopSnapshotError::UnsupportedSectionVersion {
                tag,
                found: version,
                supported: FORMAT_VERSION,
            });
        }
        if self.sections.iter().any(|section| section.tag == tag) {
            return Err(DesktopSnapshotError::BuilderDuplicateSection { tag });
        }
        if payload.len() > u32::MAX as usize {
            return Err(DesktopSnapshotError::PayloadTooLarge { tag });
        }
        if self.sections.len() >= MAX_SECTIONS as usize {
            return Err(DesktopSnapshotError::TooManySections {
                found: MAX_SECTIONS + 1,
                maximum: MAX_SECTIONS,
            });
        }
        self.sections
            .push(DesktopSnapshotSection::new(tag, version, payload));
        Ok(self)
    }

    /// Finish the canonical bytes, including the stable envelope digest trailer.
    pub fn finish(self) -> Result<Vec<u8>, DesktopSnapshotError> {
        let mut sections_len = 0usize;
        for section in &self.sections {
            sections_len = sections_len
                .checked_add(SECTION_HEADER_LEN)
                .and_then(|len| len.checked_add(section.payload.len()))
                .ok_or(DesktopSnapshotError::SectionTableLengthOverflow)?;
        }
        let sections_len_u32 = u32::try_from(sections_len)
            .map_err(|_| DesktopSnapshotError::SectionTableLengthOverflow)?;
        let mut out = Vec::with_capacity(HEADER_LEN + sections_len + TRAILER_LEN);
        out.extend_from_slice(&MAGIC);
        out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // reserved flags
        out.extend_from_slice(&self.boundary_id.to_le_bytes());
        out.extend_from_slice(&(self.sections.len() as u32).to_le_bytes());
        out.extend_from_slice(&sections_len_u32.to_le_bytes());
        for section in &self.sections {
            out.extend_from_slice(&section.tag.to_le_bytes());
            out.extend_from_slice(&section.version.to_le_bytes());
            out.extend_from_slice(&(section.payload.len() as u32).to_le_bytes());
            out.extend_from_slice(&section.payload_digest);
            out.extend_from_slice(&section.payload);
        }
        out.extend_from_slice(&digest(&out));
        Ok(out)
    }
}

/// The observed state of a participant at a device boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceWork {
    /// No control descriptor is queued or half-processed.
    Idle,
    /// Work is queued but has not entered a device operation yet.
    Queued { count: u32 },
    /// A control operation is currently half-processed and must not cross the checkpoint.
    InFlight { count: u32 },
}

impl DeviceWork {
    fn is_idle(self) -> bool {
        matches!(self, Self::Idle)
    }
}

/// A participant adapter for the atomic desktop snapshot boundary.
///
/// `service_snapshot_boundary` advances exactly one bounded device/virtqueue boundary. It must not
/// wait on host I/O. If the budget expires, `abort_snapshot` must release any temporary ownership
/// or half-processed descriptor state so the next ordinary request can use the device.
pub trait SnapshotQuiesceDevice {
    /// Report whether the participant is idle, queued, or in-flight.
    fn snapshot_work(&self) -> DeviceWork;
    /// Service one bounded boundary and return promptly.
    fn service_snapshot_boundary(&mut self);
    /// Abort a failed checkpoint and restore ordinary queue ownership.
    fn abort_snapshot(&mut self);
    /// Release a successful checkpoint's temporary quiesce ownership.
    fn resume_after_snapshot(&mut self);
}

/// A bounded, reusable quiesce coordinator. It owns the checkpoint gate, while the participant owns
/// its actual virtqueue/control state. No snapshot payload is published unless `request` returns a
/// permit; a timeout calls `abort_snapshot` before returning the typed error.
#[derive(Debug, Clone, Copy)]
pub struct SnapshotQuiesce {
    max_passes: u32,
    next_epoch: u64,
    active_epoch: Option<u64>,
}

/// Proof that one participant reached an idle boundary. The token is intentionally opaque and must
/// be passed to [`SnapshotQuiesce::release`] after the caller has copied its payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuiescePermit {
    epoch: u64,
}

impl SnapshotQuiesce {
    /// Create a coordinator. A zero budget is normalized to one bounded service pass.
    pub fn new(max_passes: u32) -> Self {
        Self {
            max_passes: max_passes.max(1),
            next_epoch: 0,
            active_epoch: None,
        }
    }

    /// The default bounded coordinator used by desktop hosts.
    pub fn default_budget() -> Self {
        Self::new(DEFAULT_QUIESCE_PASSES)
    }

    /// Request an idle participant boundary within the fixed pass budget.
    pub fn request<D: SnapshotQuiesceDevice>(
        &mut self,
        device: &mut D,
    ) -> Result<QuiescePermit, DesktopSnapshotError> {
        if self.active_epoch.is_some() {
            return Err(DesktopSnapshotError::QuiesceAlreadyActive);
        }
        for _ in 0..self.max_passes {
            if device.snapshot_work().is_idle() {
                return Ok(self.grant_permit());
            }
            device.service_snapshot_boundary();
        }
        if device.snapshot_work().is_idle() {
            return Ok(self.grant_permit());
        }
        let work = device.snapshot_work();
        device.abort_snapshot();
        Err(DesktopSnapshotError::QuiesceBudgetExhausted {
            passes: self.max_passes,
            work,
        })
    }

    /// Release a successful permit after the caller has copied all section payloads.
    pub fn release<D: SnapshotQuiesceDevice>(
        &mut self,
        device: &mut D,
        permit: QuiescePermit,
    ) -> Result<(), DesktopSnapshotError> {
        if self.active_epoch != Some(permit.epoch) {
            return Err(DesktopSnapshotError::InvalidQuiescePermit);
        }
        device.resume_after_snapshot();
        self.active_epoch = None;
        Ok(())
    }

    /// Abort an active request explicitly. This is idempotent and always returns the participant to
    /// ordinary queue ownership before another request can start.
    pub fn abort<D: SnapshotQuiesceDevice>(&mut self, device: &mut D) {
        if self.active_epoch.take().is_some() {
            device.abort_snapshot();
        }
    }

    /// Whether this coordinator currently owns a successful checkpoint boundary.
    pub fn is_active(&self) -> bool {
        self.active_epoch.is_some()
    }

    fn grant_permit(&mut self) -> QuiescePermit {
        self.next_epoch = self.next_epoch.wrapping_add(1);
        self.active_epoch = Some(self.next_epoch);
        QuiescePermit {
            epoch: self.next_epoch,
        }
    }
}

impl Default for SnapshotQuiesce {
    fn default() -> Self {
        Self::default_budget()
    }
}

#[inline]
fn u16_le(bytes: &[u8]) -> u16 {
    u16::from_le_bytes([bytes[0], bytes[1]])
}

#[inline]
fn u32_le(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

#[inline]
fn u64_le(bytes: &[u8]) -> u64 {
    u64::from_le_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ])
}

#[cfg(test)]
#[path = "desktop_snapshot_tests.rs"]
mod desktop_snapshot_tests;
