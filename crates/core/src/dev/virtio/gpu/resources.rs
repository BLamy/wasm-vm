//! Host-owned virtio-gpu 2D resources (E5-T02a).
//!
//! A resource owns a linear host shadow buffer.  The map accounts only the pixel buffers, which
//! is the bounded quantity that a hostile guest can grow through `RESOURCE_CREATE_2D`; descriptor
//! backing metadata is added by the later attach slice.  All validation happens before the first
//! pixel allocation so rejected requests are side-effect free.

use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

use super::{
    damage::DamageAccumulator,
    protocol,
    tiles::{DirtyTilePlanner, TilePlannerError, TileUploadPlan, UploadMode},
};
use crate::bus::Bus;
use crate::mmio::SystemBus;

/// Guest physical address used by later backing entries.
pub type GuestAddr = u64;

/// Maximum width or height accepted by `RESOURCE_CREATE_2D`.
pub const MAX_RESOURCE_DIMENSION: u32 = 16_384;
/// Maximum host shadow-buffer size for one resource.
pub const MAX_RESOURCE_BYTES: u64 = 256 * 1024 * 1024;
/// Default aggregate host shadow-buffer budget for one GPU device.
pub const DEFAULT_RESOURCE_BUDGET: u64 = 512 * 1024 * 1024;
/// Maximum number of guest-memory entries accepted in one attach request.
///
/// The wire count is a `u32`, but accepting the full range would let a guest request an
/// unbounded host metadata allocation.  One million entries is well above the normal page-sized
/// list for a 256 MiB resource while keeping the parser's worst-case reservation bounded.
pub const MAX_BACKING_ENTRIES: u32 = 1 << 20;

/// A host-owned 2D GPU resource.
#[derive(Debug)]
pub struct Resource {
    pub format: u32,
    pub width: u32,
    pub height: u32,
    pub host_pixels: Box<[u32]>,
    /// Guest backing entries are populated by E5-T02b.  CREATE_2D always starts detached.
    pub backing: Vec<(GuestAddr, u32)>,
    /// Pixels changed by transfers since the last flush. The bounded plan preserves separate
    /// regions for the later tile/presentation slices while this resource API still publishes one
    /// protocol rectangle today.
    pub(crate) pending_damage: DamageAccumulator,
    /// The first browser presentation must establish the whole surface.  Later transfers may be
    /// narrowed to `pending_damage` when the sink opts into change tracking.
    pub(crate) presented: bool,
    /// 64x64 tiles touched by successful transfers, consumed by the later tiled upload seam.
    pub(crate) dirty_tiles: DirtyTilePlanner,
}

impl Resource {
    /// Number of bytes in the host shadow buffer.
    pub fn accounted_bytes(&self) -> u64 {
        (self.host_pixels.len() as u64) * core::mem::size_of::<u32>() as u64
    }

    /// Record one transfer result and return the rectangle to publish at the next flush.
    ///
    /// A non-tracking sink retains the exact protocol request for the historical core contract.
    /// A tracking sink receives the first requested rectangle in full, then the bounding box of
    /// pixels whose transferred values differ from the previously flushed resource.
    pub fn flush_rect(&mut self, requested: protocol::Rect, track_changes: bool) -> protocol::Rect {
        let published = if track_changes && self.presented {
            match self.pending_damage.take().bounds() {
                Some(pending) if DamageAccumulator::contains(requested, pending) => pending,
                Some(pending) => DamageAccumulator::union(requested, pending),
                None => requested,
            }
        } else {
            self.pending_damage.clear();
            requested
        };
        self.dirty_tiles
            .clear_intersecting(core::slice::from_ref(&published));
        self.presented = true;
        published
    }

    /// Select dirty upload regions intersecting a coalesced flush plan.
    ///
    /// The current single-rectangle [`super::FrameSink`] contract remains unchanged; the returned
    /// plan is the stable core seam consumed by the later browser tile/scheduler slices.
    pub fn plan_uploads(
        &mut self,
        flush_rects: &[protocol::Rect],
        mode: UploadMode,
    ) -> Result<TileUploadPlan, TilePlannerError> {
        self.dirty_tiles.plan(flush_rects, mode)
    }

    /// Number of dirty tiles waiting for an upload plan.
    pub fn dirty_tile_count(&self) -> u32 {
        self.dirty_tiles.dirty_tile_count()
    }
}

/// Why a resource creation request was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateError {
    /// Resource id 0 is reserved, or the id already exists.
    InvalidResourceId,
    /// A dimension/format/size field is invalid.
    InvalidParameter,
    /// The per-resource or aggregate shadow-buffer budget would be exceeded.
    OutOfMemory,
}

/// Why a backing attach/detach request was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackingError {
    /// No live resource owns the requested id.
    InvalidResourceId,
    /// The sglist or one of its entries is malformed/out of guest RAM.
    InvalidParameter,
    /// Host metadata reservation was refused.
    OutOfMemory,
}

/// Why a resource unref was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnrefError {
    /// No live resource owns the requested id.
    InvalidResourceId,
    /// The unref request did not contain its fixed wire payload.
    InvalidParameter,
}

/// Bounded failure modes of the deterministic host-shadow codec used by T26b.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShadowCodecError {
    Truncated,
    BadMagic,
    InvalidKind,
    ZeroLengthRun,
    RunExceedsExpected,
    PixelCountMismatch { declared: u32, expected: u32 },
    TrailingBytes,
    PixelCountOverflow,
    OutOfMemory,
}

impl ShadowCodecError {
    /// Stable machine-readable code for native/browser verifier logs.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Truncated => "truncated",
            Self::BadMagic => "bad_magic",
            Self::InvalidKind => "invalid_kind",
            Self::ZeroLengthRun => "zero_length_run",
            Self::RunExceedsExpected => "run_exceeds_expected",
            Self::PixelCountMismatch { .. } => "pixel_count_mismatch",
            Self::TrailingBytes => "trailing_bytes",
            Self::PixelCountOverflow => "pixel_count_overflow",
            Self::OutOfMemory => "out_of_memory",
        }
    }
}

/// Compression size report for a host shadow buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShadowCompressionStats {
    raw_bytes: u64,
    encoded_bytes: u64,
    /// Encoded/raw × 1000.  Integer arithmetic keeps the report deterministic on wasm32 and
    /// native builds alike; 1000 means 1.000× the raw size.
    ratio_milli: u32,
}

impl ShadowCompressionStats {
    pub const fn raw_bytes(self) -> u64 {
        self.raw_bytes
    }

    pub const fn encoded_bytes(self) -> u64 {
        self.encoded_bytes
    }

    pub const fn ratio_milli(self) -> u32 {
        self.ratio_milli
    }
}

/// A compressed host shadow plus the deterministic size report used by the proof harness.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompressedShadow {
    pub bytes: Vec<u8>,
    pub stats: ShadowCompressionStats,
}

