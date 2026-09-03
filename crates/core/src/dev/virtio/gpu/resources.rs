//! Host-owned virtio-gpu 2D resources (E5-T02a).
//!
//! A resource owns a linear host shadow buffer.  The map accounts only the pixel buffers, which
//! is the bounded quantity that a hostile guest can grow through `RESOURCE_CREATE_2D`; descriptor
//! backing metadata is added by the later attach slice.  All validation happens before the first
//! pixel allocation so rejected requests are side-effect free.

use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

use super::protocol;

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
}

impl Resource {
    /// Number of bytes in the host shadow buffer.
    pub fn accounted_bytes(&self) -> u64 {
        (self.host_pixels.len() as u64) * core::mem::size_of::<u32>() as u64
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
}
