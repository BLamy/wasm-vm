//! E3-T12: the **resume-snapshot container format** — a versioned, sectioned (TLV) blob that a
//! whole-machine snapshot serializes into, plus the coherence guards that make restoring one safe.
//! This is the pure format + parser + RAM zero-elision codec; the per-component `Snapshot`/`Restore`
//! visitors (CPU/RAM/CLINT/PLIC/UART/virtio) and the determinism trace-diff are the integration pass
//! (they need the running machine). See `docs/design/snapshot-format.md`.
//!
//! Distinct from [`crate::snapshot`], which is the E0-T17 *state digest* (an assertion helper).
//!
//! **Why the guards matter.** A snapshot is only valid against the *same emulator build* (a changed
//! instruction semantics would resume into a different machine), the *same base disk image*, and an
//! *overlay generation consistent with it*. Restoring a snapshot whose overlay generation no longer
//! matches the disk means the guest's page cache and the disk disagree → silent corruption. So the
//! header binds all three (`core_hash`, `base_image_hash`, `overlay_generation`) and
//! [`SnapshotHeader::validate_for`] refuses a mismatch with a typed error — the caller falls back to
//! a cold boot. **The parser never panics or reads out of bounds** on a truncated/garbage/hand-edited
//! blob (fuzzed): every length is checked against the remaining bytes.

use alloc::vec::Vec;

/// Blob magic — `"WVMRESU1"` (WasmVM RESUme, format family 1).
pub const MAGIC: [u8; 8] = *b"WVMRESU1";
/// The one container-format version this reader understands. An incompatible change bumps it; an
/// unknown version is a hard error (not a best-effort parse).
pub const FORMAT_VERSION: u32 = 1;

const HEADER_LEN: usize = 8 + 4 + 32 + 32 + 8; // magic + version + core_hash + base_hash + overlay_gen
const SECTION_HEADER_LEN: usize = 8; // tag(4) + len(4)

/// Known section tags. The reader **fails loudly** on any tag outside this set (a snapshot written by
/// a newer build with a section this build can't restore must not be silently half-applied).
pub mod section {
    pub const CPU: u32 = 1;
    pub const RAM: u32 = 2;
    pub const CLINT: u32 = 3;
    pub const PLIC: u32 = 4;
    pub const UART: u32 = 5;
    pub const VIRTIO_BLK: u32 = 6;
    pub const VIRTIO_NET: u32 = 7;
}

/// Is `tag` a section this build understands?
pub fn is_known_section(tag: u32) -> bool {
    matches!(
        tag,
        section::CPU
            | section::RAM
            | section::CLINT
            | section::PLIC
            | section::UART
            | section::VIRTIO_BLK
            | section::VIRTIO_NET
    )
}

/// A rejected snapshot — every failure is one of these, never a panic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotError {
    /// The blob is shorter than the fixed header (or a section runs past the end).
    Truncated,
    /// The leading magic is not [`MAGIC`].
    BadMagic,
    /// `format_version` is not [`FORMAT_VERSION`].
    VersionMismatch { found: u32, supported: u32 },
    /// The snapshot was taken by a different emulator build (`core_hash` differs).
    CoreHashMismatch,
    /// The snapshot is for a different base disk image (`base_image_hash` differs) — refuse.
    BaseImageMismatch,
    /// The overlay has advanced since the snapshot (or is otherwise inconsistent) — refuse rather
    /// than resume a stale CPU/RAM state over a newer disk (the corruption case).
    OverlayGenerationMismatch { snapshot: u64, current: u64 },
    /// A section tag this build does not understand — fail loudly.
    UnknownSection { tag: u32 },
    /// A section's declared length exceeds the bytes remaining in the blob.
    SectionLengthOverflow { tag: u32 },
    /// The zero-elision payload decoded to a different length than expected, or is malformed.
    BadSparseEncoding,
    /// A zero-elision run declared a length that would push the output past `expected_len` — rejected
    /// **before** growing the buffer, so a hostile multi-gigabyte run can't force an allocation. This
    /// is a *distinct* variant from [`Self::BadSparseEncoding`] precisely so the pre-allocation bound
    /// is observable: deleting it changes this error (fast) into a trailing length mismatch (after a
    /// giant allocation).
    SparseRunExceedsTotal,
    /// A component-state section payload was the wrong length or otherwise malformed for its
    /// component (`tag`) — restore refuses it rather than half-applying a corrupt state.
    BadComponentState { tag: u32 },
}

/// A machine component (CLINT, PLIC, UART, …) whose full state serializes to a resume-format
/// section payload and restores from one. Encodings are **fixed-layout little-endian**; `restore`
/// rejects a wrong-length/malformed payload with [`SnapshotError::BadComponentState`] — never a
/// panic — so a truncated or hand-edited snapshot can't half-apply a corrupt device state.
///
/// This is the seam the whole-machine snapshot is built from: each component writes its
/// [`Self::SECTION`] section on save and restores it on load. The CPU/RAM visitors and the
/// determinism trace-diff (which proves *completeness*, not just round-trip) are the boot-gated
/// integration pass; a bounded device like the CLINT/PLIC is fully round-trip-verifiable headlessly
/// because its entire behavioural state is enumerable.
pub trait ComponentSnapshot {
    /// The resume-format section tag this component's state is stored under.
    const SECTION: u32;
    /// Serialize the component's full behavioural state to a section payload.
    fn to_snapshot(&self) -> Vec<u8>;
    /// Restore behavioural state from a payload. A wrong-length/malformed payload is a typed error.
    fn restore(&mut self, payload: &[u8]) -> Result<(), SnapshotError>;
}

