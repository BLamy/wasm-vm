//! Explicit production GPU checkpoint metadata. Physical renderer contents are a separate,
//! digest-bound host artifact; ordinary 2D/resume APIs never opt into this codec implicitly.
use alloc::{collections::BTreeSet, vec::Vec};
use sha2::{Digest, Sha256};

use super::{
    GpuState, capabilities::CAPSET_BYTES, control3d::*, resources::NONE_RESOURCE_ID, scanout3d::*,
    snapshot, submit3d::*,
};

const MAGIC: &[u8; 8] = b"WVGPU3D1";
const MAX_BYTES: usize = 256 * 1024 * 1024;
const MAX_CONTROL_BYTES: usize = 32 * 1024 * 1024;
const AGGREGATE_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuCheckpointError {
    Unsupported,
    Busy,
    Corrupt,
    Invalid,
    ProfileMismatch,
    WitnessMismatch,
    EpochExhausted,
}
impl GpuCheckpointError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Unsupported => "gpu_checkpoint_unsupported",
            Self::Busy => "gpu_checkpoint_busy",
            Self::Corrupt => "gpu_checkpoint_corrupt",
            Self::Invalid => "gpu_checkpoint_invalid",
            Self::ProfileMismatch => "gpu_checkpoint_profile_mismatch",
            Self::WitnessMismatch => "gpu_checkpoint_witness_mismatch",
            Self::EpochExhausted => "gpu_checkpoint_epoch_exhausted",
        }
    }
}
type Error = GpuCheckpointError;
fn need(value: bool) -> Result<(), Error> {
    if value { Ok(()) } else { Err(Error::Invalid) }
}
fn put_blob(out: &mut Vec<u8>, bytes: &[u8]) -> Result<(), Error> {
    need(bytes.len() <= MAX_BYTES)?;
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
    Ok(())
}
struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], Error> {
        let end = self.offset.checked_add(n).ok_or(Error::Corrupt)?;
        let value = self.bytes.get(self.offset..end).ok_or(Error::Corrupt)?;
        self.offset = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, Error> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, Error> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().map_err(|_| Error::Corrupt)?,
        ))
    }
    fn u64(&mut self) -> Result<u64, Error> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| Error::Corrupt)?,
        ))
    }
    fn count(&mut self, maximum: usize, minimum_bytes: usize) -> Result<usize, Error> {
        let n = self.u32()? as usize;
        need(n <= maximum && n <= self.bytes.len().saturating_sub(self.offset) / minimum_bytes)?;
        Ok(n)
    }
    fn blob(&mut self, max: usize) -> Result<&'a [u8], Error> {
        let n = self.u32()? as usize;
        need(n <= max)?;
        self.take(n)
    }
    fn id(&mut self) -> Result<Control3dId, Error> {
        let id = Control3dId {
            id: self.u32()?,
            generation: self.u64()?,
        };
        need(id.id != 0 && id.generation != 0)?;
        Ok(id)
    }
    fn metadata(&mut self) -> Result<Resource3dMetadata, Error> {
        Ok(Resource3dMetadata {
            resource_id: self.u32()?,
            target: self.u32()?,
            format: self.u32()?,
            bind: self.u32()?,
            width: self.u32()?,
            height: self.u32()?,
            depth: self.u32()?,
            array_size: self.u32()?,
            last_level: self.u32()?,
            nr_samples: self.u32()?,
            flags: self.u32()?,
        })
    }
    fn finish(self) -> Result<(), Error> {
        need(self.offset == self.bytes.len())
    }
}
fn control(
    bytes: &[u8],
    live: &super::control3d::Control3dState,
    ram_base: u64,
    ram_len: u64,
) -> Result<Control3dSnapshot, Error> {
    let mut r = Reader::new(bytes);
    need(r.take(8)? == b"WV3DCTL2")?;
    let mut value = Control3dSnapshot {
        epoch: r.u64()?,
        next_generation: r.u64()?,
        next_backing_generation: r.u64()?,
        logical_bytes: r.u64()?,
        gpu_bytes: r.u64()?,
        backing_bytes: r.u64()?,
        poisoned: false,
        contexts: Vec::new(),
        resources: Vec::new(),
    };
    need(
        r.u8()? == 0
            && value.epoch > 0
            && value.next_generation > 0
            && value.next_backing_generation > 0,
    )?;
    let mut generations = BTreeSet::new();
    for _ in 0..r.count(MAX_CONTEXTS, 20)? {
        let identity = r.id()?;
        need(
            identity.generation < value.next_generation && generations.insert(identity.generation),
        )?;
        need(
            value
                .contexts
                .last()
                .is_none_or(|c: &Context3dSnapshot| c.identity.id < identity.id),
        )?;
        let debug_name = r.blob(64)?.to_vec();
        let mut resources = Vec::new();
        for _ in 0..r.count(MAX_DESKTOP_RESOURCES, 12)? {
            let id = r.id()?;
            need(
                resources
                    .last()
                    .is_none_or(|prior: &Control3dId| prior.id < id.id),
            )?;
            resources.push(id);
        }
        value.contexts.push(Context3dSnapshot {
            identity,
            debug_name,
            resources,
        });
    }
    let mut backing_generations = BTreeSet::new();
    let mut logical = 0u64;
    let mut gpu = 0u64;
    let mut backed = 0u64;
    let ram_end = ram_base.checked_add(ram_len).ok_or(Error::Invalid)?;
    for _ in 0..r.count(MAX_DESKTOP_RESOURCES, 57)? {
        let identity = r.id()?;
        need(
            identity.generation < value.next_generation && generations.insert(identity.generation),
        )?;
        need(
            value
                .resources
                .last()
                .is_none_or(|v: &Resource3dSnapshot| v.identity.id < identity.id),
        )?;
        let metadata = r.metadata()?;
        need(metadata.resource_id == identity.id)?;
        let (a, b) = live
            .checkpoint_sizes(metadata)
            .map_err(|_| Error::Invalid)?;
        logical = logical.checked_add(a).ok_or(Error::Invalid)?;
        gpu = gpu.checked_add(b).ok_or(Error::Invalid)?;
        need(logical <= AGGREGATE_BYTES && gpu <= AGGREGATE_BYTES)?;
        let (backing, backing_generation) = match r.u8()? {
            0 => (None, None),
            1 => {
                let generation = r.u64()?;
                need(
                    generation > 0
                        && generation < value.next_backing_generation
                        && backing_generations.insert(generation),
                )?;
                let mut entries = Vec::new();
                let n = r.count(MAX_PRODUCTION_BACKING_ENTRIES, 12)?;
                need(n > 0)?;
                let mut bytes = 0u64;
                for _ in 0..n {
                    let entry = BackingEntry {
                        addr: r.u64()?,
                        length: r.u32()?,
                    };
                    need(
                        entry.length > 0
                            && entry.addr >= ram_base
                            && entry
                                .addr
                                .checked_add(u64::from(entry.length))
                                .is_some_and(|end| end <= ram_end),
                    )?;
                    bytes = bytes
                        .checked_add(u64::from(entry.length))
                        .ok_or(Error::Invalid)?;
                    need(bytes <= 32 * 1024 * 1024)?;
                    entries.push(entry);
                }
                backed = backed.checked_add(bytes).ok_or(Error::Invalid)?;
                need(backed <= AGGREGATE_BYTES)?;
                (Some(entries), Some(generation))
            }
            _ => return Err(Error::Invalid),
        };
        value.resources.push(Resource3dSnapshot {
            identity,
            metadata,
            backing,
            backing_generation,
        });
    }
    r.finish()?;
    need(
        logical == value.logical_bytes && gpu == value.gpu_bytes && backed == value.backing_bytes,
    )?;
    for ctx in &value.contexts {
        for id in &ctx.resources {
            need(value.resources.iter().any(|v| v.identity == *id))?;
        }
    }
    Ok(value)
}
fn submit(bytes: &[u8]) -> Result<Submit3dSnapshot, Error> {
    let mut r = Reader::new(bytes);
    need(r.take(8)? == b"WV3DSUB2")?;
    let next_sequence = r.u64()?;
    let counters = Submit3dCounters {
        admitted: r.u64()?,
        completed: r.u64()?,
        cancelled: r.u64()?,
        fenced: r.u64()?,
        submission_bytes: r.u64()?,
        input_bytes: r.u64()?,
        output_bytes: r.u64()?,
        exchanges: r.u64()?,
        applied_commands: r.u64()?,
        draws: r.u64()?,
    };
    need(
        r.u8()? == 0
            && next_sequence > 0
            && next_sequence < u64::MAX
            && counters.completed <= counters.admitted
            && counters.cancelled <= counters.admitted
            && counters.fenced <= counters.admitted,
    )?;
    r.finish()?;
    Ok(Submit3dSnapshot {
        next_sequence,
        pending: None,
        counters,
    })
}
fn scanout(bytes: &[u8]) -> Result<Scanout3dSnapshot, Error> {
    let mut r = Reader::new(bytes);
    need(r.take(8)? == b"WV3DSCN1")?;
    let next_generation = r.u64()?;
    let counters = Scanout3dCounters {
        bindings: r.u64()?,
        captures_admitted: r.u64()?,
        captures_completed: r.u64()?,
        captures_failed: r.u64()?,
        accepted_bytes: r.u64()?,
        completed_bytes: r.u64()?,
    };
    let binding = match r.u8()? {
        0 => None,
        1 => {
            let generation = r.u64()?;
            let rect = super::protocol::Rect {
                x: r.u32()?,
                y: r.u32()?,
                width: r.u32()?,
                height: r.u32()?,
            };
            let target = match r.u8()? {
                0 => Scanout3dTarget::Disabled,
                1 => Scanout3dTarget::TwoD {
                    resource_id: r.u32()?,
                    format: r.u32()?,
                    width: r.u32()?,
                    height: r.u32()?,
                },
                2 => {
                    let generation = r.u64()?;
                    let id = r.u32()?;
                    let metadata = r.metadata()?;
                    Scanout3dTarget::Renderer {
                        resource: Control3dId { id, generation },
                        metadata,
                    }
                }
                _ => return Err(Error::Invalid),
            };
            need(generation > 0 && generation < next_generation)?;
            Some(Scanout3dBinding {
                generation,
                rect,
                target,
            })
        }
        _ => return Err(Error::Invalid),
    };
    need(
        next_generation > 0
            && next_generation < u64::MAX
            && counters.captures_completed <= counters.captures_admitted
            && counters.captures_failed <= counters.captures_admitted
            && counters.completed_bytes <= counters.accepted_bytes,
    )?;
    r.finish()?;
    Ok(Scanout3dSnapshot {
        next_generation,
        binding,
        counters,
    })
}
/// Detached state: only the whole-machine preflight may construct this value, before CPU/RAM commit.
pub(crate) struct PreparedGpuCheckpoint {
    two_d: snapshot::PreparedGpu,
    control: Control3dSnapshot,
    submit: Submit3dSnapshot,
    scanout: Scanout3dSnapshot,
    scanout_resource: Option<u32>,
    pub(crate) saved_epoch: u64,
    pub(crate) restored_epoch: u64,
}
impl GpuState {
    pub(crate) fn checkpoint_ready(&self) -> Result<(), Error> {
        if !self.production_selected
            || self.capabilities.is_none()
            || self.control3d.is_none()
            || self.submit3d.is_none()
            || self.scanout3d.is_none()
        {
            return Err(Error::Unsupported);
        }
        let submit = self.submit3d.as_ref().ok_or(Error::Unsupported)?;
        if self
            .control3d
            .as_ref()
            .ok_or(Error::Unsupported)?
            .snapshot()
            .poisoned
            || submit.pending.is_some()
            || submit.mailbox.inspect().active.is_some()
            || submit.mailbox.inspect().ready
            || self.reset_pending
        {
            return Err(Error::Busy);
        }
        Ok(())
    }
    pub(crate) fn to_gpu_checkpoint(&self, witness: &[u8; 32]) -> Result<Vec<u8>, Error> {
        self.checkpoint_ready()?;
        need(witness.iter().any(|v| *v != 0))?;
        let control = self
            .control3d
            .as_ref()
            .ok_or(Error::Unsupported)?
            .snapshot();
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&1u32.to_le_bytes());
        out.extend_from_slice(
            &self
                .scanout_resource
                .unwrap_or(NONE_RESOURCE_ID)
                .to_le_bytes(),
        );
        out.extend_from_slice(witness);
        let cap = self
            .capabilities
            .as_ref()
            .ok_or(Error::Unsupported)?
            .to_bytes();
        put_blob(&mut out, &cap)?;
        let two_d = snapshot::encode_2d(
            self,
            self.scanout_resource
                .filter(|id| self.resources.get(*id).is_some()),
        )
        .map_err(|_| Error::Invalid)?;
        for bytes in [
            two_d,
            control.canonical_bytes(),
            self.submit3d
                .as_ref()
                .ok_or(Error::Unsupported)?
                .snapshot()
                .canonical_bytes(),
            self.scanout3d
                .as_ref()
                .ok_or(Error::Unsupported)?
                .snapshot()
                .canonical_bytes(),
        ] {
            put_blob(&mut out, &bytes)?;
        }
        need(out.len() <= MAX_BYTES - 32)?;
        let digest = Sha256::digest(&out);
        out.extend_from_slice(&digest);
        Ok(out)
    }
    pub(crate) fn prepare_gpu_checkpoint(
        &self,
        bytes: &[u8],
        witness: &[u8; 32],
        ram_base: u64,
        ram_len: u64,
    ) -> Result<PreparedGpuCheckpoint, Error> {
        self.checkpoint_ready()?;
        if bytes.len() < 32 || bytes.len() > MAX_BYTES {
            return Err(Error::Corrupt);
        }
        let (body, digest) = bytes.split_at(bytes.len() - 32);
        if Sha256::digest(body).as_slice() != digest {
            return Err(Error::Corrupt);
        }
        let mut r = Reader::new(body);
        need(r.take(8)? == MAGIC && r.u32()? == 1)?;
        let original_scanout = r.u32()?;
        if r.take(32)? != witness || witness.iter().all(|v| *v == 0) {
            return Err(Error::WitnessMismatch);
        }
        let profile = r.blob(CAPSET_BYTES)?;
        if profile
            != self
                .capabilities
                .as_ref()
                .ok_or(Error::Unsupported)?
                .to_bytes()
        {
            return Err(Error::ProfileMismatch);
        }
        let two_d_bytes = r.blob(MAX_BYTES)?;
        let control = control(
            r.blob(MAX_CONTROL_BYTES)?,
            self.control3d.as_ref().ok_or(Error::Unsupported)?,
            ram_base,
            ram_len,
        )?;
        let submit = submit(r.blob(128)?)?;
        let scanout = scanout(r.blob(256)?)?;
        r.finish()?;
        let two_d = snapshot::prepare(two_d_bytes).map_err(|_| Error::Invalid)?;
        need(two_d.valid_backing_range(ram_base, ram_len))?;
        let scanout_resource = if original_scanout == NONE_RESOURCE_ID {
            None
        } else {
            Some(original_scanout)
        };
        match scanout.binding.map(|v| (v.rect, v.target)) {
            Some((rect, Scanout3dTarget::Renderer { resource, metadata })) => {
                self.control3d
                    .as_ref()
                    .ok_or(Error::Unsupported)?
                    .checkpoint_sizes(metadata)
                    .map_err(|_| Error::Invalid)?;
                need(
                    scanout_resource.is_none()
                        && resource.id == metadata.resource_id
                        && resource.id != 0
                        && resource.generation > 0
                        && resource.generation < control.next_generation
                        && super::scanout3d::full_rect(rect, metadata, true)
                        && !control
                            .contexts
                            .iter()
                            .any(|c| c.identity.generation == resource.generation)
                        && control.resources.iter().all(|r| {
                            r.identity.generation != resource.generation
                                || (r.identity == resource && r.metadata == metadata)
                        }),
                )?;
            }
            Some((
                rect,
                Scanout3dTarget::TwoD {
                    resource_id,
                    format,
                    width,
                    height,
                },
            )) => {
                need(
                    resource_id != 0
                        && super::protocol::is_supported_format(format)
                        && width > 0
                        && height > 0
                        && width <= super::resources::MAX_RESOURCE_DIMENSION
                        && height <= super::resources::MAX_RESOURCE_DIMENSION
                        && u64::from(width) * u64::from(height) * 4
                            <= super::resources::MAX_RESOURCE_BYTES
                        && rect.x.checked_add(rect.width).is_some_and(|v| v <= width)
                        && rect.y.checked_add(rect.height).is_some_and(|v| v <= height),
                )?;
                if let Some(active) = scanout_resource {
                    let resource = two_d.resources.get(active).ok_or(Error::Invalid)?;
                    need(
                        active == resource_id
                            && resource.format == format
                            && resource.width == width
                            && resource.height == height,
                    )?;
                }
            }
            None | Some((_, Scanout3dTarget::Disabled)) => need(scanout_resource.is_none())?,
        }
        let saved_epoch = control.epoch;
        let restored_epoch = saved_epoch
            .max(
                self.control3d
                    .as_ref()
                    .ok_or(Error::Unsupported)?
                    .snapshot()
                    .epoch,
            )
            .checked_add(1)
            .filter(|v| *v < u64::MAX)
            .ok_or(Error::EpochExhausted)?;
        Ok(PreparedGpuCheckpoint {
            two_d,
            control,
            submit,
            scanout,
            scanout_resource,
            saved_epoch,
            restored_epoch,
        })
    }
    pub(crate) fn commit_gpu_checkpoint(&mut self, prepared: PreparedGpuCheckpoint) {
        let PreparedGpuCheckpoint {
            two_d,
            control,
            submit,
            scanout,
            scanout_resource,
            restored_epoch,
            ..
        } = prepared;
        self.control3d
            .as_mut()
            .expect("prepared production owner")
            .commit_checkpoint(control, restored_epoch);
        self.submit3d
            .as_mut()
            .expect("prepared production owner")
            .commit_checkpoint(submit);
        self.scanout3d
            .as_mut()
            .expect("prepared production owner")
            .commit_checkpoint(scanout);
        snapshot::apply(self, two_d);
        self.scanout_resource = scanout_resource;
    }
}

