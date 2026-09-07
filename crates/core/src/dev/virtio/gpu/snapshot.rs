//! E5-T26b: virtio-GPU resource/shadow/scanout snapshot codec.
//!
//! The decoder constructs a complete detached [`ResourceMap`] and validates every scanout/cursor
//! reference before replacing live [`GpuState`] fields.  A valid restore then publishes exactly one
//! full scanout repair frame through the existing sink; a failed restore cannot clear or partially
//! replace the old scanout.

use alloc::{collections::BTreeSet, vec::Vec};

use super::damage::MAX_RECTS;
use super::edid::MAX_EDID_DIMENSION;
use super::resources::{
    self, ResourceMap, ResourceSnapshot, ResourceSnapshotError, ShadowCodecError,
};
use super::{CursorState, DEFAULT_NUM_SCANOUTS, GpuState};
use crate::dev::virtio::gpu::protocol;

/// Payload magic for the GPU component section.  The outer desktop envelope carries the component
/// version; this inner magic/version protects callers that persist the GPU payload independently.
pub const GPU_SNAPSHOT_MAGIC: [u8; 8] = *b"WVGPU001";
/// Current GPU payload version.
pub const GPU_SNAPSHOT_VERSION: u16 = 1;

const HEADER_LEN: usize = 52;
const RESOURCE_HEADER_LEN: usize = 44;
const CURSOR_LEN: usize = 7 * 4;
const NONE_RESOURCE: u32 = u32::MAX;
const MAX_SNAPSHOT_RESOURCES: u32 = 1 << 20;

/// A GPU snapshot rejection.  All variants have stable [`Self::code`] values for host logs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GpuSnapshotError {
    Truncated,
    BadMagic,
    UnsupportedVersion {
        found: u16,
        supported: u16,
    },
    ReservedFlags {
        found: u16,
    },
    InvalidBoolean {
        field: &'static str,
    },
    InvalidDisplayDimensions {
        width: u32,
        height: u32,
    },
    InvalidRefreshRate {
        refresh_hz: u32,
    },
    TooManyResources {
        found: u32,
        maximum: u32,
    },
    DuplicateResourceId {
        resource_id: u32,
    },
    Resource {
        resource_id: u32,
        reason: ResourceSnapshotError,
    },
    Shadow {
        resource_id: u32,
        reason: ShadowCodecError,
    },
    MissingResource {
        resource_id: u32,
        binding: &'static str,
    },
    IncompatibleFormat {
        resource_id: u32,
        format: u32,
    },
    InvalidCursorScanout {
        scanout_id: u32,
    },
    InvalidCursorHotspot {
        scanout_id: u32,
    },
    InvalidCursorResource {
        scanout_id: u32,
        resource_id: u32,
    },
    InvalidCursorPadding {
        scanout_id: u32,
    },
    InvalidScanoutResource {
        resource_id: u32,
    },
    InvalidCount,
    LengthOverflow,
    TrailingBytes,
    OutOfMemory,
}

impl GpuSnapshotError {
    /// Stable, machine-readable error code.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Truncated => "truncated",
            Self::BadMagic => "bad_magic",
            Self::UnsupportedVersion { .. } => "unsupported_version",
            Self::ReservedFlags { .. } => "reserved_flags",
            Self::InvalidBoolean { .. } => "invalid_boolean",
            Self::InvalidDisplayDimensions { .. } => "invalid_display_dimensions",
            Self::InvalidRefreshRate { .. } => "invalid_refresh_rate",
            Self::TooManyResources { .. } => "too_many_resources",
            Self::DuplicateResourceId { .. } => "duplicate_resource_id",
            Self::Resource { .. } => "invalid_resource",
            Self::Shadow { .. } => "invalid_shadow",
            Self::MissingResource { .. } => "missing_resource",
            Self::IncompatibleFormat { .. } => "incompatible_format",
            Self::InvalidCursorScanout { .. } => "invalid_cursor_scanout",
            Self::InvalidCursorHotspot { .. } => "invalid_cursor_hotspot",
            Self::InvalidCursorResource { .. } => "invalid_cursor_resource",
            Self::InvalidCursorPadding { .. } => "invalid_cursor_padding",
            Self::InvalidScanoutResource { .. } => "invalid_scanout_resource",
            Self::InvalidCount => "invalid_count",
            Self::LengthOverflow => "length_overflow",
            Self::TrailingBytes => "trailing_bytes",
            Self::OutOfMemory => "out_of_memory",
        }
    }
}