/// The parsed, fixed-size container header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotHeader {
    pub format_version: u32,
    /// Identity of the emulator build that wrote this (e.g. the core-crate git hash).
    pub core_hash: [u8; 32],
    /// Identity of the base disk image this snapshot rides (the base-image manifest hash).
    pub base_image_hash: [u8; 32],
    /// The overlay commit generation at snapshot time.
    pub overlay_generation: u64,
}

impl SnapshotHeader {
    /// Parse + magic/version-check the header. Returns the header and the offset where sections
    /// begin. Does not check the identity guards — use [`Self::validate_for`].
    pub fn parse(blob: &[u8]) -> Result<(SnapshotHeader, usize), SnapshotError> {
        if blob.len() < HEADER_LEN {
            return Err(SnapshotError::Truncated);
        }
        if blob[0..8] != MAGIC {
            return Err(SnapshotError::BadMagic);
        }
        let format_version = u32_le(&blob[8..12]);
        if format_version != FORMAT_VERSION {
            return Err(SnapshotError::VersionMismatch {
                found: format_version,
                supported: FORMAT_VERSION,
            });
        }
        let mut core_hash = [0u8; 32];
        core_hash.copy_from_slice(&blob[12..44]);
        let mut base_image_hash = [0u8; 32];
        base_image_hash.copy_from_slice(&blob[44..76]);
        let overlay_generation = u64_le(&blob[76..84]);
        Ok((
            SnapshotHeader {
                format_version,
                core_hash,
                base_image_hash,
                overlay_generation,
            },
            HEADER_LEN,
        ))
    }

    /// The coherence guards: refuse a snapshot from a different build, a different base image, or an
    /// overlay generation that no longer matches the live disk. `Ok(())` means it is safe to restore.
    pub fn validate_for(
        &self,
        expected_core_hash: &[u8; 32],
        expected_base_image_hash: &[u8; 32],
        current_overlay_generation: u64,
    ) -> Result<(), SnapshotError> {
        if self.core_hash != *expected_core_hash {
            return Err(SnapshotError::CoreHashMismatch);
        }
        if self.base_image_hash != *expected_base_image_hash {
            return Err(SnapshotError::BaseImageMismatch);
        }
        if self.overlay_generation != current_overlay_generation {
            return Err(SnapshotError::OverlayGenerationMismatch {
                snapshot: self.overlay_generation,
                current: current_overlay_generation,
            });
        }
        Ok(())
    }
}

/// Builds a snapshot blob: fixed header, then TLV sections in the order added.
pub struct SnapshotWriter {
    buf: Vec<u8>,
}

impl SnapshotWriter {
    pub fn new(core_hash: &[u8; 32], base_image_hash: &[u8; 32], overlay_generation: u64) -> Self {
        let mut buf = Vec::with_capacity(HEADER_LEN);
        buf.extend_from_slice(&MAGIC);
        buf.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        buf.extend_from_slice(core_hash);
        buf.extend_from_slice(base_image_hash);
        buf.extend_from_slice(&overlay_generation.to_le_bytes());
        Self { buf }
    }

    /// Append a section `[tag][len][payload]`. Panics only on the impossible case of a payload longer
    /// than `u32::MAX` (a >4 GiB section) — callers pass component state far smaller.
    pub fn section(&mut self, tag: u32, payload: &[u8]) -> &mut Self {
        let len: u32 = payload
            .len()
            .try_into()
            .expect("snapshot section exceeds u32::MAX bytes");
        self.buf.extend_from_slice(&tag.to_le_bytes());
        self.buf.extend_from_slice(&len.to_le_bytes());
        self.buf.extend_from_slice(payload);
        self
    }

    /// The finished blob.
    pub fn finish(self) -> Vec<u8> {
        self.buf
    }
}

/// One parsed section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section<'a> {
    pub tag: u32,
    pub payload: &'a [u8],
}

/// Iterates the sections after the header, **bounds-checking every length** and rejecting any tag
/// this build does not know. Stops (yields `None`) at the exact end of the blob; a partial trailing
/// section is [`SnapshotError::Truncated`].
pub struct SectionReader<'a> {
    blob: &'a [u8],
    pos: usize,
    done: bool,
}

impl<'a> SectionReader<'a> {
    /// Position the reader after the header (which is parsed + version-checked here).
    pub fn new(blob: &'a [u8]) -> Result<(SnapshotHeader, SectionReader<'a>), SnapshotError> {
        let (header, start) = SnapshotHeader::parse(blob)?;
        Ok((
            header,
            SectionReader {
                blob,
                pos: start,
                done: false,
            },
        ))
    }
}