/// A complete resource record detached from the live map.  T26b serializes these records before
/// replacing any live map, so malformed shadows or bindings cannot partially alter a resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceSnapshot {
    pub(crate) format: u32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) pixels: Vec<u32>,
    pub(crate) backing: Vec<(GuestAddr, u32)>,
    pub(crate) pending_damage: Vec<protocol::Rect>,
    pub(crate) pending_damage_collapsed: bool,
    pub(crate) presented: bool,
    pub(crate) dirty_bits: Vec<u64>,
    pub(crate) dirty_count: u32,
}

/// Failure while reconstructing a resource map from a validated GPU snapshot payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceSnapshotError {
    DuplicateResourceId { resource_id: u32 },
    InvalidResourceId { resource_id: u32 },
    InvalidFormat { resource_id: u32, format: u32 },
    InvalidDimensions { resource_id: u32 },
    InvalidPixelLength { resource_id: u32 },
    InvalidBacking { resource_id: u32 },
    InvalidDamage { resource_id: u32 },
    InvalidTiles { resource_id: u32 },
    OutOfMemory { resource_id: u32 },
}

impl ResourceSnapshotError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::DuplicateResourceId { .. } => "duplicate_resource_id",
            Self::InvalidResourceId { .. } => "invalid_resource_id",
            Self::InvalidFormat { .. } => "invalid_format",
            Self::InvalidDimensions { .. } => "invalid_dimensions",
            Self::InvalidPixelLength { .. } => "invalid_pixel_length",
            Self::InvalidBacking { .. } => "invalid_backing",
            Self::InvalidDamage { .. } => "invalid_damage",
            Self::InvalidTiles { .. } => "invalid_tiles",
            Self::OutOfMemory { .. } => "out_of_memory",
        }
    }
}

const SHADOW_MAGIC: [u8; 4] = *b"GSH1";
const SHADOW_HEADER_LEN: usize = 8;
const SHADOW_REPEAT: u8 = 0;
const SHADOW_LITERAL: u8 = 1;

/// Encode u32 host pixels with deterministic repeat/literal chunks.  A run of three or more equal
/// pixels uses one value; shorter runs are grouped into a literal chunk.  The decoder receives an
/// expected pixel count and checks every run before growing its output.
pub fn compress_shadow(pixels: &[u32]) -> Result<CompressedShadow, ShadowCodecError> {
    let pixel_count =
        u32::try_from(pixels.len()).map_err(|_| ShadowCodecError::PixelCountOverflow)?;
    let mut encoded = Vec::new();
    encoded
        .try_reserve(SHADOW_HEADER_LEN)
        .map_err(|_| ShadowCodecError::OutOfMemory)?;
    encoded.extend_from_slice(&SHADOW_MAGIC);
    encoded.extend_from_slice(&pixel_count.to_le_bytes());

    let mut cursor = 0usize;
    while cursor < pixels.len() {
        let start = cursor;
        let value = pixels[cursor];
        while cursor < pixels.len() && pixels[cursor] == value {
            cursor += 1;
        }
        let run_len = cursor - start;
        if run_len >= 3 {
            append_repeat(&mut encoded, run_len, value)?;
            continue;
        }

        // Include adjacent short runs in one literal chunk, stopping immediately before the next
        // compressible run. This makes the output independent of allocator/chunk boundaries.
        let literal_start = start;
        let mut literal_end = cursor;
        while literal_end < pixels.len() {
            let next_value = pixels[literal_end];
            let mut next_end = literal_end + 1;
            while next_end < pixels.len() && pixels[next_end] == next_value {
                next_end += 1;
            }
            if next_end - literal_end >= 3 {
                break;
            }
            literal_end = next_end;
        }
        append_literal(&mut encoded, &pixels[literal_start..literal_end])?;
        cursor = literal_end;
    }

    let raw_bytes = (pixels.len() as u64) * core::mem::size_of::<u32>() as u64;
    let encoded_bytes = encoded.len() as u64;
    let ratio_milli = if raw_bytes == 0 {
        1000
    } else {
        encoded_bytes
            .saturating_mul(1000)
            .checked_div(raw_bytes)
            .unwrap_or(0)
            .min(u64::from(u32::MAX)) as u32
    };
    Ok(CompressedShadow {
        bytes: encoded,
        stats: ShadowCompressionStats {
            raw_bytes,
            encoded_bytes,
            ratio_milli,
        },
    })
}

fn append_repeat(out: &mut Vec<u8>, mut length: usize, value: u32) -> Result<(), ShadowCodecError> {
    while length != 0 {
        let chunk = length.min(u32::MAX as usize);
        out.try_reserve(9)
            .map_err(|_| ShadowCodecError::OutOfMemory)?;
        out.push(SHADOW_REPEAT);
        out.extend_from_slice(&(chunk as u32).to_le_bytes());
        out.extend_from_slice(&value.to_le_bytes());
        length -= chunk;
    }
    Ok(())
}

fn append_literal(out: &mut Vec<u8>, pixels: &[u32]) -> Result<(), ShadowCodecError> {
    if pixels.is_empty() {
        return Ok(());
    }
    let byte_len = pixels
        .len()
        .checked_mul(core::mem::size_of::<u32>())
        .ok_or(ShadowCodecError::PixelCountOverflow)?;
    out.try_reserve(
        5usize
            .checked_add(byte_len)
            .ok_or(ShadowCodecError::PixelCountOverflow)?,
    )
    .map_err(|_| ShadowCodecError::OutOfMemory)?;
    out.push(SHADOW_LITERAL);
    out.extend_from_slice(&(pixels.len() as u32).to_le_bytes());
    for pixel in pixels {
        out.extend_from_slice(&pixel.to_le_bytes());
    }
    Ok(())
}