/// Encode the complete host-owned GPU state in deterministic resource-id order.
pub(crate) fn encode(state: &GpuState) -> Result<Vec<u8>, GpuSnapshotError> {
    let records = state.resources.snapshot_records();
    let resource_count =
        u32::try_from(records.len()).map_err(|_| GpuSnapshotError::InvalidCount)?;
    let scanout_resource = state.scanout_resource.unwrap_or(NONE_RESOURCE);
    let mut out = Vec::new();
    reserve(&mut out, HEADER_LEN)?;
    out.extend_from_slice(&GPU_SNAPSHOT_MAGIC);
    out.extend_from_slice(&GPU_SNAPSHOT_VERSION.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    push_u32(&mut out, resource_count);
    push_u32(&mut out, state.display_width);
    push_u32(&mut out, state.display_height);
    push_u32(&mut out, state.display_refresh_hz);
    push_u32(&mut out, state.events_read);
    out.push(u8::from(state.config_irq_pending));
    out.extend_from_slice(&[0u8; 3]);
    push_u32(&mut out, scanout_resource);
    push_u32(&mut out, DEFAULT_NUM_SCANOUTS);
    push_u64(&mut out, state.commands_served);

    for (resource_id, record) in records {
        let shadow = resources::compress_shadow(&record.pixels).map_err(|reason| {
            GpuSnapshotError::Shadow {
                resource_id,
                reason,
            }
        })?;
        push_resource_header(&mut out, resource_id, &record, shadow.bytes.len())?;
        for &(address, length) in &record.backing {
            push_u64(&mut out, address);
            push_u32(&mut out, length);
        }
        for rect in &record.pending_damage {
            push_rect(&mut out, *rect);
        }
        for word in &record.dirty_bits {
            push_u64(&mut out, *word);
        }
        out.extend_from_slice(&shadow.bytes);
    }
    for cursor in state.cursor_states {
        push_cursor(&mut out, cursor);
    }
    Ok(out)
}

fn push_resource_header(
    out: &mut Vec<u8>,
    resource_id: u32,
    record: &ResourceSnapshot,
    shadow_len: usize,
) -> Result<(), GpuSnapshotError> {
    let backing_count = u32_len(record.backing.len())?;
    let damage_count = u32_len(record.pending_damage.len())?;
    let dirty_word_count = u32_len(record.dirty_bits.len())?;
    let shadow_len = u32_len(shadow_len)?;
    reserve(out, RESOURCE_HEADER_LEN)?;
    push_u32(out, resource_id);
    push_u32(out, record.format);
    push_u32(out, record.width);
    push_u32(out, record.height);
    out.push(u8::from(record.presented));
    out.extend_from_slice(&[0u8; 3]);
    push_u32(out, backing_count);
    push_u32(out, damage_count);
    out.push(u8::from(record.pending_damage_collapsed));
    out.extend_from_slice(&[0u8; 3]);
    push_u32(out, dirty_word_count);
    push_u32(out, record.dirty_count);
    push_u32(out, shadow_len);
    Ok(())
}

/// Decode into a detached map, validate every binding, and only then replace live state.
pub(crate) fn restore(state: &mut GpuState, bytes: &[u8]) -> Result<(), GpuSnapshotError> {
    let parsed = parse(bytes)?;
    let resources = ResourceMap::from_snapshot_records(&parsed.records).map_err(|reason| {
        let resource_id = resource_id_from_reason(reason);
        GpuSnapshotError::Resource {
            resource_id,
            reason,
        }
    })?;

    let scanout_resource = if parsed.scanout_resource == NONE_RESOURCE {
        None
    } else {
        let id = parsed.scanout_resource;
        let resource = resources.get(id).ok_or(GpuSnapshotError::MissingResource {
            resource_id: id,
            binding: "scanout",
        })?;
        if !protocol::is_supported_format(resource.format) {
            return Err(GpuSnapshotError::IncompatibleFormat {
                resource_id: id,
                format: resource.format,
            });
        }
        Some(id)
    };

    let mut cursor_states = [CursorState::hidden(0); DEFAULT_NUM_SCANOUTS as usize];
    for (index, cursor) in parsed.cursors.into_iter().enumerate() {
        let scanout_id = index as u32;
        if cursor.pos.scanout_id != scanout_id {
            return Err(GpuSnapshotError::InvalidCursorScanout { scanout_id });
        }
        if cursor.pos.padding != 0 {
            return Err(GpuSnapshotError::InvalidCursorPadding { scanout_id });
        }
        if cursor.resource_id != 0 {
            let resource = resources.get(cursor.resource_id).ok_or(
                GpuSnapshotError::InvalidCursorResource {
                    scanout_id,
                    resource_id: cursor.resource_id,
                },
            )?;
            if cursor.hot_x >= resource.width
                || cursor.hot_y >= resource.height
                || resource.width > super::MAX_CURSOR_DIMENSION
                || resource.height > super::MAX_CURSOR_DIMENSION
            {
                return Err(GpuSnapshotError::InvalidCursorHotspot { scanout_id });
            }
            if !protocol::is_supported_format(resource.format) {
                return Err(GpuSnapshotError::IncompatibleFormat {
                    resource_id: cursor.resource_id,
                    format: resource.format,
                });
            }
        }
        cursor_states[index] = cursor;
    }

    // No fallible parse or reference validation remains.  This is the one commit point for live
    // state; the sink callback below observes the already-validated replacement only.
    state.resources = resources;
    state.display_width = parsed.display_width;
    state.display_height = parsed.display_height;
    state.display_refresh_hz = parsed.display_refresh_hz;
    state.events_read = parsed.events_read;
    state.config_irq_pending = parsed.config_irq_pending;
    state.scanout_resource = scanout_resource;
    state.cursor_states = cursor_states;
    state.commands_served = parsed.commands_served;

    if let Some(resource_id) = scanout_resource {
        // The reference was checked against the detached map before the commit point above.  A
        // missing entry here would imply an internal invariant violation, so it suppresses the
        // repair callback rather than turning a successful atomic restore into a late mutation
        // error.
        if let Some(resource) = state.resources.get(resource_id) {
            let rect = protocol::Rect {
                x: 0,
                y: 0,
                width: resource.width,
                height: resource.height,
            };
            state.frame_sink.flush(
                Some(0),
                resource.format,
                rect,
                resource.width,
                resource.height,
                &resource.host_pixels,
            );
        }
    }
    Ok(())
}

struct ParsedGpu {
    records: Vec<(u32, ResourceSnapshot)>,
    display_width: u32,
    display_height: u32,
    display_refresh_hz: u32,
    events_read: u32,
    config_irq_pending: bool,
    scanout_resource: u32,
    cursors: Vec<CursorState>,
    commands_served: u64,
}

fn parse(bytes: &[u8]) -> Result<ParsedGpu, GpuSnapshotError> {
    let mut reader = Reader::new(bytes);
    reader.require(HEADER_LEN)?;
    if reader.take(8)? != GPU_SNAPSHOT_MAGIC {
        return Err(GpuSnapshotError::BadMagic);
    }
    let version = reader.u16()?;
    if version != GPU_SNAPSHOT_VERSION {
        return Err(GpuSnapshotError::UnsupportedVersion {
            found: version,
            supported: GPU_SNAPSHOT_VERSION,
        });
    }
    let flags = reader.u16()?;
    if flags != 0 {
        return Err(GpuSnapshotError::ReservedFlags { found: flags });
    }
    let resource_count = reader.u32()?;
    if resource_count > MAX_SNAPSHOT_RESOURCES {
        return Err(GpuSnapshotError::TooManyResources {
            found: resource_count,
            maximum: MAX_SNAPSHOT_RESOURCES,
        });
    }
    let display_width = reader.u32()?;
    let display_height = reader.u32()?;
    if display_width == 0
        || display_height == 0
        || display_width > MAX_EDID_DIMENSION
        || display_height > MAX_EDID_DIMENSION
    {
        return Err(GpuSnapshotError::InvalidDisplayDimensions {
            width: display_width,
            height: display_height,
        });
    }
    let display_refresh_hz = reader.u32()?;
    if display_refresh_hz == 0 {
        return Err(GpuSnapshotError::InvalidRefreshRate {
            refresh_hz: display_refresh_hz,
        });
    }
    let events_read = reader.u32()?;
    let config_irq_pending = reader.bool("config_irq_pending")?;
    reader.reserved_zero(3)?;
    let scanout_resource = reader.u32()?;
    let cursor_count = reader.u32()?;
    if cursor_count != DEFAULT_NUM_SCANOUTS {
        return Err(GpuSnapshotError::InvalidCount);
    }
    let commands_served = reader.u64()?;

    let mut records = Vec::new();
    records
        .try_reserve_exact(resource_count as usize)
        .map_err(|_| GpuSnapshotError::OutOfMemory)?;
    let mut seen_ids = BTreeSet::new();
    for _ in 0..resource_count {
        reader.require(RESOURCE_HEADER_LEN)?;
        let resource_id = reader.u32()?;
        if resource_id == 0 {
            return Err(GpuSnapshotError::Resource {
                resource_id,
                reason: ResourceSnapshotError::InvalidResourceId { resource_id },
            });
        }
        if !seen_ids.insert(resource_id) {
            return Err(GpuSnapshotError::DuplicateResourceId { resource_id });
        }
        let format = reader.u32()?;
        let width = reader.u32()?;
        let height = reader.u32()?;
        if !protocol::is_supported_format(format) {
            return Err(GpuSnapshotError::IncompatibleFormat {
                resource_id,
                format,
            });
        }
        if width == 0
            || height == 0
            || width > resources::MAX_RESOURCE_DIMENSION
            || height > resources::MAX_RESOURCE_DIMENSION
        {
            return Err(GpuSnapshotError::Resource {
                resource_id,
                reason: ResourceSnapshotError::InvalidDimensions { resource_id },
            });
        }
        let presented = reader.bool("presented")?;
        reader.reserved_zero(3)?;
        let backing_count = reader.u32()?;
        if backing_count > resources::MAX_BACKING_ENTRIES
            || (backing_count as usize) > reader.remaining() / 12
        {
            return Err(GpuSnapshotError::Resource {
                resource_id,
                reason: ResourceSnapshotError::InvalidBacking { resource_id },
            });
        }
        let damage_count = reader.u32()?;
        if damage_count as usize > MAX_RECTS {
            return Err(GpuSnapshotError::Resource {
                resource_id,
                reason: ResourceSnapshotError::InvalidDamage { resource_id },
            });
        }
        let damage_collapsed = reader.bool("pending_damage_collapsed")?;
        reader.reserved_zero(3)?;
        let dirty_word_count = reader.u32()?;
        let dirty_count = reader.u32()?;
        let shadow_len = reader.u32()? as usize;

        let mut backing = Vec::new();
        backing
            .try_reserve_exact(backing_count as usize)
            .map_err(|_| GpuSnapshotError::OutOfMemory)?;
        for _ in 0..backing_count {
            let address = reader.u64()?;
            let length = reader.u32()?;
            backing.push((address, length));
        }
        let mut pending_damage = Vec::new();
        pending_damage
            .try_reserve_exact(damage_count as usize)
            .map_err(|_| GpuSnapshotError::OutOfMemory)?;
        for _ in 0..damage_count {
            pending_damage.push(reader.rect()?);
        }

        let expected_dirty_words =
            dirty_word_count_for(width, height).map_err(|_| GpuSnapshotError::Resource {
                resource_id,
                reason: ResourceSnapshotError::InvalidDimensions { resource_id },
            })?;
        if dirty_word_count as usize != expected_dirty_words {
            return Err(GpuSnapshotError::Resource {
                resource_id,
                reason: ResourceSnapshotError::InvalidTiles { resource_id },
            });
        }
        let mut dirty_bits = Vec::new();
        dirty_bits
            .try_reserve_exact(dirty_word_count as usize)
            .map_err(|_| GpuSnapshotError::OutOfMemory)?;
        for _ in 0..dirty_word_count {
            dirty_bits.push(reader.u64()?);
        }
        let shadow = reader.take(shadow_len)?;
        let pixel_count = usize::try_from(u64::from(width) * u64::from(height)).map_err(|_| {
            GpuSnapshotError::Resource {
                resource_id,
                reason: ResourceSnapshotError::InvalidDimensions { resource_id },
            }
        })?;
        let pixel_bytes = u64::try_from(pixel_count)
            .ok()
            .and_then(|count| count.checked_mul(core::mem::size_of::<u32>() as u64))
            .ok_or(GpuSnapshotError::Resource {
                resource_id,
                reason: ResourceSnapshotError::OutOfMemory { resource_id },
            })?;
        if pixel_bytes > resources::MAX_RESOURCE_BYTES {
            return Err(GpuSnapshotError::Resource {
                resource_id,
                reason: ResourceSnapshotError::OutOfMemory { resource_id },
            });
        }
        let pixels = resources::decompress_shadow(shadow, pixel_count).map_err(|reason| {
            GpuSnapshotError::Shadow {
                resource_id,
                reason,
            }
        })?;
        records.push((
            resource_id,
            ResourceSnapshot {
                format,
                width,
                height,
                pixels,
                backing,
                pending_damage,
                pending_damage_collapsed: damage_collapsed,
                presented,
                dirty_bits,
                dirty_count,
            },
        ));
    }

    let mut cursors = Vec::new();
    cursors
        .try_reserve_exact(cursor_count as usize)
        .map_err(|_| GpuSnapshotError::OutOfMemory)?;
    for _ in 0..cursor_count {
        let resource_id = reader.u32()?;
        let hot_x = reader.u32()?;
        let hot_y = reader.u32()?;
        let pos = protocol::CursorPos {
            scanout_id: reader.u32()?,
            x: reader.u32()?,
            y: reader.u32()?,
            padding: reader.u32()?,
        };
        cursors.push(CursorState {
            resource_id,
            hot_x,
            hot_y,
            pos,
        });
    }
    if !reader.is_empty() {
        return Err(GpuSnapshotError::TrailingBytes);
    }
    Ok(ParsedGpu {
        records,
        display_width,
        display_height,
        display_refresh_hz,
        events_read,
        config_irq_pending,
        scanout_resource,
        cursors,
        commands_served,
    })
}

fn dirty_word_count_for(width: u32, height: u32) -> Result<usize, GpuSnapshotError> {
    if width == 0 || height == 0 {
        return Err(GpuSnapshotError::InvalidDisplayDimensions { width, height });
    }
    let tiles_x = (width - 1) / super::tiles::TILE_SIZE + 1;
    let tiles_y = (height - 1) / super::tiles::TILE_SIZE + 1;
    let tile_count = u64::from(tiles_x)
        .checked_mul(u64::from(tiles_y))
        .ok_or(GpuSnapshotError::LengthOverflow)?;
    usize::try_from(tile_count.div_ceil(u64::from(u64::BITS)))
        .map_err(|_| GpuSnapshotError::LengthOverflow)
}

fn resource_id_from_reason(reason: ResourceSnapshotError) -> u32 {
    match reason {
        ResourceSnapshotError::DuplicateResourceId { resource_id }
        | ResourceSnapshotError::InvalidResourceId { resource_id }
        | ResourceSnapshotError::InvalidFormat { resource_id, .. }
        | ResourceSnapshotError::InvalidDimensions { resource_id }
        | ResourceSnapshotError::InvalidPixelLength { resource_id }
        | ResourceSnapshotError::InvalidBacking { resource_id }
        | ResourceSnapshotError::InvalidDamage { resource_id }
        | ResourceSnapshotError::InvalidTiles { resource_id }
        | ResourceSnapshotError::OutOfMemory { resource_id } => resource_id,
    }
}

fn push_cursor(out: &mut Vec<u8>, cursor: CursorState) {
    push_u32(out, cursor.resource_id);
    push_u32(out, cursor.hot_x);
    push_u32(out, cursor.hot_y);
    push_u32(out, cursor.pos.scanout_id);
    push_u32(out, cursor.pos.x);
    push_u32(out, cursor.pos.y);
    push_u32(out, cursor.pos.padding);
    debug_assert_eq!(CURSOR_LEN, 7 * 4);
}

fn push_rect(out: &mut Vec<u8>, rect: protocol::Rect) {
    push_u32(out, rect.x);
    push_u32(out, rect.y);
    push_u32(out, rect.width);
    push_u32(out, rect.height);
}

fn reserve(out: &mut Vec<u8>, additional: usize) -> Result<(), GpuSnapshotError> {
    out.try_reserve(additional)
        .map_err(|_| GpuSnapshotError::OutOfMemory)
}

fn u32_len(value: usize) -> Result<u32, GpuSnapshotError> {
    u32::try_from(value).map_err(|_| GpuSnapshotError::LengthOverflow)
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.pos)
    }

    fn is_empty(&self) -> bool {
        self.pos == self.bytes.len()
    }

    fn require(&self, length: usize) -> Result<(), GpuSnapshotError> {
        if self.remaining() < length {
            Err(GpuSnapshotError::Truncated)
        } else {
            Ok(())
        }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], GpuSnapshotError> {
        self.require(length)?;
        let end = self.pos + length;
        let bytes = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(bytes)
    }

    fn u16(&mut self) -> Result<u16, GpuSnapshotError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }

    fn u32(&mut self) -> Result<u32, GpuSnapshotError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn u64(&mut self) -> Result<u64, GpuSnapshotError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn bool(&mut self, field: &'static str) -> Result<bool, GpuSnapshotError> {
        match self.take(1)?[0] {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(GpuSnapshotError::InvalidBoolean { field }),
        }
    }

    fn reserved_zero(&mut self, length: usize) -> Result<(), GpuSnapshotError> {
        if self.take(length)?.iter().any(|byte| *byte != 0) {
            Err(GpuSnapshotError::ReservedFlags { found: 1 })
        } else {
            Ok(())
        }
    }

    fn rect(&mut self) -> Result<protocol::Rect, GpuSnapshotError> {
        Ok(protocol::Rect {
            x: self.u32()?,
            y: self.u32()?,
            width: self.u32()?,
            height: self.u32()?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::virtio::gpu::TestSink;
    use alloc::{boxed::Box, vec};

    fn fixture_state() -> (GpuState, TestSink) {
        let sink = TestSink::new();
        let mut state = GpuState::new(Box::new(sink.clone()));
        state.display_width = 901;
        state.display_height = 701;
        state.display_refresh_hz = 75;
        state.events_read = 1;
        state.config_irq_pending = true;
        state.commands_served = 17;
        let resource = state
            .resources
            .create(7, protocol::FORMAT_R8G8B8A8_UNORM, 8, 4)
            .unwrap();
        for (index, pixel) in resource.host_pixels.iter_mut().enumerate() {
            *pixel = if index < 16 {
                0x1122_3344
            } else {
                0xA500_0000 | index as u32
            };
        }
        resource.pending_damage.push(protocol::Rect {
            x: 1,
            y: 1,
            width: 3,
            height: 2,
        });
        resource.dirty_tiles.mark_rect(protocol::Rect {
            x: 1,
            y: 1,
            width: 3,
            height: 2,
        });
        resource.presented = true;
        state.scanout_resource = Some(7);
        state.cursor_states[0] = CursorState {
            resource_id: 7,
            hot_x: 2,
            hot_y: 1,
            pos: protocol::CursorPos {
                scanout_id: 0,
                x: 41,
                y: 52,
                padding: 0,
            },
        };
        (state, sink)
    }

    #[test]
    fn gpu_snapshot_round_trips_resource_scanout_cursor_damage_and_crc() {
        let (state, _sink) = fixture_state();
        let source_crc = crc32_pixels(&state.resources.get(7).unwrap().host_pixels);
        let bytes = encode(&state).unwrap();
        let mut restored = GpuState::new(Box::new(TestSink::new()));
        restore(&mut restored, &bytes).unwrap();
        assert_eq!(encode(&restored).unwrap(), bytes);
        assert_eq!(restored.display_size(), (901, 701));
        assert_eq!(restored.scanout_resource, Some(7));
        assert_eq!(restored.cursor_state(0).unwrap().hot_x, 2);
        let resource = restored.resources.get(7).unwrap();
        assert_eq!(resource.width, 8);
        assert_eq!(resource.height, 4);
        assert_eq!(
            resource.pending_damage.bounds(),
            Some(protocol::Rect {
                x: 1,
                y: 1,
                width: 3,
                height: 2
            })
        );
        assert_eq!(resource.dirty_tiles.dirty_tile_count(), 1);
        assert_eq!(source_crc, crc32_pixels(&resource.host_pixels));
    }

    #[test]
    fn valid_restore_presents_one_full_repair_frame() {
        let (state, _sink) = fixture_state();
        let bytes = encode(&state).unwrap();
        let sink = TestSink::new();
        let mut restored = GpuState::new(Box::new(sink.clone()));
        restore(&mut restored, &bytes).unwrap();
        let records = sink.records();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].scanout, Some(0));
        assert_eq!(
            records[0].rect,
            protocol::Rect {
                x: 0,
                y: 0,
                width: 8,
                height: 4
            }
        );
    }

    #[test]
    fn missing_scanout_resource_and_bad_format_leave_live_state_unchanged() {
        let (state, _sink) = fixture_state();
        let valid = encode(&state).unwrap();
        let mut missing = valid.clone();
        // scanout_resource is header offset 36..40; make it point at a resource that is absent.
        missing[36..40].copy_from_slice(&99u32.to_le_bytes());
        let mut target = GpuState::new(Box::new(TestSink::new()));
        target
            .resources
            .create(42, protocol::FORMAT_B8G8R8A8_UNORM, 1, 1)
            .unwrap();
        let before = target.resources.snapshot_records();
        assert!(matches!(
            restore(&mut target, &missing),
            Err(GpuSnapshotError::MissingResource { .. })
        ));
        assert_eq!(target.resources.snapshot_records(), before);

        // The resource format is the second u32 in the resource header.  It is rejected before the
        // missing/scanout commit point, leaving the target's pre-existing resource intact.
        let mut bad_format = valid;
        bad_format[HEADER_LEN + 4..HEADER_LEN + 8].copy_from_slice(&0xFFFFu32.to_le_bytes());
        let before = target.resources.snapshot_records();
        assert!(matches!(
            restore(&mut target, &bad_format),
            Err(GpuSnapshotError::IncompatibleFormat { resource_id: 7, .. })
        ));
        assert_eq!(target.resources.snapshot_records(), before);
    }

    #[test]
    fn malformed_shadow_and_truncation_fail_closed() {
        let (state, _sink) = fixture_state();
        let valid = encode(&state).unwrap();
        let mut target = GpuState::new(Box::new(TestSink::new()));
        target
            .resources
            .create(42, protocol::FORMAT_B8G8R8A8_UNORM, 1, 1)
            .unwrap();
        let before = target.resources.snapshot_records();
        assert_eq!(
            restore(&mut target, &valid[..valid.len() - 1]),
            Err(GpuSnapshotError::Truncated)
        );
        assert_eq!(target.resources.snapshot_records(), before);

        let shadow_start = valid
            .windows(4)
            .position(|window| window == b"GSH1")
            .expect("encoded resource has a shadow");
        let mut forged_shadow = valid.clone();
        forged_shadow[shadow_start + 9..shadow_start + 13].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(matches!(
            restore(&mut target, &forged_shadow),
            Err(GpuSnapshotError::Shadow { .. })
        ));
        assert_eq!(target.resources.snapshot_records(), before);

        let cursor_start = valid.len() - CURSOR_LEN;
        let mut forged_cursor = valid;
        forged_cursor[cursor_start + 4..cursor_start + 8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            restore(&mut target, &forged_cursor),
            Err(GpuSnapshotError::InvalidCursorHotspot { scanout_id: 0 })
        );
        assert_eq!(target.resources.snapshot_records(), before);
    }

    #[test]
    fn shadow_codec_reports_bounded_compression_and_rejects_forged_runs() {
        let fbcon = vec![0u32; 1024];
        let desktop: Vec<u32> = (0..1024).map(|index| 0xFF00_0000 | (index % 8)).collect();
        for pixels in [fbcon, desktop] {
            let compressed = resources::compress_shadow(&pixels).unwrap();
            assert_eq!(compressed.stats.raw_bytes(), (pixels.len() * 4) as u64);
            assert_eq!(
                compressed.stats.encoded_bytes(),
                compressed.bytes.len() as u64
            );
            assert!(compressed.stats.ratio_milli() > 0);
            assert_eq!(
                resources::decompress_shadow(&compressed.bytes, pixels.len()).unwrap(),
                pixels
            );
        }
        let mut forged = resources::compress_shadow(&[0u32; 4]).unwrap().bytes;
        forged[9..13].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            resources::decompress_shadow(&forged, 4),
            Err(ShadowCodecError::RunExceedsExpected)
        );
    }

    // Keep the CRC oracle local to this module so it does not depend on the TestSink's private
    // helper. It is the same CRC-32/IEEE byte order used by the production sink.
    fn crc32_pixels(pixels: &[u32]) -> u32 {
        let mut crc = 0xffff_ffff;
        for pixel in pixels {
            for byte in pixel.to_le_bytes() {
                crc ^= u32::from(byte);
                for _ in 0..8 {
                    let mask = 0u32.wrapping_sub(crc & 1);
                    crc = (crc >> 1) ^ (0xedb8_8320 & mask);
                }
            }
        }
        !crc
    }
}
