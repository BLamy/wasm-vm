//! E9-T05: authenticated native/disk/host-queue tuple; pure Rust so admission runs natively too.
use sha2::{Digest, Sha256};
use wasm_vm_core::resume::{SectionReader, SnapshotError, SnapshotHeader, section};
use wasm_vm_storage::{
    OverlayDelta, OverlayDeltaError,
    checkpoint::{CheckpointContext, MAX_CONTEXT_BYTES},
    disk_root::DiskRoot,
    session::SessionError,
};

const MAGIC: &[u8; 8] = b"WVSOFT01";
const HEADER: usize = 12 + 5 * 40;
pub const MAX_FRAME_BYTES: usize = 640 << 20;
const LIMITS: [usize; 5] = [
    MAX_CONTEXT_BYTES,
    300 << 20,
    61 + 65536 * 4104,
    1 << 20,
    1 << 20,
];
#[derive(Debug)]
pub enum CheckpointError {
    Bound,
    Malformed,
    Digest,
    Context(SessionError),
    Native(SnapshotError),
    Disk(OverlayDeltaError),
}

pub struct SoftwareCheckpoint<'a> {
    pub context: CheckpointContext,
    pub context_bytes: &'a [u8],
    pub resume: &'a [u8],
    pub disk: &'a [u8],
    pub input: &'a [u8],
    pub output: &'a [u8],
}
fn digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}
impl<'a> SoftwareCheckpoint<'a> {
    pub fn from_bytes(bytes: &'a [u8]) -> Result<Self, CheckpointError> {
        if bytes.len() < HEADER || bytes.len() > MAX_FRAME_BYTES {
            return Err(CheckpointError::Bound);
        }
        if &bytes[..8] != MAGIC || bytes[8..12] != 1u32.to_le_bytes() {
            return Err(CheckpointError::Malformed);
        }
        let mut parts: [&[u8]; 5] = [&[]; 5];
        let mut offset = HEADER;
        for (index, limit) in LIMITS.into_iter().enumerate() {
            let at = 12 + index * 40;
            let length = u64::from_le_bytes(bytes[at..at + 8].try_into().unwrap());
            if length > limit as u64 {
                return Err(CheckpointError::Bound);
            }
            let end = offset
                .checked_add(length as usize)
                .ok_or(CheckpointError::Bound)?;
            let part = bytes.get(offset..end).ok_or(CheckpointError::Malformed)?;
            if digest(part) != bytes[at + 8..at + 40] {
                return Err(CheckpointError::Digest);
            }
            parts[index] = part;
            offset = end;
        }
        if offset != bytes.len() {
            return Err(CheckpointError::Malformed);
        }
        let context = CheckpointContext::from_bytes(parts[0]).map_err(CheckpointError::Context)?;
        if context.to_bytes().map_err(CheckpointError::Context)? != parts[0] {
            return Err(CheckpointError::Malformed);
        }
        let (native, _) = SnapshotHeader::parse(parts[1]).map_err(CheckpointError::Native)?;
        let disk = OverlayDelta::from_bytes(parts[2]).map_err(CheckpointError::Disk)?;
        DiskRoot::from_delta(&disk).map_err(CheckpointError::Context)?;
        if disk.to_bytes() != parts[2] {
            return Err(CheckpointError::Malformed);
        }
        if native.base_image_hash != disk.base_binding
            || native.overlay_generation != disk.generation
        {
            return Err(CheckpointError::Malformed);
        }
        let (_, sections) = SectionReader::new(parts[1]).map_err(CheckpointError::Native)?;
        let mut clocks = 0;
        for item in sections {
            let item = item.map_err(CheckpointError::Native)?;
            // The checkpoint-only library has no event-log cursor binding yet. Never admit an
            // event clock under its legacy zero-position context. The bare-machine event-clock
            // API uses the native envelope; provider admission owns the library integration.
            if item.tag == section::SESSION_CLOCK {
                return Err(CheckpointError::Malformed);
            }
            if item.tag == section::CLOCK {
                clocks += 1;
                if item.payload.len() != 24 {
                    return Err(CheckpointError::Malformed);
                }
                let phase = u64::from_le_bytes(item.payload[..8].try_into().unwrap());
                let divider = u64::from_le_bytes(item.payload[8..16].try_into().unwrap());
                if divider != u64::from(context.clock.divider) || phase >= divider {
                    return Err(CheckpointError::Malformed);
                }
            }
        }
        if clocks != 1 {
            return Err(CheckpointError::Malformed);
        }
        Ok(Self {
            context,
            context_bytes: parts[0],
            resume: parts[1],
            disk: parts[2],
            input: parts[3],
            output: parts[4],
        })
    }
    pub fn encode(
        context: &CheckpointContext,
        resume: &[u8],
        disk: &[u8],
        input: &[u8],
        output: &[u8],
    ) -> Result<Vec<u8>, CheckpointError> {
        let metadata = context.to_bytes().map_err(CheckpointError::Context)?;
        let parts = [metadata.as_slice(), resume, disk, input, output];
        let mut total = HEADER;
        for (part, limit) in parts.iter().zip(LIMITS) {
            if part.len() > limit {
                return Err(CheckpointError::Bound);
            }
            total = total
                .checked_add(part.len())
                .ok_or(CheckpointError::Bound)?;
        }
        if total > MAX_FRAME_BYTES {
            return Err(CheckpointError::Bound);
        }
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(total)
            .map_err(|_| CheckpointError::Bound)?;
        bytes.extend_from_slice(MAGIC);
        bytes.extend_from_slice(&1u32.to_le_bytes());
        for part in parts {
            bytes.extend_from_slice(&(part.len() as u64).to_le_bytes());
            bytes.extend_from_slice(&digest(part));
        }
        for part in parts {
            bytes.extend_from_slice(part);
        }
        SoftwareCheckpoint::from_bytes(&bytes)?;
        Ok(bytes)
    }
}
