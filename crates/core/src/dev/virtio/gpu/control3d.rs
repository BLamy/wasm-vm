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
pub const MAX_DESKTOP_RESOURCES: usize = 64;
pub const MAX_BACKING_ENTRIES: usize = 256;
/// Bounded original Linux page-fragmented lists; private proof profiles stay256.
pub const MAX_PRODUCTION_BACKING_ENTRIES: usize = 16_384;
pub const MAX_RESOURCE_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_GPU_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_BACKING_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_TEXTURE_SIZE: u32 = 16_384;
pub const MAX_TEXTURE_3D_SIZE: u32 = 2_048;
pub const MAX_ARRAY_LAYERS: u32 = 2_048;

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
    #[cfg(test)]
    fn sizes(
        &self,
        desktop: bool,
        dimensional: bool,
        depth: bool,
        stream: bool,
    ) -> Result<(u64, u64), Control3dError> {
        self.sizes_limited(
            desktop,
            dimensional,
            depth,
            stream,
            MAX_RESOURCE_BYTES,
            false,
        )
    }
    /// Bounded resource accounting for the selected host profile.
    fn sizes_limited(
        self,
        desktop_resources: bool,
        dimensional_resources: bool,
        dimensional_depth_resources: bool,
        stream_output_resources: bool,
        resource_limit: u64,
        production: bool,
    ) -> Result<(u64, u64), Control3dError> {
        if self.width == 0
            || self.height == 0
            || (self.nr_samples != 0
                && !(production
                    && self.target == 2
                    && self.last_level == 0
                    && matches!(self.nr_samples, 2 | 4)
                    && self.bind & 3 != 0
                    && self.flags == 0))
            || (self.flags != 0
                && !(production
                    && self.flags == 1
                    && self.target == 2
                    && matches!(self.format, 1 | 2 | 67)))
        {
            return Err(Control3dError::InvalidParameter);
        }
        if dimensional_resources && matches!(self.target, 3 | 4 | 7) {
            if self.format != 67 && !dimensional_depth_resources {
                return Err(Control3dError::InvalidParameter);
            }
            if !production && self.format != 67 && !matches!(self.format, 16 | 18 | 20 | 21 | 126) {
                return Err(Control3dError::InvalidParameter);
            }
            let (public_pixel, gpu_pixel) = self.dimensional_format()?;
            self.dimensional_extent(0)?;
            let (mut bytes, mut gpu_bytes) = (0, 0);
            for level in 0..=self.last_level {
                let (width, height, layers) = self.dimensional_extent(level)?;
                let pixels = u64::from(width) * u64::from(height) * u64::from(layers);
                bytes += pixels * u64::from(public_pixel);
                gpu_bytes += pixels * u64::from(gpu_pixel);
                if bytes > resource_limit || gpu_bytes > resource_limit {
                    return Err(Control3dError::OutOfMemory);
                }
            }
            return Ok((bytes, gpu_bytes));
        }
        if self.depth != 1 || self.array_size != 1 {
            return Err(Control3dError::InvalidParameter);
        }
        let (bytes, staging) = match (self.target, self.format, self.bind) {
            (0, 64, 131_072) if production && self.height == 1 && self.last_level == 0 => {
                (u64::from(self.width), false)
            }
            (0, 64, bind)
                if desktop_resources
                    && self.height == 1
                    && self.last_level == 0
                    && bind & !(if stream_output_resources { 2160 } else { 112 }) == 0 =>
            {
                (u64::from(self.width), false)
            }
            (0, 64, 16 | 32 | 524_288) if self.height == 1 && self.last_level == 0 => {
                (u64::from(self.width), self.bind == 524_288)
            }
            (2, format, bind) if desktop_resources => {
                let (public_pixel, gpu_pixel) = image2d_format(format, bind)?;
                self.mip_extent(0)?;
                let (mut logical, mut gpu) = (0, 0);
                for level in 0..=self.last_level {
                    let (width, height) = self.mip_extent(level)?;
                    let pixels = u64::from(width) * u64::from(height);
                    logical += pixels * u64::from(public_pixel);
                    gpu += pixels * u64::from(gpu_pixel) * u64::from(self.nr_samples.max(1));
                    if logical > resource_limit || gpu > resource_limit {
                        return Err(Control3dError::OutOfMemory);
                    }
                }
                return Ok((logical, gpu));
            }
            (2, 67, 10)
                if self.last_level == 0
                    && self.width <= MAX_TEXTURE_SIZE
                    && self.height <= MAX_TEXTURE_SIZE =>
            {
                (u64::from(self.width) * u64::from(self.height) * 4, false)
            }
            _ => return Err(Control3dError::InvalidParameter),
        };
        if bytes > resource_limit {
            return Err(Control3dError::OutOfMemory);
        }
        Ok((bytes, if staging { 0 } else { bytes }))
    }

    fn mip_extent(self, level: u32) -> Result<(u32, u32), Control3dError> {
        if self.width == 0
            || self.height == 0
            || self.width > MAX_TEXTURE_SIZE
            || self.height > MAX_TEXTURE_SIZE
            || self.last_level > 31 - self.width.max(self.height).leading_zeros()
            || level > self.last_level
        {
            return Err(Control3dError::InvalidParameter);
        }
        // The checked chain above bounds the shift to14. NPOT levels round down
        // independently in each dimension, then remain at1.
        Ok(((self.width >> level).max(1), (self.height >> level).max(1)))
    }

    /// Accepted metadata is immutable; admission chooses its historical or
    /// selected profile. DMA always uses original public bytes, never padding.
    pub(super) fn transfer_extent(
        self,
        level: u32,
    ) -> Result<(u32, u32, u32, u32), Control3dError> {
        if self.nr_samples != 0 {
            return Err(Control3dError::InvalidParameter);
        }
        if self.target == 0 {
            if level != 0 {
                return Err(Control3dError::InvalidParameter);
            }
            return Ok((self.width, self.height, 1, 1));
        }
        if matches!(self.target, 3 | 4 | 7) {
            let (width, height, layers) = self.dimensional_extent(level)?;
            let (public_pixel, _) = self.dimensional_format()?;
            return Ok((width, height, layers, public_pixel));
        }
        let (public_pixel, _) = image2d_format(self.format, self.bind)?;
        let (width, height) = self.mip_extent(level)?;
        Ok((width, height, 1, public_pixel))
    }

    fn dimensional_format(self) -> Result<(u32, u32), Control3dError> {
        if !matches!(self.format, 16 | 18 | 20 | 21 | 126) || matches!(self.target, 4 | 7) {
            image2d_format(self.format, self.bind)
        } else {
            Err(Control3dError::InvalidParameter)
        }
    }

    fn dimensional_extent(self, level: u32) -> Result<(u32, u32, u32), Control3dError> {
        let bad = Control3dError::InvalidParameter;
        self.dimensional_format()?;
        if self.depth == 0 || self.array_size == 0 {
            return Err(bad);
        }
        let size = match self.target {
            3 if self.array_size == 1 && self.depth <= MAX_TEXTURE_3D_SIZE => MAX_TEXTURE_3D_SIZE,
            4 if self.depth == 1 && self.array_size == 6 && self.width == self.height => {
                MAX_TEXTURE_SIZE
            }
            7 if self.depth == 1 && self.array_size <= MAX_ARRAY_LAYERS => MAX_TEXTURE_SIZE,
            _ => return Err(bad),
        };
        let largest =
            self.width
                .max(self.height)
                .max(if self.target == 3 { self.depth } else { 1 });
        if self.width == 0
            || self.height == 0
            || self.width > size
            || self.height > size
            || self.last_level > 31 - largest.leading_zeros()
            || level > self.last_level
        {
            return Err(bad);
        }
        Ok((
            (self.width >> level).max(1),
            (self.height >> level).max(1),
            if self.target == 3 {
                (self.depth >> level).max(1)
            } else {
                self.array_size
            },
        ))
    }
}