/// Decode a shadow only when it reconstructs exactly `expected_pixels` u32 values.
pub fn decompress_shadow(
    encoded: &[u8],
    expected_pixels: usize,
) -> Result<Vec<u32>, ShadowCodecError> {
    if encoded.len() < SHADOW_HEADER_LEN {
        return Err(ShadowCodecError::Truncated);
    }
    if encoded[..4] != SHADOW_MAGIC {
        return Err(ShadowCodecError::BadMagic);
    }
    let declared = u32::from_le_bytes(encoded[4..8].try_into().unwrap());
    let expected =
        u32::try_from(expected_pixels).map_err(|_| ShadowCodecError::PixelCountOverflow)?;
    if declared != expected {
        return Err(ShadowCodecError::PixelCountMismatch { declared, expected });
    }
    let mut pixels = Vec::new();
    pixels
        .try_reserve_exact(expected_pixels)
        .map_err(|_| ShadowCodecError::OutOfMemory)?;
    let mut pos = SHADOW_HEADER_LEN;
    while pos < encoded.len() {
        if encoded.len() - pos < 5 {
            return Err(ShadowCodecError::Truncated);
        }
        let kind = encoded[pos];
        let length = u32::from_le_bytes(encoded[pos + 1..pos + 5].try_into().unwrap()) as usize;
        pos += 5;
        if length == 0 {
            return Err(ShadowCodecError::ZeroLengthRun);
        }
        let new_len = pixels
            .len()
            .checked_add(length)
            .filter(|len| *len <= expected_pixels)
            .ok_or(ShadowCodecError::RunExceedsExpected)?;
        match kind {
            SHADOW_REPEAT => {
                if encoded.len() - pos < 4 {
                    return Err(ShadowCodecError::Truncated);
                }
                let value = u32::from_le_bytes(encoded[pos..pos + 4].try_into().unwrap());
                pos += 4;
                pixels.resize(new_len, value);
            }
            SHADOW_LITERAL => {
                let bytes = length
                    .checked_mul(core::mem::size_of::<u32>())
                    .ok_or(ShadowCodecError::RunExceedsExpected)?;
                let end = pos.checked_add(bytes).ok_or(ShadowCodecError::Truncated)?;
                if end > encoded.len() {
                    return Err(ShadowCodecError::Truncated);
                }
                for chunk in encoded[pos..end].chunks_exact(4) {
                    pixels.push(u32::from_le_bytes(chunk.try_into().unwrap()));
                }
                pos = end;
            }
            _ => return Err(ShadowCodecError::InvalidKind),
        }
        debug_assert_eq!(pixels.len(), new_len);
    }
    if pixels.len() != expected_pixels {
        return Err(ShadowCodecError::PixelCountMismatch { declared, expected });
    }
    if pos != encoded.len() {
        return Err(ShadowCodecError::TrailingBytes);
    }
    Ok(pixels)
}

/// Why a TRANSFER_TO_HOST_2D request was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferError {
    /// No live resource owns the requested id.
    InvalidResourceId,
    /// The rectangle, offset, backing, or guest-memory range is invalid.
    InvalidParameter,
    /// A bounded host-side row buffer could not be reserved.
    OutOfMemory,
}

/// Cursor over a resource's backing entries viewed as one linear byte stream.
///
/// The cursor advances by whole contiguous spans, so a row that crosses SG boundaries performs
/// one guest slice read per entry rather than one lookup per pixel.
struct BackingReader<'a> {
    entries: &'a [(GuestAddr, u32)],
    index: usize,
    offset: u64,
}

impl<'a> BackingReader<'a> {
    fn new(entries: &'a [(GuestAddr, u32)]) -> Self {
        Self {
            entries,
            index: 0,
            offset: 0,
        }
    }

    fn seek(&mut self, logical_offset: u64) -> Result<(), TransferError> {
        self.index = 0;
        self.offset = 0;
        let mut skip = logical_offset;
        for (index, &(_, length)) in self.entries.iter().enumerate() {
            let length = u64::from(length);
            if length == 0 {
                return Err(TransferError::InvalidParameter);
            }
            if skip < length {
                self.index = index;
                self.offset = skip;
                return Ok(());
            }
            skip -= length;
        }
        if skip == 0 {
            self.index = self.entries.len();
            Ok(())
        } else {
            Err(TransferError::InvalidParameter)
        }
    }

    fn read_exact(&mut self, bus: &SystemBus, output: &mut [u8]) -> Result<(), TransferError> {
        let mut copied = 0usize;
        while copied < output.len() {
            let (addr, length) = *self
                .entries
                .get(self.index)
                .ok_or(TransferError::InvalidParameter)?;
            let length = u64::from(length);
            if self.offset >= length {
                return Err(TransferError::InvalidParameter);
            }
            let available = length - self.offset;
            let take = available.min((output.len() - copied) as u64) as usize;
            let guest_addr = addr
                .checked_add(self.offset)
                .ok_or(TransferError::InvalidParameter)?;
            bus.ram()
                .read_slice(guest_addr, &mut output[copied..copied + take])
                .map_err(|_| TransferError::InvalidParameter)?;
            copied += take;
            self.offset += take as u64;
            if self.offset == length {
                self.index += 1;
                self.offset = 0;
            }
        }
        Ok(())
    }

    /// Advance over a row gap without touching guest memory.
    fn skip(&mut self, mut bytes: u64) -> Result<(), TransferError> {
        while bytes != 0 {
            let &(_, length) = self
                .entries
                .get(self.index)
                .ok_or(TransferError::InvalidParameter)?;
            let length = u64::from(length);
            if self.offset >= length {
                return Err(TransferError::InvalidParameter);
            }
            let take = (length - self.offset).min(bytes);
            self.offset += take;
            bytes -= take;
            if self.offset == length {
                self.index += 1;
                self.offset = 0;
            }
        }
        Ok(())
    }
}

/// Deterministic resource store with explicit pixel-byte accounting.
#[derive(Debug)]
pub struct ResourceMap {
    resources: BTreeMap<u32, Resource>,
    accounted_bytes: u64,
    total_budget: u64,
    per_resource_budget: u64,
}

impl Default for ResourceMap {
    fn default() -> Self {
        Self::new()
    }
}

impl ResourceMap {
    /// Construct the production map with a 512 MiB aggregate and 256 MiB per-resource budget.
    pub const fn new() -> Self {
        Self {
            resources: BTreeMap::new(),
            accounted_bytes: 0,
            total_budget: DEFAULT_RESOURCE_BUDGET,
            per_resource_budget: MAX_RESOURCE_BYTES,
        }
    }

    /// Construct a map with an explicit aggregate budget.  The normal per-resource cap remains
    /// 256 MiB; tests use this to make budget boundaries small without changing validation rules.
    pub const fn with_budget(total_budget: u64) -> Self {
        Self {
            resources: BTreeMap::new(),
            accounted_bytes: 0,
            total_budget,
            per_resource_budget: MAX_RESOURCE_BYTES,
        }
    }

    /// Construct a map with explicit aggregate and per-resource budgets.
    pub const fn with_budgets(total_budget: u64, per_resource_budget: u64) -> Self {
        Self {
            resources: BTreeMap::new(),
            accounted_bytes: 0,
            total_budget,
            per_resource_budget,
        }
    }

    /// Number of live resources.
    pub fn len(&self) -> usize {
        self.resources.len()
    }

    /// Whether the store has no live resources.
    pub fn is_empty(&self) -> bool {
        self.resources.is_empty()
    }

    /// Total accounted pixel bytes, excluding map-node/backing metadata.
    pub fn accounted_bytes(&self) -> u64 {
        self.accounted_bytes
    }

    /// Configured aggregate budget.
    pub fn total_budget(&self) -> u64 {
        self.total_budget
    }

    /// Look up a resource without changing accounting.
    pub fn get(&self, resource_id: u32) -> Option<&Resource> {
        self.resources.get(&resource_id)
    }