impl<'a> Iterator for SectionReader<'a> {
    type Item = Result<Section<'a>, SnapshotError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done || self.pos == self.blob.len() {
            return None;
        }
        // A started-but-incomplete section header is a truncation.
        if self.pos + SECTION_HEADER_LEN > self.blob.len() {
            self.done = true;
            return Some(Err(SnapshotError::Truncated));
        }
        let tag = u32_le(&self.blob[self.pos..self.pos + 4]);
        let len = u32_le(&self.blob[self.pos + 4..self.pos + 8]) as usize;
        let body = self.pos + SECTION_HEADER_LEN;
        // Bounds-check the declared length against what's actually there — the core fuzz guard.
        let end = match body.checked_add(len) {
            Some(e) if e <= self.blob.len() => e,
            _ => {
                self.done = true;
                return Some(Err(SnapshotError::SectionLengthOverflow { tag }));
            }
        };
        if !is_known_section(tag) {
            self.done = true;
            return Some(Err(SnapshotError::UnknownSection { tag }));
        }
        self.pos = end;
        Some(Ok(Section {
            tag,
            payload: &self.blob[body..end],
        }))
    }
}

// ── RAM zero-elision codec ───────────────────────────────────────────────────
//
// A 256 MiB guest RAM that is mostly zero must not serialize to a 256 MiB blob. This is a
// run-length codec that collapses zero runs: the byte stream is a sequence of chunks
// `[kind: u8][len: u32 LE]` where `kind = 0` is a run of `len` implicit zero bytes (no payload) and
// `kind = 1` is `len` literal bytes that follow. Decoding is fully bounds-checked and asserts the
// reconstructed length, so a truncated/garbage payload is a typed error, never an over-read.

const CHUNK_ZERO: u8 = 0;
const CHUNK_DATA: u8 = 1;

/// Encode `buf` with zero-run elision. A mostly-zero buffer shrinks to roughly the size of its
/// non-zero spans.
pub fn encode_sparse(buf: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < buf.len() {
        let is_zero = buf[i] == 0;
        let start = i;
        while i < buf.len() && (buf[i] == 0) == is_zero {
            i += 1;
        }
        // Split a run longer than u32::MAX into multiple chunks (unreachable on wasm32 usize=u32).
        let mut run = i - start;
        let mut span_start = start;
        while run > 0 {
            let take = run.min(u32::MAX as usize);
            if is_zero {
                out.push(CHUNK_ZERO);
                out.extend_from_slice(&(take as u32).to_le_bytes());
            } else {
                out.push(CHUNK_DATA);
                out.extend_from_slice(&(take as u32).to_le_bytes());
                out.extend_from_slice(&buf[span_start..span_start + take]);
            }
            span_start += take;
            run -= take;
        }
    }
    out
}

/// Decode a [`encode_sparse`] payload back to exactly `expected_len` bytes. A payload that is
/// malformed, over-reads, or reconstructs to the wrong length is [`SnapshotError::BadSparseEncoding`].
///
/// A run length is checked against `expected_len` **before** the buffer grows, so a hostile
/// zero-chunk claiming a 4 GiB run (whose length is not bounded by the input size) is rejected
/// rather than triggering an unbounded allocation.
pub fn decode_sparse(enc: &[u8], expected_len: usize) -> Result<Vec<u8>, SnapshotError> {
    let mut out = Vec::with_capacity(expected_len.min(enc.len().saturating_mul(2)));
    let mut i = 0;
    while i < enc.len() {
        // kind byte + u32 length.
        if i + 5 > enc.len() {
            return Err(SnapshotError::BadSparseEncoding);
        }
        let kind = enc[i];
        let len = u32_le(&enc[i + 1..i + 5]) as usize;
        i += 5;
        // Bound the run against the declared total BEFORE allocating — an untrusted zero-run length
        // must not be able to force a multi-gigabyte resize. This uses a DISTINCT error variant from
        // the trailing length check so the guard is observable (mutation-testable).
        let new_len = out
            .len()
            .checked_add(len)
            .ok_or(SnapshotError::SparseRunExceedsTotal)?;
        if new_len > expected_len {
            return Err(SnapshotError::SparseRunExceedsTotal);
        }
        match kind {
            CHUNK_ZERO => {
                out.resize(new_len, 0);
            }
            CHUNK_DATA => {
                let end = i.checked_add(len).ok_or(SnapshotError::BadSparseEncoding)?;
                if end > enc.len() {
                    return Err(SnapshotError::BadSparseEncoding);
                }
                out.extend_from_slice(&enc[i..end]);
                i = end;
            }
            _ => return Err(SnapshotError::BadSparseEncoding),
        }
    }
    if out.len() != expected_len {
        return Err(SnapshotError::BadSparseEncoding);
    }
    Ok(out)
}

#[inline]
fn u32_le(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

#[inline]
fn u64_le(b: &[u8]) -> u64 {
    u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

#[cfg(test)]
#[path = "resume_tests.rs"]
mod resume_tests;