#[cfg(test)]
mod production_query_resource_tests {
    use super::*;

    #[test]
    fn original_custom_query_buffers_are_production_only_and_byte_accounted() {
        let buffer = Resource3dMetadata {
            resource_id: 1,
            target: 0,
            format: 64,
            bind: 131_072,
            width: 32,
            height: 1,
            depth: 1,
            array_size: 1,
            last_level: 0,
            nr_samples: 0,
            flags: 0,
        };
        let size = |metadata: Resource3dMetadata, production| {
            metadata.sizes_limited(true, true, true, true, 33_554_432, production)
        };
        assert_eq!(size(buffer, true), Ok((32, 32)));
        assert!(size(buffer, false).is_err());
        for invalid in [
            Resource3dMetadata {
                height: 2,
                ..buffer
            },
            Resource3dMetadata { depth: 2, ..buffer },
            Resource3dMetadata {
                array_size: 2,
                ..buffer
            },
            Resource3dMetadata {
                last_level: 1,
                ..buffer
            },
            Resource3dMetadata {
                nr_samples: 2,
                ..buffer
            },
            Resource3dMetadata { flags: 1, ..buffer },
            Resource3dMetadata {
                bind: 131_088,
                ..buffer
            },
            Resource3dMetadata { width: 0, ..buffer },
            Resource3dMetadata {
                width: 33_554_433,
                ..buffer
            },
        ] {
            assert!(
                size(invalid, true).is_err(),
                "accepted invalid custom query buffer {invalid:?}"
            );
        }
        assert_eq!(
            size(
                Resource3dMetadata {
                    width: 33_554_432,
                    ..buffer
                },
                true
            ),
            Ok((33_554_432, 33_554_432))
        );
    }
}