    /// Mutable lookup for later command slices.
    pub fn get_mut(&mut self, resource_id: u32) -> Option<&mut Resource> {
        self.resources.get_mut(&resource_id)
    }

    /// Copy every live resource into deterministic id order for the T26b snapshot transaction.
    pub(crate) fn snapshot_records(&self) -> Vec<(u32, ResourceSnapshot)> {
        self.resources
            .iter()
            .map(|(&resource_id, resource)| {
                (
                    resource_id,
                    ResourceSnapshot {
                        format: resource.format,
                        width: resource.width,
                        height: resource.height,
                        pixels: resource.host_pixels.to_vec(),
                        backing: resource.backing.clone(),
                        pending_damage: resource.pending_damage.rects().to_vec(),
                        pending_damage_collapsed: resource.pending_damage.is_collapsed(),
                        presented: resource.presented,
                        dirty_bits: resource.dirty_tiles.snapshot_bits().to_vec(),
                        dirty_count: resource.dirty_tiles.dirty_tile_count(),
                    },
                )
            })
            .collect()
    }

    /// Build a detached resource map from already-decoded records.  The live map is not involved;
    /// callers can therefore finish validating all scanout/cursor references before swapping it
    /// into `GpuState`.
    pub(crate) fn from_snapshot_records(
        records: &[(u32, ResourceSnapshot)],
    ) -> Result<Self, ResourceSnapshotError> {
        let mut map = Self::new();
        for &(resource_id, ref snapshot) in records {
            if resource_id == 0 {
                return Err(ResourceSnapshotError::InvalidResourceId { resource_id });
            }
            if map.resources.contains_key(&resource_id) {
                return Err(ResourceSnapshotError::DuplicateResourceId { resource_id });
            }
            let pixel_count = u64::from(snapshot.width)
                .checked_mul(u64::from(snapshot.height))
                .and_then(|count| usize::try_from(count).ok())
                .ok_or(ResourceSnapshotError::InvalidDimensions { resource_id })?;
            if snapshot.pixels.len() != pixel_count {
                return Err(ResourceSnapshotError::InvalidPixelLength { resource_id });
            }
            for &(address, length) in &snapshot.backing {
                if length == 0 || address.checked_add(u64::from(length)).is_none() {
                    return Err(ResourceSnapshotError::InvalidBacking { resource_id });
                }
            }
            let pending_damage = DamageAccumulator::from_snapshot(
                snapshot.width,
                snapshot.height,
                &snapshot.pending_damage,
                snapshot.pending_damage_collapsed,
            )
            .ok_or(ResourceSnapshotError::InvalidDamage { resource_id })?;
            let dirty_tiles = DirtyTilePlanner::from_snapshot(
                snapshot.width,
                snapshot.height,
                &snapshot.dirty_bits,
                snapshot.dirty_count,
            )
            .map_err(|_| ResourceSnapshotError::InvalidTiles { resource_id })?;

            let resource = map
                .create(
                    resource_id,
                    snapshot.format,
                    snapshot.width,
                    snapshot.height,
                )
                .map_err(|error| match error {
                    CreateError::InvalidResourceId => {
                        ResourceSnapshotError::DuplicateResourceId { resource_id }
                    }
                    CreateError::InvalidParameter => {
                        if !protocol::is_supported_format(snapshot.format) {
                            ResourceSnapshotError::InvalidFormat {
                                resource_id,
                                format: snapshot.format,
                            }
                        } else {
                            ResourceSnapshotError::InvalidDimensions { resource_id }
                        }
                    }
                    CreateError::OutOfMemory => ResourceSnapshotError::OutOfMemory { resource_id },
                })?;
            resource.host_pixels.copy_from_slice(&snapshot.pixels);
            resource.backing = snapshot.backing.clone();
            resource.pending_damage = pending_damage;
            resource.presented = snapshot.presented;
            resource.dirty_tiles = dirty_tiles;
        }
        Ok(map)
    }

    /// Atomically publish a fully decoded and validated backing list.
    pub fn attach_backing(
        &mut self,
        resource_id: u32,
        backing: Vec<(GuestAddr, u32)>,
    ) -> Result<(), BackingError> {
        let resource = self
            .resources
            .get_mut(&resource_id)
            .ok_or(BackingError::InvalidResourceId)?;
        resource.backing = backing;
        Ok(())
    }

    /// Detach all guest backing entries from a live resource.
    pub fn detach_backing(&mut self, resource_id: u32) -> Result<(), BackingError> {
        let resource = self
            .resources
            .get_mut(&resource_id)
            .ok_or(BackingError::InvalidResourceId)?;
        resource.backing.clear();
        Ok(())
    }

    /// Remove a live resource and release its host shadow buffer and backing metadata.
    pub fn remove(&mut self, resource_id: u32) -> Result<Resource, UnrefError> {
        let resource = self
            .resources
            .remove(&resource_id)
            .ok_or(UnrefError::InvalidResourceId)?;
        self.accounted_bytes = self
            .accounted_bytes
            .checked_sub(resource.accounted_bytes())
            .expect("resource accounting underflow");
        Ok(resource)
    }