// Append the authenticated accelerated framing in place. The ordinary resume container remains
// byte-for-byte compatible; only the explicit accelerated API consumes this bounded trailer.
const RESUME_MAGIC: &[u8; 8] = b"WVGRESU1";
const RESUME_TRAILER: usize = 8 + 4 + 8 + 32 + 32;
const MAX_RESUME_BYTES: usize = 2 * 1024 * 1024 * 1024;
pub(crate) fn seal_resume(mut bytes: Vec<u8>, witness: &[u8; 32]) -> Result<Vec<u8>, Error> {
    need(bytes.len() <= MAX_RESUME_BYTES - RESUME_TRAILER && witness.iter().any(|v| *v != 0))?;
    let length = bytes.len() as u64;
    bytes
        .try_reserve_exact(RESUME_TRAILER)
        .map_err(|_| Error::Invalid)?;
    bytes.extend_from_slice(RESUME_MAGIC);
    bytes.extend_from_slice(&1u32.to_le_bytes());
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.extend_from_slice(witness);
    let digest = Sha256::digest(&bytes);
    bytes.extend_from_slice(&digest);
    Ok(bytes)
}
pub(crate) fn open_resume<'a>(bytes: &'a [u8], witness: &[u8; 32]) -> Result<&'a [u8], Error> {
    if bytes.len() < RESUME_TRAILER || bytes.len() > MAX_RESUME_BYTES {
        return Err(Error::Corrupt);
    }
    let payload_len = bytes.len() - RESUME_TRAILER;
    let mut trailer = Reader::new(&bytes[payload_len..]);
    need(
        trailer.take(8)? == RESUME_MAGIC
            && trailer.u32()? == 1
            && trailer.u64()? == payload_len as u64,
    )?;
    if trailer.take(32)? != witness || witness.iter().all(|v| *v == 0) {
        return Err(Error::WitnessMismatch);
    }
    let expected = trailer.take(32)?;
    trailer.finish()?;
    if Sha256::digest(&bytes[..bytes.len() - 32]).as_slice() != expected {
        return Err(Error::Corrupt);
    }
    Ok(&bytes[..payload_len])
}