#[cfg(test)]
mod production_multisample_tests {
    use super::*;

    fn image() -> Resource3dMetadata {
        Resource3dMetadata {
            resource_id: 1,
            target: 2,
            format: 67,
            bind: 2,
            width: 2048,
            height: 1024,
            depth: 1,
            array_size: 1,
            last_level: 0,
            nr_samples: 4,
            flags: 0,
        }
    }

    #[test]
    fn sample_storage_is_bounded_and_cannot_cross_the_old_profile() {
        let image = image();
        let limit = 32 * 1024 * 1024;
        assert_eq!(
            image.sizes_limited(true, true, true, true, limit, true),
            Ok((8 * 1024 * 1024, limit))
        );
        assert_eq!(
            image.sizes_limited(true, true, true, true, limit, false),
            Err(Control3dError::InvalidParameter)
        );
        assert_eq!(
            Resource3dMetadata {
                height: 1025,
                ..image
            }
            .sizes_limited(true, true, true, true, limit, true),
            Err(Control3dError::OutOfMemory)
        );
        for nr_samples in [1, 3, 5, u32::MAX] {
            assert_eq!(
                Resource3dMetadata {
                    nr_samples,
                    ..image
                }
                .sizes_limited(true, true, true, true, limit, true),
                Err(Control3dError::InvalidParameter)
            );
        }
        for metadata in [
            Resource3dMetadata { target: 3, ..image },
            Resource3dMetadata {
                last_level: 1,
                ..image
            },
            Resource3dMetadata { flags: 1, ..image },
            Resource3dMetadata { bind: 8, ..image },
        ] {
            assert_eq!(
                metadata.sizes_limited(true, true, true, true, limit, true),
                Err(Control3dError::InvalidParameter)
            );
        }
        assert_eq!(
            image.transfer_extent(0),
            Err(Control3dError::InvalidParameter)
        );
        assert_eq!(
            Resource3dMetadata {
                format: 16,
                bind: 1,
                ..image
            }
            .sizes_limited(true, true, true, true, limit, true),
            Ok((4 * 1024 * 1024, 16 * 1024 * 1024))
        );
    }
}