    /// Copy one checked rectangle from guest backing into the host shadow buffer.
    ///
    /// Every arithmetic and backing range is validated before the first shadow write. The guest
    /// source is read through `Ram::read_slice`, which has no write side effect, and the SG cursor
    /// remains linear while it consumes each row.
    pub fn transfer_to_host_2d(
        &mut self,
        resource_id: u32,
        rect: protocol::Rect,
        offset: u64,
        bus: &SystemBus,
    ) -> Result<(), TransferError> {
        let resource = self
            .resources
            .get_mut(&resource_id)
            .ok_or(TransferError::InvalidResourceId)?;
        if u64::from(rect.x) + u64::from(rect.width) > u64::from(resource.width)
            || u64::from(rect.y) + u64::from(rect.height) > u64::from(resource.height)
        {
            return Err(TransferError::InvalidParameter);
        }
        if resource.backing.is_empty() {
            return Err(TransferError::InvalidParameter);
        }

        let mut backing_len = 0u64;
        for &(addr, length) in &resource.backing {
            if length == 0 || !bus.ram().ram_contains(addr, u64::from(length)) {
                return Err(TransferError::InvalidParameter);
            }
            backing_len = backing_len
                .checked_add(u64::from(length))
                .ok_or(TransferError::InvalidParameter)?;
        }
        if offset > backing_len {
            return Err(TransferError::InvalidParameter);
        }
        if rect.width == 0 || rect.height == 0 {
            return Ok(());
        }

        let stride = u64::from(resource.width)
            .checked_mul(core::mem::size_of::<u32>() as u64)
            .ok_or(TransferError::InvalidParameter)?;
        let row_bytes = u64::from(rect.width)
            .checked_mul(core::mem::size_of::<u32>() as u64)
            .ok_or(TransferError::InvalidParameter)?;
        let first_row = offset
            .checked_add(
                u64::from(rect.y)
                    .checked_mul(stride)
                    .ok_or(TransferError::InvalidParameter)?,
            )
            .and_then(|start| {
                start
                    .checked_add(u64::from(rect.x).checked_mul(core::mem::size_of::<u32>() as u64)?)
            })
            .ok_or(TransferError::InvalidParameter)?;
        let last_row_advance = u64::from(rect.height.saturating_sub(1))
            .checked_mul(stride)
            .ok_or(TransferError::InvalidParameter)?;
        let span = last_row_advance
            .checked_add(row_bytes)
            .ok_or(TransferError::InvalidParameter)?;
        let end = first_row
            .checked_add(span)
            .ok_or(TransferError::InvalidParameter)?;
        if end > backing_len {
            return Err(TransferError::InvalidParameter);
        }

        let row_len = usize::try_from(row_bytes).map_err(|_| TransferError::OutOfMemory)?;
        let mut row = Vec::new();
        row.try_reserve_exact(row_len)
            .map_err(|_| TransferError::OutOfMemory)?;
        row.resize(row_len, 0);

        let (host_pixels, backing, pending_damage) = (
            &mut resource.host_pixels,
            resource.backing.as_slice(),
            &mut resource.pending_damage,
        );
        let mut reader = BackingReader::new(backing);
        reader.seek(first_row)?;
        for row_index in 0..rect.height {
            reader.read_exact(bus, &mut row)?;
            let destination = u64::from(rect.y + row_index)
                .checked_mul(u64::from(resource.width))
                .and_then(|start| start.checked_add(u64::from(rect.x)))
                .and_then(|start| usize::try_from(start).ok())
                .ok_or(TransferError::InvalidParameter)?;
            for (pixel, bytes) in row.chunks_exact(core::mem::size_of::<u32>()).enumerate() {
                let index = destination
                    .checked_add(pixel)
                    .ok_or(TransferError::InvalidParameter)?;
                let value = u32::from_le_bytes(
                    bytes
                        .try_into()
                        .map_err(|_| TransferError::InvalidParameter)?,
                );
                if host_pixels[index] != value {
                    host_pixels[index] = value;
                    pending_damage.push(protocol::Rect {
                        x: rect.x + pixel as u32,
                        y: rect.y + row_index,
                        width: 1,
                        height: 1,
                    });
                }
            }
            if row_index + 1 < rect.height {
                reader.skip(stride - row_bytes)?;
            }
        }
        resource.dirty_tiles.mark_rect(rect);
        Ok(())
    }

