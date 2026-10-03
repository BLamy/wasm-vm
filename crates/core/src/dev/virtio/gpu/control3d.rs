//! Synchronous, proof-only virtio 3D control ownership. No renderer commands or asynchronous completion.
//!
//! Guest addresses remain transport metadata. Attach events copy initial bytes;
//! these copies are not authoritative for future DMA. A sink's ordinary error
//! promises failure atomicity. An unexpected host failure must return
//! `BridgePoisoned`, preventing further control work until an explicit reset.

use alloc::{boxed::Box, string::String, vec::Vec};
use sha2::{Digest, Sha256};

use super::{protocol as p, read_readable_at, readable_len, resources::ResourceMap};
use crate::{bus::Bus, dev::virtio::queue::DescriptorChain, mmio::SystemBus};

pub const MAX_CONTEXTS: usize = 8;
pub const MAX_RESOURCES: usize = 16;
pub const MAX_BACKING_ENTRIES: usize = 256;
pub const MAX_RESOURCE_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_GPU_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_BACKING_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_TEXTURE_SIZE: u32 = 16_384;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Control3dId {
    pub id: u32,
    pub generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resource3dMetadata {
    pub resource_id: u32,
    pub target: u32,
    pub format: u32,
    pub bind: u32,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub array_size: u32,
    pub last_level: u32,
    pub nr_samples: u32,
    pub flags: u32,
}

impl Resource3dMetadata {
    /// Same bounded resource classes as the verified renderer; no GL dependency.
    fn sizes(self) -> Result<(u64, u64), Control3dError> {
        if self.width == 0
            || self.height == 0
            || self.depth != 1
            || self.array_size != 1
            || self.last_level != 0
            || self.nr_samples != 0
            || self.flags != 0
        {
            return Err(Control3dError::InvalidParameter);
        }
        let (bytes, staging) = match (self.target, self.format, self.bind) {
            (0, 64, 16 | 32 | 524_288) if self.height == 1 => {
                (u64::from(self.width), self.bind == 524_288)
            }
            (2, 67, 10) if self.width <= MAX_TEXTURE_SIZE && self.height <= MAX_TEXTURE_SIZE => {
                (u64::from(self.width) * u64::from(self.height) * 4, false)
            }
            _ => return Err(Control3dError::InvalidParameter),
        };
        if bytes > MAX_RESOURCE_BYTES {
            return Err(Control3dError::OutOfMemory);
        }
        Ok((bytes, if staging { 0 } else { bytes }))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackingEntry {
    pub addr: u64,
    pub length: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackingSegment {
    pub addr: u64,
    pub length: u32,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Control3dOperation {
    CreateContext {
        context: Control3dId,
        debug_name: Vec<u8>,
    },
    DestroyContext {
        context: Control3dId,
    },
    CreateResource {
        resource: Control3dId,
        metadata: Resource3dMetadata,
    },
    AttachResource {
        context: Control3dId,
        resource: Control3dId,
    },
    DetachResource {
        context: Control3dId,
        resource: Control3dId,
    },
    AttachBacking {
        resource: Control3dId,
        segments: Vec<BackingSegment>,
        backing_generation: u64,
    },
    DetachBacking {
        resource: Control3dId,
        backing_generation: u64,
    },
    UnrefResource {
        resource: Control3dId,
    },
    Reset,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Control3dEvent {
    pub epoch: u64,
    pub operation: Control3dOperation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Control3dError {
    InvalidContextId,
    InvalidResourceId,
    InvalidParameter,
    OutOfMemory,
    Unspecified,
    BridgePoisoned,
}

impl Control3dError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidContextId => "invalid-context-id",
            Self::InvalidResourceId => "invalid-resource-id",
            Self::InvalidParameter => "invalid-parameter",
            Self::OutOfMemory => "out-of-memory",
            Self::Unspecified => "unspecified",
            Self::BridgePoisoned => "bridge-poisoned",
        }
    }
    pub const fn response_type(self) -> u32 {
        match self {
            Self::InvalidContextId => p::RESP_ERR_INVALID_CONTEXT_ID,
            Self::InvalidResourceId => p::RESP_ERR_INVALID_RESOURCE_ID,
            Self::InvalidParameter => p::RESP_ERR_INVALID_PARAMETER,
            Self::OutOfMemory => p::RESP_ERR_OUT_OF_MEMORY,
            Self::Unspecified | Self::BridgePoisoned => p::RESP_ERR_UNSPEC,
        }
    }
}

/// Trusted host boundary: success means the synchronous operation completed.
/// Ordinary errors must not mutate host ownership; uncertain outcomes poison.
pub trait Control3dSink {
    fn apply(&mut self, event: &Control3dEvent) -> Result<(), Control3dError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Context3dSnapshot {
    pub identity: Control3dId,
    pub debug_name: Vec<u8>,
    pub resources: Vec<Control3dId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resource3dSnapshot {
    pub identity: Control3dId,
    pub metadata: Resource3dMetadata,
    pub backing: Option<Vec<BackingEntry>>,
    pub backing_generation: Option<u64>,
}

/// Transport diagnostics only. Retired renderer leases remain renderer-owned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Control3dSnapshot {
    pub epoch: u64,
    pub next_generation: u64,
    pub next_backing_generation: u64,
    pub poisoned: bool,
    pub contexts: Vec<Context3dSnapshot>,
    pub resources: Vec<Resource3dSnapshot>,
    pub logical_bytes: u64,
    pub gpu_bytes: u64,
    pub backing_bytes: u64,
}

impl Control3dSnapshot {
    /// Versioned little-endian diagnostic encoding, independent of host layout.
    pub fn canonical_bytes(&self) -> Vec<u8> {
        fn id(out: &mut Vec<u8>, value: Control3dId) {
            out.extend_from_slice(&value.id.to_le_bytes());
            out.extend_from_slice(&value.generation.to_le_bytes());
        }
        let mut out = Vec::new();
        out.extend_from_slice(b"WV3DCTL2");
        for value in [
            self.epoch,
            self.next_generation,
            self.next_backing_generation,
            self.logical_bytes,
            self.gpu_bytes,
            self.backing_bytes,
        ] {
            out.extend_from_slice(&value.to_le_bytes());
        }
        out.push(u8::from(self.poisoned));
        out.extend_from_slice(&(self.contexts.len() as u32).to_le_bytes());
        for context in &self.contexts {
            id(&mut out, context.identity);
            out.extend_from_slice(&(context.debug_name.len() as u32).to_le_bytes());
            out.extend_from_slice(&context.debug_name);
            out.extend_from_slice(&(context.resources.len() as u32).to_le_bytes());
            for resource in &context.resources {
                id(&mut out, *resource);
            }
        }
        out.extend_from_slice(&(self.resources.len() as u32).to_le_bytes());
        for resource in &self.resources {
            id(&mut out, resource.identity);
            let m = resource.metadata;
            for value in [
                m.resource_id,
                m.target,
                m.format,
                m.bind,
                m.width,
                m.height,
                m.depth,
                m.array_size,
                m.last_level,
                m.nr_samples,
                m.flags,
            ] {
                out.extend_from_slice(&value.to_le_bytes());
            }
            out.push(u8::from(resource.backing.is_some()));
            if let Some(entries) = &resource.backing {
                out.extend_from_slice(
                    &resource
                        .backing_generation
                        .expect("attached backing generation")
                        .to_le_bytes(),
                );
                out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
                for entry in entries {
                    out.extend_from_slice(&entry.addr.to_le_bytes());
                    out.extend_from_slice(&entry.length.to_le_bytes());
                }
            }
        }
        out
    }
    pub fn hex_digest(&self) -> String {
        use core::fmt::Write;
        let mut out = String::with_capacity(64);
        for byte in Sha256::digest(self.canonical_bytes()) {
            let _ = write!(&mut out, "{byte:02x}");
        }
        out
    }
}

pub(crate) struct Control3dState {
    sink: Box<dyn Control3dSink>,
    epoch: u64,
    next_generation: u64,
    next_backing_generation: u64,
    poisoned: bool,
    contexts: Vec<Context3dSnapshot>,
    resources: Vec<Resource3dSnapshot>,
    logical_bytes: u64,
    gpu_bytes: u64,
    backing_bytes: u64,
}

impl Control3dState {
    pub(crate) fn new(sink: Box<dyn Control3dSink>) -> Self {
        Self {
            sink,
            epoch: 1,
            next_generation: 1,
            next_backing_generation: 1,
            poisoned: false,
            contexts: Vec::new(),
            resources: Vec::new(),
            logical_bytes: 0,
            gpu_bytes: 0,
            backing_bytes: 0,
        }
    }
    pub(crate) fn contains(&self, id: u32) -> bool {
        self.resources.iter().any(|r| r.identity.id == id)
    }
    pub(crate) fn snapshot(&self) -> Control3dSnapshot {
        let mut contexts = self.contexts.clone();
        contexts.sort_by_key(|c| c.identity.id);
        for c in &mut contexts {
            c.resources.sort_by_key(|r| r.id);
        }
        let mut resources = self.resources.clone();
        resources.sort_by_key(|r| r.identity.id);
        Control3dSnapshot {
            epoch: self.epoch,
            next_generation: self.next_generation,
            next_backing_generation: self.next_backing_generation,
            poisoned: self.poisoned,
            contexts,
            resources,
            logical_bytes: self.logical_bytes,
            gpu_bytes: self.gpu_bytes,
            backing_bytes: self.backing_bytes,
        }
    }
    pub(crate) fn poison(&mut self) {
        self.poisoned = true;
    }
    fn send(&mut self, operation: Control3dOperation) -> Result<(), Control3dError> {
        let result = self.sink.apply(&Control3dEvent {
            epoch: self.epoch,
            operation,
        });
        if result == Err(Control3dError::BridgePoisoned) {
            self.poisoned = true;
        }
        result
    }
    pub(crate) fn reset(&mut self) {
        self.contexts.clear();
        self.resources.clear();
        self.logical_bytes = 0;
        self.gpu_bytes = 0;
        self.backing_bytes = 0;
        self.poisoned = true;
        if let Some(next) = self.epoch.checked_add(1) {
            self.epoch = next;
            if self.send(Control3dOperation::Reset).is_ok() {
                self.poisoned = false;
            }
        }
    }
    fn identity(&self, id: u32) -> Result<Control3dId, Control3dError> {
        self.next_generation
            .checked_add(1)
            .ok_or(Control3dError::OutOfMemory)?;
        Ok(Control3dId {
            id,
            generation: self.next_generation,
        })
    }
    fn context_index(&self, id: u32) -> Result<usize, Control3dError> {
        self.contexts
            .iter()
            .position(|c| c.identity.id == id)
            .ok_or(Control3dError::InvalidContextId)
    }
    fn resource_index(&self, id: u32) -> Result<usize, Control3dError> {
        self.resources
            .iter()
            .position(|r| r.identity.id == id)
            .ok_or(Control3dError::InvalidResourceId)
    }
    pub(crate) fn execute(
        &mut self,
        chain: &DescriptorChain,
        bus: &mut SystemBus,
        header: p::CtrlHeader,
        negotiated: bool,
        two_d: &ResourceMap,
    ) -> Result<(), Control3dError> {
        // Queue validation covers every span, but the new mutation boundary also requires
        // a complete response header. Existing 2D truncated-response behavior is unchanged.
        if chain.writable_len() < p::CTRL_HDR_SIZE as u64
            || chain
                .writable()
                .any(|s| !bus.ram().ram_contains(s.addr, u64::from(s.len)))
        {
            return Err(Control3dError::InvalidParameter);
        }
        if !negotiated {
            return Err(Control3dError::Unspecified);
        }
        if self.poisoned {
            return Err(Control3dError::BridgePoisoned);
        }
        if header.flags & !p::FLAG_FENCE != 0 || header.ring_idx != 0 || header.padding != [0; 3] {
            return Err(Control3dError::InvalidParameter);
        }
        let context_command = matches!(
            header.ty,
            p::CMD_CTX_CREATE
                | p::CMD_CTX_DESTROY
                | p::CMD_CTX_ATTACH_RESOURCE
                | p::CMD_CTX_DETACH_RESOURCE
        );
        if context_command && header.ctx_id == 0 {
            return Err(Control3dError::InvalidContextId);
        }
        if !context_command && header.ctx_id != 0 {
            return Err(Control3dError::InvalidParameter);
        }
        match header.ty {
            p::CMD_CTX_CREATE => {
                let bytes = fixed::<{ p::CTX_CREATE_SIZE }>(chain, bus)?;
                let len = word(&bytes, 24) as usize;
                if len > 64 || word(&bytes, 28) != 0 {
                    return Err(Control3dError::InvalidParameter);
                }
                if self.contexts.iter().any(|c| c.identity.id == header.ctx_id) {
                    return Err(Control3dError::InvalidContextId);
                }
                if self.contexts.len() >= MAX_CONTEXTS {
                    return Err(Control3dError::OutOfMemory);
                }
                self.contexts
                    .try_reserve(1)
                    .map_err(|_| Control3dError::OutOfMemory)?;
                let context = self.identity(header.ctx_id)?;
                let mut debug_name = Vec::new();
                debug_name
                    .try_reserve_exact(len)
                    .map_err(|_| Control3dError::OutOfMemory)?;
                debug_name.extend_from_slice(&bytes[32..32 + len]);
                // Allocate both copies before asking the host to create anything.
                let mut name_for_host = Vec::new();
                name_for_host
                    .try_reserve_exact(len)
                    .map_err(|_| Control3dError::OutOfMemory)?;
                name_for_host.extend_from_slice(&debug_name);
                self.send(Control3dOperation::CreateContext {
                    context,
                    debug_name: name_for_host,
                })?;
                self.contexts.push(Context3dSnapshot {
                    identity: context,
                    debug_name,
                    resources: Vec::new(),
                });
                self.next_generation += 1;
            }
            p::CMD_CTX_DESTROY => {
                fixed::<{ p::CTX_DESTROY_SIZE }>(chain, bus)?;
                let index = self.context_index(header.ctx_id)?;
                self.send(Control3dOperation::DestroyContext {
                    context: self.contexts[index].identity,
                })?;
                self.contexts.remove(index);
            }
            p::CMD_CTX_ATTACH_RESOURCE | p::CMD_CTX_DETACH_RESOURCE => {
                let bytes = fixed::<{ p::CTX_RESOURCE_SIZE }>(chain, bus)?;
                if word(&bytes, 28) != 0 {
                    return Err(Control3dError::InvalidParameter);
                }
                let ci = self.context_index(header.ctx_id)?;
                let ri = self.resource_index(word(&bytes, 24))?;
                let context = self.contexts[ci].identity;
                let resource = self.resources[ri].identity;
                let attached = self.contexts[ci]
                    .resources
                    .iter()
                    .position(|r| *r == resource);
                if header.ty == p::CMD_CTX_ATTACH_RESOURCE {
                    if attached.is_some() {
                        return Err(Control3dError::InvalidParameter);
                    }
                    self.contexts[ci]
                        .resources
                        .try_reserve(1)
                        .map_err(|_| Control3dError::OutOfMemory)?;
                    self.send(Control3dOperation::AttachResource { context, resource })?;
                    self.contexts[ci].resources.push(resource);
                } else {
                    let index = attached.ok_or(Control3dError::InvalidParameter)?;
                    self.send(Control3dOperation::DetachResource { context, resource })?;
                    self.contexts[ci].resources.remove(index);
                }
            }
            p::CMD_RESOURCE_CREATE_3D => {
                let bytes = fixed::<{ p::RESOURCE_CREATE_3D_SIZE }>(chain, bus)?;
                if word(&bytes, 68) != 0 {
                    return Err(Control3dError::InvalidParameter);
                }
                let metadata = Resource3dMetadata {
                    resource_id: word(&bytes, 24),
                    target: word(&bytes, 28),
                    format: word(&bytes, 32),
                    bind: word(&bytes, 36),
                    width: word(&bytes, 40),
                    height: word(&bytes, 44),
                    depth: word(&bytes, 48),
                    array_size: word(&bytes, 52),
                    last_level: word(&bytes, 56),
                    nr_samples: word(&bytes, 60),
                    flags: word(&bytes, 64),
                };
                if metadata.resource_id == 0
                    || self.contains(metadata.resource_id)
                    || two_d.get(metadata.resource_id).is_some()
                {
                    return Err(Control3dError::InvalidResourceId);
                }
                let (logical, gpu) = metadata.sizes()?;
                if self.resources.len() >= MAX_RESOURCES || gpu > MAX_GPU_BYTES - self.gpu_bytes {
                    return Err(Control3dError::OutOfMemory);
                }
                self.resources
                    .try_reserve(1)
                    .map_err(|_| Control3dError::OutOfMemory)?;
                let resource = self.identity(metadata.resource_id)?;
                self.send(Control3dOperation::CreateResource { resource, metadata })?;
                self.resources.push(Resource3dSnapshot {
                    identity: resource,
                    metadata,
                    backing: None,
                    backing_generation: None,
                });
                self.next_generation += 1;
                self.logical_bytes += logical;
                self.gpu_bytes += gpu;
            }
            p::CMD_RESOURCE_ATTACH_BACKING => self.attach_backing(chain, bus)?,
            p::CMD_RESOURCE_DETACH_BACKING | p::CMD_RESOURCE_UNREF => {
                let bytes = fixed::<32>(chain, bus)?;
                if word(&bytes, 28) != 0 {
                    return Err(Control3dError::InvalidParameter);
                }
                let index = self.resource_index(word(&bytes, 24))?;
                let resource = self.resources[index].identity;
                let backing_bytes = self.resources[index].backing.as_ref().map_or(0, |entries| {
                    entries.iter().map(|e| u64::from(e.length)).sum()
                });
                if header.ty == p::CMD_RESOURCE_DETACH_BACKING {
                    if self.resources[index].backing.is_none() {
                        return Err(Control3dError::InvalidParameter);
                    }
                    self.send(Control3dOperation::DetachBacking {
                        resource,
                        backing_generation: self.resources[index]
                            .backing_generation
                            .expect("attached generation"),
                    })?;
                    self.resources[index].backing = None;
                    self.resources[index].backing_generation = None;
                } else {
                    let (logical, gpu) = self.resources[index].metadata.sizes()?;
                    self.send(Control3dOperation::UnrefResource { resource })?;
                    self.resources.remove(index);
                    for context in &mut self.contexts {
                        context.resources.retain(|r| *r != resource);
                    }
                    self.logical_bytes -= logical;
                    self.gpu_bytes -= gpu;
                }
                self.backing_bytes -= backing_bytes;
            }
            _ => return Err(Control3dError::Unspecified),
        }
        Ok(())
    }
    fn attach_backing(
        &mut self,
        chain: &DescriptorChain,
        bus: &mut SystemBus,
    ) -> Result<(), Control3dError> {
        let bytes =
            read_readable_at::<32>(chain, bus, 0).ok_or(Control3dError::InvalidParameter)?;
        let index = self.resource_index(word(&bytes, 24))?;
        if self.resources[index].backing.is_some() {
            return Err(Control3dError::InvalidParameter);
        }
        self.next_backing_generation
            .checked_add(1)
            .ok_or(Control3dError::OutOfMemory)?;
        let count = word(&bytes, 28) as usize;
        if count == 0
            || count > MAX_BACKING_ENTRIES
            || readable_len(chain) != Some(32 + count as u64 * 16)
        {
            return Err(Control3dError::InvalidParameter);
        }
        let mut entries = Vec::new();
        entries
            .try_reserve_exact(count)
            .map_err(|_| Control3dError::OutOfMemory)?;
        let mut total = 0u64;
        for i in 0..count {
            let bytes = read_readable_at::<16>(chain, bus, 32 + i as u64 * 16)
                .ok_or(Control3dError::InvalidParameter)?;
            let addr = u64::from_le_bytes(bytes[..8].try_into().expect("fixed entry address"));
            let length = word(&bytes, 8);
            if word(&bytes, 12) != 0
                || length == 0
                || !bus.ram().ram_contains(addr, u64::from(length))
            {
                return Err(Control3dError::InvalidParameter);
            }
            total += u64::from(length);
            if total > MAX_RESOURCE_BYTES || total > MAX_BACKING_BYTES - self.backing_bytes {
                return Err(Control3dError::OutOfMemory);
            }
            entries.push(BackingEntry { addr, length });
        }
        // All ranges and budgets precede data reads. The event owns its initial copy;
        // only exact u64 RAM metadata is retained after synchronous completion.
        let mut segments = Vec::new();
        segments
            .try_reserve_exact(count)
            .map_err(|_| Control3dError::OutOfMemory)?;
        for entry in &entries {
            let mut bytes = Vec::new();
            bytes
                .try_reserve_exact(entry.length as usize)
                .map_err(|_| Control3dError::OutOfMemory)?;
            bytes.resize(entry.length as usize, 0);
            bus.ram()
                .read_slice(entry.addr, &mut bytes)
                .map_err(|_| Control3dError::InvalidParameter)?;
            segments.push(BackingSegment {
                addr: entry.addr,
                length: entry.length,
                bytes,
            });
        }
        self.send(Control3dOperation::AttachBacking {
            resource: self.resources[index].identity,
            segments,
            backing_generation: self.next_backing_generation,
        })?;
        self.resources[index].backing = Some(entries);
        self.resources[index].backing_generation = Some(self.next_backing_generation);
        self.next_backing_generation += 1;
        self.backing_bytes += total;
        Ok(())
    }
}

fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("fixed protocol field"),
    )
}
fn fixed<const N: usize>(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
) -> Result<[u8; N], Control3dError> {
    if readable_len(chain) != Some(N as u64) {
        return Err(Control3dError::InvalidParameter);
    }
    read_readable_at::<N>(chain, bus, 0).ok_or(Control3dError::InvalidParameter)
}