/// Finite layouts already qualified by the selected desktop host. The second
/// cost includes RGB padding and126's owned depth/stencil conversion storage.
fn image2d_format(format: u32, bind: u32) -> Result<(u32, u32), Control3dError> {
    let costs = match format {
        64 | 74 => (1, 1),
        5 | 6 | 7 | 16 | 65 | 75 | 91 | 122 | 135 | 319 | 320 | 321 | 407 | 409 => (2, 2),
        66 | 317 => (3, 3),
        76 | 97 | 387 => (3, 4),
        4 | 68 | 134 => (4, 3),
        1
        | 2
        | 3
        | 8
        | 18
        | 20
        | 21
        | 28
        | 67
        | 77
        | 92
        | 98..=104
        | 121
        | 124
        | 125
        | 131
        | 225
        | 230
        | 233
        | 253
        | 308 => (4, 4),
        93 => (6, 8),
        29 | 94 => (8, 8),
        30 => (12, 16),
        31 => (16, 16),
        126 => (8, 16),
        177..=200 => {
            let bytes = 1 << ((format - 177) / 8);
            let components = (format - 177) % 4 + 1;
            (
                bytes * components,
                bytes * if components == 3 { 4 } else { components },
            )
        }
        _ => return Err(Control3dError::InvalidParameter),
    };
    let color_mask = 10 | (1 << 18) | (1 << 20);
    let supported = match format {
        16 | 18 | 20 | 21 | 126 => matches!(bind, 1 | 8 | 9),
        74..=77 => bind & 10 == 8 && bind & !color_mask == 0,
        125 => bind == 8,
        _ => bind & 10 != 0 && bind & !color_mask == 0,
    };
    if !supported {
        return Err(Control3dError::InvalidParameter);
    }
    Ok(costs)
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
    desktop_resources: bool,
    dimensional_resources: bool,
    dimensional_depth_resources: bool,
    stream_output_resources: bool,
    production_limits: bool,
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
        Self::with_resource_profile(sink, false, false, false, false)
    }
    pub(crate) fn new_standard_desktop(sink: Box<dyn Control3dSink>) -> Self {
        Self::with_resource_profile(sink, true, false, false, false)
    }
    pub(crate) fn new_standard_dimensional(sink: Box<dyn Control3dSink>) -> Self {
        Self::with_resource_profile(sink, true, true, false, false)
    }
    pub(crate) fn new_standard_dimensional_depth(sink: Box<dyn Control3dSink>) -> Self {
        Self::with_resource_profile(sink, true, true, true, false)
    }
    pub(crate) fn new_standard_stream_output(sink: Box<dyn Control3dSink>) -> Self {
        Self::with_resource_profile(sink, true, true, true, true)
    }
    pub(crate) fn new_production(sink: Box<dyn Control3dSink>) -> Self {
        let mut state = Self::with_resource_profile(sink, true, true, true, true);
        state.production_limits = true;
        state
    }
    fn backing_entries_limit(&self) -> usize {
        if self.production_limits {
            MAX_PRODUCTION_BACKING_ENTRIES
        } else {
            MAX_BACKING_ENTRIES
        }
    }
    fn resource_limit(&self) -> u64 {
        if self.production_limits {
            32 * 1024 * 1024
        } else {
            MAX_RESOURCE_BYTES
        }
    }
    fn gpu_limit(&self) -> u64 {
        if self.production_limits {
            128 * 1024 * 1024
        } else {
            MAX_GPU_BYTES
        }
    }
    fn backing_limit(&self) -> u64 {
        if self.production_limits {
            128 * 1024 * 1024
        } else {
            MAX_BACKING_BYTES
        }
    }
    fn with_resource_profile(
        sink: Box<dyn Control3dSink>,
        desktop_resources: bool,
        dimensional_resources: bool,
        dimensional_depth_resources: bool,
        stream_output_resources: bool,
    ) -> Self {
        Self {
            sink,
            desktop_resources,
            dimensional_resources,
            dimensional_depth_resources,
            stream_output_resources,
            production_limits: false,
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
            p::CMD_RESOURCE_CREATE_3D | p::CMD_RESOURCE_CREATE_2D => {
                let bytes = if header.ty == p::CMD_RESOURCE_CREATE_2D && self.production_limits {
                    let original = fixed::<40>(chain, bus)?;
                    let mut converted = [0u8; p::RESOURCE_CREATE_3D_SIZE];
                    for (at, value) in [
                        (24, word(&original, 24)),
                        (28, 2),
                        (32, word(&original, 28)),
                        (36, 2),
                        (40, word(&original, 32)),
                        (44, word(&original, 36)),
                        (48, 1),
                        (52, 1),
                        (64, 1),
                    ] {
                        converted[at..at + 4].copy_from_slice(&value.to_le_bytes());
                    }
                    converted
                } else {
                    fixed::<{ p::RESOURCE_CREATE_3D_SIZE }>(chain, bus)?
                };
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
                    || (two_d.get(metadata.resource_id).is_some()
                        && !(self.production_limits && header.ty == p::CMD_RESOURCE_CREATE_2D))
                {
                    return Err(Control3dError::InvalidResourceId);
                }
                let (logical, gpu) = metadata.sizes_limited(
                    self.desktop_resources,
                    self.dimensional_resources,
                    self.dimensional_depth_resources,
                    self.stream_output_resources,
                    self.resource_limit(),
                    self.production_limits,
                )?;
                let max_resources = if self.desktop_resources {
                    MAX_DESKTOP_RESOURCES
                } else {
                    MAX_RESOURCES
                };
                if self.resources.len() >= max_resources || gpu > self.gpu_limit() - self.gpu_bytes
                {
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
                    let (logical, gpu) = self.resources[index].metadata.sizes_limited(
                        self.desktop_resources,
                        self.dimensional_resources,
                        self.dimensional_depth_resources,
                        self.stream_output_resources,
                        self.resource_limit(),
                        self.production_limits,
                    )?;
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
            || count > self.backing_entries_limit()
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
            if total > self.resource_limit() || total > self.backing_limit() - self.backing_bytes {
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

#[cfg(test)]
#[path = "control3d_dimensional_depth_tests.rs"]
mod dimensional_depth_tests;

#[cfg(test)]
#[path = "control3d_stream_output_tests.rs"]
mod stream_output_tests;