    /// Create a detached host shadow buffer after validating every guest-controlled field.
    ///
    /// The validation order is intentional: no `Box`/`Vec` allocation occurs for id, format,
    /// dimension, overflow, per-resource, aggregate-budget, or platform-`usize` failures.
    pub fn create(
        &mut self,
        resource_id: u32,
        format: u32,
        width: u32,
        height: u32,
    ) -> Result<&mut Resource, CreateError> {
        if resource_id == 0 || self.resources.contains_key(&resource_id) {
            return Err(CreateError::InvalidResourceId);
        }
        if !protocol::is_supported_format(format)
            || width == 0
            || height == 0
            || width > MAX_RESOURCE_DIMENSION
            || height > MAX_RESOURCE_DIMENSION
        {
            return Err(CreateError::InvalidParameter);
        }

        let pixel_count = u64::from(width)
            .checked_mul(u64::from(height))
            .ok_or(CreateError::OutOfMemory)?;
        let pixel_bytes = pixel_count
            .checked_mul(core::mem::size_of::<u32>() as u64)
            .ok_or(CreateError::OutOfMemory)?;
        if pixel_bytes > self.per_resource_budget
            || pixel_bytes > self.total_budget.saturating_sub(self.accounted_bytes)
        {
            return Err(CreateError::OutOfMemory);
        }
        let pixel_len = usize::try_from(pixel_count).map_err(|_| CreateError::OutOfMemory)?;

        // Reserve first, then resize: after a successful fallible reservation, resize cannot
        // request a second allocation for this exact length.
        let mut pixels = Vec::new();
        pixels
            .try_reserve_exact(pixel_len)
            .map_err(|_| CreateError::OutOfMemory)?;
        pixels.resize(pixel_len, 0);

        let resource = Resource {
            format,
            width,
            height,
            host_pixels: pixels.into_boxed_slice(),
            backing: Vec::new(),
            pending_damage: DamageAccumulator::new(width, height),
            presented: false,
            dirty_tiles: DirtyTilePlanner::try_new(width, height)
                .map_err(|_| CreateError::OutOfMemory)?,
        };
        self.accounted_bytes += pixel_bytes;
        self.resources.insert(resource_id, resource);
        // The id was checked absent above, so insertion cannot replace a live resource.
        Ok(self
            .resources
            .get_mut(&resource_id)
            .expect("resource inserted immediately above"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mmio::SystemBus;
    use crate::platform::virt::DRAM_BASE;
    use crate::ram::Ram;

    const FORMATS: [u32; 6] = [
        protocol::FORMAT_B8G8R8A8_UNORM,
        protocol::FORMAT_B8G8R8X8_UNORM,
        protocol::FORMAT_A8R8G8B8_UNORM,
        protocol::FORMAT_X8R8G8B8_UNORM,
        protocol::FORMAT_R8G8B8A8_UNORM,
        protocol::FORMAT_R8G8B8X8_UNORM,
    ];

    #[test]
    fn gpu_resources_create_supported_formats_are_detached_and_accounted() {
        let mut map = ResourceMap::new();
        for (index, format) in FORMATS.into_iter().enumerate() {
            let id = (index + 1) as u32;
            let resource = map.create(id, format, 3, 5).unwrap();
            assert_eq!(resource.format, format);
            assert_eq!(resource.width, 3);
            assert_eq!(resource.height, 5);
            assert_eq!(resource.host_pixels.len(), 15);
            assert!(resource.host_pixels.iter().all(|pixel| *pixel == 0));
            assert!(resource.backing.is_empty());
        }
        assert_eq!(map.len(), FORMATS.len());
        assert_eq!(map.accounted_bytes(), (FORMATS.len() * 3 * 5 * 4) as u64);
    }

    #[test]
    fn gpu_resources_create_rejects_id_zero_duplicate_and_bad_fields_without_mutation() {
        let mut map = ResourceMap::new();
        assert_eq!(
            map.create(0, FORMATS[0], 1, 1).err(),
            Some(CreateError::InvalidResourceId)
        );
        assert_eq!(map.len(), 0);
        assert_eq!(map.accounted_bytes(), 0);

        map.create(7, FORMATS[0], 2, 2).unwrap();
        let baseline = map.accounted_bytes();
        assert_eq!(
            map.create(7, FORMATS[1], 4, 4).err(),
            Some(CreateError::InvalidResourceId)
        );
        for (width, height, format) in [
            (0, 1, FORMATS[0]),
            (1, 0, FORMATS[0]),
            (1, 1, 0),
            (1, 1, 99),
        ] {
            assert_eq!(
                map.create(8, format, width, height).err(),
                Some(CreateError::InvalidParameter)
            );
            assert_eq!(map.len(), 1);
            assert_eq!(map.accounted_bytes(), baseline);
        }
    }

    #[test]
    fn gpu_resources_create_rejects_dimension_and_budget_before_allocation() {
        let mut map = ResourceMap::new();
        let baseline = map.accounted_bytes();
        for (id, width, height) in [(1, 0x1_0000, 1), (2, 1, 0x1_0000)] {
            assert_eq!(
                map.create(id, FORMATS[0], width, height).err(),
                Some(CreateError::InvalidParameter)
            );
            assert_eq!(map.len(), 0);
            assert_eq!(map.accounted_bytes(), baseline);
        }

        // 16384²×4 = 1 GiB: the per-resource and aggregate checks run before allocation.
        assert_eq!(
            map.create(
                3,
                FORMATS[0],
                MAX_RESOURCE_DIMENSION,
                MAX_RESOURCE_DIMENSION,
            )
            .err(),
            Some(CreateError::OutOfMemory)
        );
        assert!(map.is_empty());
        assert_eq!(map.accounted_bytes(), 0);
    }

    #[test]
    fn gpu_resources_create_enforces_aggregate_budget_without_partial_insert() {
        let mut map = ResourceMap::with_budgets(32, 32);
        map.create(1, FORMATS[0], 2, 2).unwrap(); // 16 bytes
        map.create(2, FORMATS[1], 2, 2).unwrap(); // 16 bytes
        let baseline = map.accounted_bytes();
        assert_eq!(baseline, 32);
        assert_eq!(
            map.create(3, FORMATS[2], 1, 1).err(),
            Some(CreateError::OutOfMemory)
        );
        assert_eq!(map.len(), 2);
        assert_eq!(map.accounted_bytes(), baseline);
    }

    #[test]
    fn gpu_resources_create_repeated_rejections_do_not_grow_map() {
        let mut map = ResourceMap::new();
        let bytes_per_resource = 4096u64 * 4096 * 4;
        let accepted = DEFAULT_RESOURCE_BUDGET / bytes_per_resource;
        for id in 1..=100_000 {
            let result = map.create(id, FORMATS[0], 4096, 4096);
            if u64::from(id) <= accepted {
                assert!(result.is_ok());
            } else {
                assert_eq!(result.err(), Some(CreateError::OutOfMemory));
            }
        }
        assert_eq!(map.len() as u64, accepted);
        assert_eq!(map.accounted_bytes(), accepted * bytes_per_resource);
    }

    #[test]
    fn gpu_resources_backing_map_replacement_and_detach_are_independent() {
        let mut map = ResourceMap::new();
        map.create(1, FORMATS[0], 2, 2).unwrap();
        map.create(2, FORMATS[1], 2, 2).unwrap();
        let shared = alloc::vec![(0x8000_1000, 4096), (0x8000_2000, 4096)];

        map.attach_backing(1, shared.clone()).unwrap();
        map.attach_backing(2, shared).unwrap();
        map.detach_backing(1).unwrap();
        assert!(map.get(1).unwrap().backing.is_empty());
        assert_eq!(
            map.get(2).unwrap().backing,
            [(0x8000_1000, 4096), (0x8000_2000, 4096)]
        );
        assert_eq!(map.detach_backing(99), Err(BackingError::InvalidResourceId));
    }

    #[test]
    fn gpu_resources_lifecycle_unref_returns_accounting_to_baseline() {
        let mut map = ResourceMap::new();
        let baseline = map.accounted_bytes();
        map.create(1, FORMATS[0], 8, 4).unwrap();
        map.attach_backing(1, alloc::vec![(0x8000_1000, 128)])
            .unwrap();
        map.detach_backing(1).unwrap();
        let removed = map.remove(1).unwrap();
        assert_eq!(removed.width, 8);
        assert!(removed.backing.is_empty());
        assert!(map.is_empty());
        assert_eq!(map.accounted_bytes(), baseline);
        assert_eq!(map.remove(1).err(), Some(UnrefError::InvalidResourceId));
    }

    #[test]
    fn gpu_resources_lifecycle_10k_create_unref_cycles_have_zero_net_growth() {
        let mut map = ResourceMap::new();
        let baseline = map.accounted_bytes();
        for id in 1..=10_000 {
            map.create(id, FORMATS[(id as usize - 1) % FORMATS.len()], 8, 8)
                .unwrap();
            let removed = map.remove(id).unwrap();
            assert_eq!(removed.host_pixels.len(), 64);
            assert_eq!(map.accounted_bytes(), baseline);
            assert!(map.is_empty());
        }
        assert_eq!(map.len(), 0);
        assert_eq!(map.accounted_bytes(), baseline);
    }

    fn source_bytes(width: u32, height: u32) -> alloc::vec::Vec<u8> {
        let mut bytes = alloc::vec::Vec::new();
        for pixel in 0..(width * height) {
            bytes.extend_from_slice(&(0xA500_0000u32 | pixel).to_le_bytes());
        }
        bytes
    }

    fn split_backing(
        base: u64,
        total: usize,
        lengths: &[u32],
    ) -> alloc::vec::Vec<(GuestAddr, u32)> {
        let mut offset = 0usize;
        let mut entries = alloc::vec::Vec::new();
        for &length in lengths {
            assert!(offset + length as usize <= total);
            entries.push((base + offset as u64, length));
            offset += length as usize;
        }
        assert_eq!(offset, total);
        entries
    }

    #[test]
    fn gpu_transfer_scatter_gather_copies_partial_odd_x_rows() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let width = 5;
        let height = 4;
        let source = source_bytes(width, height);
        let source_addr = DRAM_BASE + 0x10_000;
        bus.ram_mut().write_slice(source_addr, &source).unwrap();

        let mut map = ResourceMap::new();
        map.create(1, FORMATS[0], width, height).unwrap();
        map.attach_backing(
            1,
            split_backing(source_addr, source.len(), &[7, 13, 29, 31]),
        )
        .unwrap();
        let before = bus.ram().as_bytes().to_vec();
        map.transfer_to_host_2d(
            1,
            protocol::Rect {
                x: 1,
                y: 1,
                width: 3,
                height: 2,
            },
            0,
            &bus,
        )
        .unwrap();

        let resource = map.get(1).unwrap();
        for row in 0..height {
            for column in 0..width {
                let expected = if (1..3).contains(&row) && (1..4).contains(&column) {
                    0xA500_0000 | (row * width + column)
                } else {
                    0
                };
                assert_eq!(
                    resource.host_pixels[(row * width + column) as usize],
                    expected
                );
            }
        }
        assert_eq!(
            bus.ram().as_bytes(),
            before.as_slice(),
            "transfer is guest-read-only"
        );
    }

    #[test]
    fn gpu_transfer_one_byte_entries_copy_a_full_frame() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let width = 64;
        let height = 64;
        let source = source_bytes(width, height);
        let source_addr = DRAM_BASE + 0x20_000;
        bus.ram_mut().write_slice(source_addr, &source).unwrap();
        let entries = (0..source.len())
            .map(|offset| (source_addr + offset as u64, 1))
            .collect();

        let mut map = ResourceMap::new();
        map.create(1, FORMATS[0], width, height).unwrap();
        map.attach_backing(1, entries).unwrap();
        map.transfer_to_host_2d(
            1,
            protocol::Rect {
                x: 0,
                y: 0,
                width,
                height,
            },
            0,
            &bus,
        )
        .unwrap();

        let resource = map.get(1).unwrap();
        assert_eq!(resource.host_pixels[0], 0xA500_0000);
        assert_eq!(resource.host_pixels[4095], 0xA500_0FFF);
        assert_eq!(resource.host_pixels.len(), 4096);
    }

    #[cfg(feature = "std")]
    #[test]
    fn gpu_transfer_full_frame_native_budget() {
        let mut bus = SystemBus::new(Ram::new(8 * 1024 * 1024).unwrap());
        let width = 1280;
        let height = 800;
        let source = source_bytes(width, height);
        let source_addr = DRAM_BASE + 0x10_000;
        bus.ram_mut().write_slice(source_addr, &source).unwrap();

        let mut map = ResourceMap::new();
        map.create(1, FORMATS[0], width, height).unwrap();
        map.attach_backing(1, alloc::vec![(source_addr, source.len() as u32)])
            .unwrap();
        let started = std::time::Instant::now();
        map.transfer_to_host_2d(
            1,
            protocol::Rect {
                x: 0,
                y: 0,
                width,
                height,
            },
            0,
            &bus,
        )
        .unwrap();
        let elapsed = started.elapsed();
        eprintln!("1280x800 transfer: {elapsed:?}");
        #[cfg(not(debug_assertions))]
        assert!(
            elapsed < std::time::Duration::from_millis(5),
            "full-frame transfer exceeded 5 ms: {elapsed:?}"
        );
    }

    #[test]
    fn gpu_transfer_rejects_detached_bounds_and_offset_without_shadow_mutation() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let source_addr = DRAM_BASE + 0x30_000;
        let source = source_bytes(4, 4);
        bus.ram_mut().write_slice(source_addr, &source).unwrap();

        let mut map = ResourceMap::new();
        map.create(1, FORMATS[0], 4, 4).unwrap();
        map.attach_backing(1, alloc::vec![(source_addr, source.len() as u32)])
            .unwrap();
        for pixel in &mut map.get_mut(1).unwrap().host_pixels {
            *pixel = 0xDEAD_BEEF;
        }
        let baseline = map.get(1).unwrap().host_pixels.to_vec();

        for (rect, offset) in [
            (
                protocol::Rect {
                    x: 3,
                    y: 0,
                    width: 2,
                    height: 1,
                },
                0,
            ),
            (
                protocol::Rect {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                },
                source.len() as u64 - 1,
            ),
            (
                protocol::Rect {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                },
                u64::MAX,
            ),
        ] {
            assert_eq!(
                map.transfer_to_host_2d(1, rect, offset, &bus),
                Err(TransferError::InvalidParameter)
            );
            assert_eq!(
                map.get(1).unwrap().host_pixels.as_ref(),
                baseline.as_slice()
            );
        }

        map.detach_backing(1).unwrap();
        assert_eq!(
            map.transfer_to_host_2d(
                1,
                protocol::Rect {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                },
                0,
                &bus,
            ),
            Err(TransferError::InvalidParameter)
        );
        assert_eq!(
            map.get(1).unwrap().host_pixels.as_ref(),
            baseline.as_slice()
        );
    }

    #[test]
    fn gpu_transfer_random_rect_model_oracle_10k_cases() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let width = 8u32;
        let height = 8u32;
        let source = source_bytes(width, height);
        let source_addr = DRAM_BASE + 0x40_000;
        bus.ram_mut().write_slice(source_addr, &source).unwrap();

        let mut map = ResourceMap::new();
        map.create(1, FORMATS[0], width, height).unwrap();
        map.attach_backing(
            1,
            split_backing(source_addr, source.len(), &[3, 7, 11, 29, 41, 37, 128]),
        )
        .unwrap();

        for initial_seed in [0xC0DE_CAFE_u64, 0xBADC_0FFEu64, 0x5EED_1234_u64] {
            let mut seed = initial_seed;
            for _case in 0..10_000 {
                seed = seed
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                let x = (seed as u32) % 10;
                seed = seed.rotate_left(17);
                let y = (seed as u32) % 10;
                seed = seed.rotate_left(17);
                let rect_width = (seed as u32) % 10;
                seed = seed.rotate_left(17);
                let rect_height = (seed as u32) % 10;
                seed = seed.rotate_left(17);
                let offset = seed % (source.len() as u64 + 9);
                let rect = protocol::Rect {
                    x,
                    y,
                    width: rect_width,
                    height: rect_height,
                };

                for pixel in &mut map.get_mut(1).unwrap().host_pixels {
                    *pixel = 0xDEAD_BEEF;
                }
                let baseline = map.get(1).unwrap().host_pixels.to_vec();
                let in_bounds = u64::from(x) + u64::from(rect_width) <= u64::from(width)
                    && u64::from(y) + u64::from(rect_height) <= u64::from(height)
                    && offset <= source.len() as u64
                    && (rect_width == 0
                        || rect_height == 0
                        || offset
                            + u64::from(y) * u64::from(width) * 4
                            + u64::from(x) * 4
                            + u64::from(rect_height.saturating_sub(1)) * u64::from(width) * 4
                            + u64::from(rect_width) * 4
                            <= source.len() as u64);

                let result = map.transfer_to_host_2d(1, rect, offset, &bus);
                if !in_bounds {
                    assert_eq!(result, Err(TransferError::InvalidParameter));
                    assert_eq!(
                        map.get(1).unwrap().host_pixels.as_ref(),
                        baseline.as_slice()
                    );
                    continue;
                }

                assert_eq!(result, Ok(()));
                let mut expected = baseline;
                if rect_width != 0 && rect_height != 0 {
                    let first = offset + u64::from(y) * u64::from(width) * 4 + u64::from(x) * 4;
                    for row in 0..rect_height {
                        for column in 0..rect_width {
                            let source_offset = (first
                                + u64::from(row) * u64::from(width) * 4
                                + u64::from(column) * 4)
                                as usize;
                            let pixel = u32::from_le_bytes(
                                source[source_offset..source_offset + 4].try_into().unwrap(),
                            );
                            expected[((y + row) * width + x + column) as usize] = pixel;
                        }
                    }
                }
                assert_eq!(
                    map.get(1).unwrap().host_pixels.as_ref(),
                    expected.as_slice()
                );
            }
        }
    }

    #[test]
    fn gpu_transfer_tracks_changed_pixel_bounds_until_flush() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let width = 5u32;
        let height = 4u32;
        let source_addr = DRAM_BASE + 0x50_000;
        let full = protocol::Rect {
            x: 0,
            y: 0,
            width,
            height,
        };
        let mut source = source_bytes(width, height);
        bus.ram_mut().write_slice(source_addr, &source).unwrap();

        let mut map = ResourceMap::new();
        map.create(1, FORMATS[0], width, height).unwrap();
        map.attach_backing(1, alloc::vec![(source_addr, source.len() as u32)])
            .unwrap();
        map.transfer_to_host_2d(1, full, 0, &bus).unwrap();
        assert_eq!(map.get_mut(1).unwrap().flush_rect(full, true), full);
        assert_eq!(map.get(1).unwrap().dirty_tile_count(), 0);

        // Two changes make an odd-width, non-origin damage rectangle.
        set_pixel(&mut source, width, 1, 0, 0xCAFE_0101);
        set_pixel(&mut source, width, 3, 2, 0xCAFE_0302);
        bus.ram_mut().write_slice(source_addr, &source).unwrap();
        map.transfer_to_host_2d(1, full, 0, &bus).unwrap();
        assert_eq!(
            map.get_mut(1).unwrap().flush_rect(full, true),
            protocol::Rect {
                x: 1,
                y: 0,
                width: 3,
                height: 3,
            }
        );
        assert_eq!(map.get(1).unwrap().dirty_tile_count(), 0);

        // An edge-only update remains a one-pixel rectangle.
        set_pixel(&mut source, width, 4, 3, 0xCAFE_0403);
        bus.ram_mut().write_slice(source_addr, &source).unwrap();
        map.transfer_to_host_2d(1, full, 0, &bus).unwrap();
        assert_eq!(
            map.get_mut(1).unwrap().flush_rect(full, true),
            protocol::Rect {
                x: 4,
                y: 3,
                width: 1,
                height: 1,
            }
        );
        assert_eq!(map.get(1).unwrap().dirty_tile_count(), 0);

        // A narrow request cannot hide a pending change outside that request.
        set_pixel(&mut source, width, 0, 0, 0xCAFE_0000);
        bus.ram_mut().write_slice(source_addr, &source).unwrap();
        map.transfer_to_host_2d(1, full, 0, &bus).unwrap();
        assert_eq!(
            map.get_mut(1).unwrap().flush_rect(
                protocol::Rect {
                    x: 4,
                    y: 3,
                    width: 1,
                    height: 1,
                },
                true,
            ),
            full
        );

        // Identical transfers have no pending damage and preserve the exact odd-width request.
        map.transfer_to_host_2d(1, full, 0, &bus).unwrap();
        let odd_request = protocol::Rect {
            x: 1,
            y: 1,
            width: 3,
            height: 1,
        };
        assert_eq!(
            map.get_mut(1).unwrap().flush_rect(odd_request, true),
            odd_request
        );
    }

    #[test]
    fn gpu_transfer_tiled_and_full_frame_plans_keep_shadow_bytes_identical() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let width = 130u32;
        let height = 129u32;
        let source_addr = DRAM_BASE + 0x60_000;
        let source = source_bytes(width, height);
        bus.ram_mut().write_slice(source_addr, &source).unwrap();
        let backing = alloc::vec![(source_addr, source.len() as u32)];
        let full = protocol::Rect {
            x: 0,
            y: 0,
            width,
            height,
        };
        let transfers = [
            (
                protocol::Rect {
                    x: 1,
                    y: 1,
                    width: 1,
                    height: 1,
                },
                alloc::vec![protocol::Rect {
                    x: 0,
                    y: 0,
                    width: 64,
                    height: 64,
                }],
            ),
            (
                protocol::Rect {
                    x: 129,
                    y: 128,
                    width: 1,
                    height: 1,
                },
                alloc::vec![protocol::Rect {
                    x: 128,
                    y: 128,
                    width: 2,
                    height: 1,
                }],
            ),
            (
                protocol::Rect {
                    x: 63,
                    y: 63,
                    width: 2,
                    height: 2,
                },
                alloc::vec![
                    protocol::Rect {
                        x: 0,
                        y: 0,
                        width: 64,
                        height: 64,
                    },
                    protocol::Rect {
                        x: 64,
                        y: 0,
                        width: 64,
                        height: 64,
                    },
                    protocol::Rect {
                        x: 0,
                        y: 64,
                        width: 64,
                        height: 64,
                    },
                    protocol::Rect {
                        x: 64,
                        y: 64,
                        width: 64,
                        height: 64,
                    },
                ],
            ),
        ];

        let mut tiled = ResourceMap::new();
        tiled.create(1, FORMATS[0], width, height).unwrap();
        tiled.attach_backing(1, backing.clone()).unwrap();
        let mut full_frame = ResourceMap::new();
        full_frame.create(1, FORMATS[0], width, height).unwrap();
        full_frame.attach_backing(1, backing).unwrap();

        for (transfer, expected_tiles) in transfers {
            tiled.transfer_to_host_2d(1, transfer, 0, &bus).unwrap();
            full_frame
                .transfer_to_host_2d(1, transfer, 0, &bus)
                .unwrap();
            assert_eq!(
                tiled.get(1).unwrap().host_pixels,
                full_frame.get(1).unwrap().host_pixels,
                "tiling changed the resource shadow"
            );

            let tiled_plan = tiled
                .get_mut(1)
                .unwrap()
                .plan_uploads(&[full], UploadMode::Tiled)
                .unwrap();
            let full_plan = full_frame
                .get_mut(1)
                .unwrap()
                .plan_uploads(&[full], UploadMode::FullFrame)
                .unwrap();
            assert_eq!(tiled_plan.rects(), expected_tiles.as_slice());
            assert_eq!(full_plan.rects(), &[full]);
            assert_eq!(
                tiled_plan.stats().full_frame_bytes,
                full_plan.stats().full_frame_bytes
            );
            assert!(tiled_plan.stats().uploaded_bytes <= full_plan.stats().uploaded_bytes);
            assert_eq!(tiled.get(1).unwrap().dirty_tile_count(), 0);
            assert_eq!(full_frame.get(1).unwrap().dirty_tile_count(), 0);
        }
    }

    fn set_pixel(source: &mut [u8], width: u32, x: u32, y: u32, value: u32) {
        let offset = ((y * width + x) * core::mem::size_of::<u32>() as u32) as usize;
        source[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
}
