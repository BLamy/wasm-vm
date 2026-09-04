//! Bounded 64x64 dirty-tile planning for virtio-gpu resources (E5-T09b).
//!
//! Transfers mark the tiles touched by a successful guest copy.  A later coalesced flush selects
//! only dirty tiles intersecting its rectangles, clips edge tiles to the resource, and clears
//! exactly the tiles represented by the returned upload plan.  The full-frame mode is an explicit
//! A/B path for correctness comparisons and reports the same byte budget as the tiled path.

use alloc::vec::Vec;

use super::protocol::Rect;

/// Width and height of one upload tile in resource pixels.
pub const TILE_SIZE: u32 = 64;
const WORD_BITS: usize = u64::BITS as usize;
const BYTES_PER_PIXEL: u64 = core::mem::size_of::<u32>() as u64;

/// Failure while constructing or materializing a bounded tile plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TilePlannerError {
    /// Resource dimensions must both be non-zero.
    InvalidDimensions,
    /// The bounded bitmap or returned plan could not be reserved.
    OutOfMemory,
}

/// Select the normal tiled upload path or the diagnostic full-frame A/B path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadMode {
    /// Upload each dirty 64x64 tile intersecting the flush plan.
    Tiled,
    /// Upload the entire resource for each non-empty flush plan.
    FullFrame,
}

/// Stable counters returned with every upload plan.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct UploadStats {
    /// Number of selected tiles. Full-frame plans report the complete grid count.
    pub selected_tiles: u32,
    /// Bytes represented by the upload regions in this plan.
    pub uploaded_bytes: u64,
    /// Bytes in one full resource-sized upload, useful for A/B comparisons.
    pub full_frame_bytes: u64,
}

/// The deterministic upload regions selected by one flush.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TileUploadPlan {
    rects: Vec<Rect>,
    stats: UploadStats,
    mode: UploadMode,
}

impl TileUploadPlan {
    /// Borrow selected regions in row-major tile order.
    pub fn rects(&self) -> &[Rect] {
        &self.rects
    }

    /// Return the aggregate counters for this plan.
    pub const fn stats(&self) -> UploadStats {
        self.stats
    }

    /// Return whether this plan came from tiled or full-frame mode.
    pub const fn mode(&self) -> UploadMode {
        self.mode
    }

    /// Whether this flush selected no upload regions.
    pub fn is_empty(&self) -> bool {
        self.rects.is_empty()
    }

    /// Return a conservative bounding rectangle for consumers that still accept one region.
    pub fn bounds(&self) -> Option<Rect> {
        self.rects.iter().copied().reduce(union)
    }
}

/// Allocation-bounded dirty bitmap for one resource's 64x64 tile grid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirtyTilePlanner {
    width: u32,
    height: u32,
    tiles_x: u32,
    tiles_y: u32,
    bits: Vec<u64>,
    dirty_count: u32,
}

impl DirtyTilePlanner {
    /// Construct a planner, panicking only for invalid dimensions or an impossible host reserve.
    /// Resource creation uses [`Self::try_new`] so guest-controlled sizes remain fallible.
    pub fn new(width: u32, height: u32) -> Self {
        Self::try_new(width, height).expect("valid resource tile planner allocation")
    }

    /// Construct a planner without panicking on a guest-controlled allocation.
    pub fn try_new(width: u32, height: u32) -> Result<Self, TilePlannerError> {
        if width == 0 || height == 0 {
            return Err(TilePlannerError::InvalidDimensions);
        }
        let tiles_x = tile_axis(width);
        let tiles_y = tile_axis(height);
        let tile_count = u64::from(tiles_x) * u64::from(tiles_y);
        let word_count = usize::try_from(tile_count.div_ceil(WORD_BITS as u64))
            .map_err(|_| TilePlannerError::OutOfMemory)?;
        let mut bits = Vec::new();
        bits.try_reserve_exact(word_count)
            .map_err(|_| TilePlannerError::OutOfMemory)?;
        bits.resize(word_count, 0);
        Ok(Self {
            width,
            height,
            tiles_x,
            tiles_y,
            bits,
            dirty_count: 0,
        })
    }

    /// Resource width used to clip tile edges.
    pub const fn width(&self) -> u32 {
        self.width
    }

    /// Resource height used to clip tile edges.
    pub const fn height(&self) -> u32 {
        self.height
    }

    /// Number of tiles across the resource.
    pub const fn tiles_x(&self) -> u32 {
        self.tiles_x
    }

    /// Number of tiles down the resource.
    pub const fn tiles_y(&self) -> u32 {
        self.tiles_y
    }

    /// Total number of tiles in the resource grid.
    pub const fn tile_count(&self) -> u32 {
        self.tiles_x * self.tiles_y
    }

    /// Number of currently dirty tiles.
    pub const fn dirty_tile_count(&self) -> u32 {
        self.dirty_count
    }

    /// Whether no dirty tile is pending.
    pub const fn is_empty(&self) -> bool {
        self.dirty_count == 0
    }

    /// Drop all dirty state without changing the resource dimensions.
    pub fn clear(&mut self) {
        for word in &mut self.bits {
            *word = 0;
        }
        self.dirty_count = 0;
    }

    /// Consume dirty tiles intersecting a flush without materializing upload rectangles.
    ///
    /// This is used by the legacy single-rectangle sink path, which has no tile-plan consumer but
    /// must still retire the bounded dirty state after a successful flush.
    pub(crate) fn clear_intersecting(&mut self, flush_rects: &[Rect]) -> u32 {
        let mut cleared = 0;
        for tile_y in 0..self.tiles_y {
            for tile_x in 0..self.tiles_x {
                let index = self.index(tile_x, tile_y);
                let rect = self.tile_rect(tile_x, tile_y);
                if self.is_dirty_index(index) && intersects_any(rect, flush_rects) {
                    self.clear_index(index);
                    cleared += 1;
                }
            }
        }
        cleared
    }

    /// Resize the grid and intentionally discard dirty state from the old resource dimensions.
    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), TilePlannerError> {
        let replacement = Self::try_new(width, height)?;
        *self = replacement;
        Ok(())
    }

    /// Mark every tile touched by a rectangle after clipping it to the resource.
    ///
    /// Returns the number of tiles that changed from clean to dirty.  A zero-sized or wholly
    /// out-of-bounds rectangle returns zero and never indexes the bitmap.
    pub fn mark_rect(&mut self, rect: Rect) -> u32 {
        let Some((left, top, right, bottom)) = self.clip(rect) else {
            return 0;
        };
        let first_x = left / TILE_SIZE;
        let last_x = (right - 1) / TILE_SIZE;
        let first_y = top / TILE_SIZE;
        let last_y = (bottom - 1) / TILE_SIZE;
        let mut newly_dirty = 0;
        for tile_y in first_y..=last_y {
            for tile_x in first_x..=last_x {
                if self.set(tile_x, tile_y) {
                    newly_dirty += 1;
                }
            }
        }
        newly_dirty
    }

    /// Mark one resource pixel's containing tile.
    pub fn mark_pixel(&mut self, x: u32, y: u32) -> bool {
        self.mark_rect(Rect {
            x,
            y,
            width: 1,
            height: 1,
        }) != 0
    }

    /// Select and consume dirty tiles intersecting a coalesced flush plan.
    ///
    /// The returned regions are resource-bounded and row-major.  Tiled mode clears only selected
    /// tiles.  Full-frame mode emits one resource-sized region and clears every dirty tile because
    /// the whole shadow was uploaded.  Allocation failure happens before any bit is cleared.
    pub fn plan(
        &mut self,
        flush_rects: &[Rect],
        mode: UploadMode,
    ) -> Result<TileUploadPlan, TilePlannerError> {
        let full_frame_bytes = self.full_frame_bytes();
        if !flush_rects.iter().any(|rect| self.clip(*rect).is_some()) {
            return Ok(TileUploadPlan {
                rects: Vec::new(),
                stats: UploadStats {
                    full_frame_bytes,
                    ..UploadStats::default()
                },
                mode,
            });
        }

        if mode == UploadMode::FullFrame {
            let mut rects = Vec::new();
            rects
                .try_reserve_exact(1)
                .map_err(|_| TilePlannerError::OutOfMemory)?;
            rects.push(self.resource_rect());
            self.clear();
            return Ok(TileUploadPlan {
                rects,
                stats: UploadStats {
                    selected_tiles: self.tile_count(),
                    uploaded_bytes: full_frame_bytes,
                    full_frame_bytes,
                },
                mode,
            });
        }

        let mut selected_count = 0usize;
        for tile_y in 0..self.tiles_y {
            for tile_x in 0..self.tiles_x {
                let index = self.index(tile_x, tile_y);
                let rect = self.tile_rect(tile_x, tile_y);
                if self.is_dirty_index(index) && intersects_any(rect, flush_rects) {
                    selected_count += 1;
                }
            }
        }
        let mut rects = Vec::new();
        rects
            .try_reserve_exact(selected_count)
            .map_err(|_| TilePlannerError::OutOfMemory)?;
        let mut uploaded_bytes = 0;
        for tile_y in 0..self.tiles_y {
            for tile_x in 0..self.tiles_x {
                let index = self.index(tile_x, tile_y);
                let rect = self.tile_rect(tile_x, tile_y);
                if !self.is_dirty_index(index) || !intersects_any(rect, flush_rects) {
                    continue;
                }
                rects.push(rect);
                uploaded_bytes += rect_bytes(rect);
                self.clear_index(index);
            }
        }
        Ok(TileUploadPlan {
            stats: UploadStats {
                selected_tiles: rects.len() as u32,
                uploaded_bytes,
                full_frame_bytes,
            },
            rects,
            mode,
        })
    }

    fn full_frame_bytes(&self) -> u64 {
        u64::from(self.width) * u64::from(self.height) * BYTES_PER_PIXEL
    }

    fn resource_rect(&self) -> Rect {
        Rect {
            x: 0,
            y: 0,
            width: self.width,
            height: self.height,
        }
    }

    fn tile_rect(&self, tile_x: u32, tile_y: u32) -> Rect {
        let x = tile_x * TILE_SIZE;
        let y = tile_y * TILE_SIZE;
        Rect {
            x,
            y,
            width: (self.width - x).min(TILE_SIZE),
            height: (self.height - y).min(TILE_SIZE),
        }
    }

    fn clip(&self, rect: Rect) -> Option<(u32, u32, u32, u32)> {
        if rect.width == 0 || rect.height == 0 || rect.x >= self.width || rect.y >= self.height {
            return None;
        }
        let right = (u64::from(rect.x) + u64::from(rect.width)).min(u64::from(self.width));
        let bottom = (u64::from(rect.y) + u64::from(rect.height)).min(u64::from(self.height));
        if right <= u64::from(rect.x) || bottom <= u64::from(rect.y) {
            return None;
        }
        Some((rect.x, rect.y, right as u32, bottom as u32))
    }

    fn index(&self, tile_x: u32, tile_y: u32) -> usize {
        (tile_y * self.tiles_x + tile_x) as usize
    }

    fn is_dirty_index(&self, index: usize) -> bool {
        self.bits[index / WORD_BITS] & (1u64 << (index % WORD_BITS)) != 0
    }

    fn set(&mut self, tile_x: u32, tile_y: u32) -> bool {
        let index = self.index(tile_x, tile_y);
        let word = &mut self.bits[index / WORD_BITS];
        let mask = 1u64 << (index % WORD_BITS);
        if *word & mask != 0 {
            return false;
        }
        *word |= mask;
        self.dirty_count += 1;
        true
    }

    fn clear_index(&mut self, index: usize) {
        let word = &mut self.bits[index / WORD_BITS];
        let mask = 1u64 << (index % WORD_BITS);
        if *word & mask != 0 {
            *word &= !mask;
            self.dirty_count -= 1;
        }
    }
}

fn tile_axis(dimension: u32) -> u32 {
    (dimension - 1) / TILE_SIZE + 1
}

fn rect_bytes(rect: Rect) -> u64 {
    u64::from(rect.width) * u64::from(rect.height) * BYTES_PER_PIXEL
}

fn intersects_any(tile: Rect, flush_rects: &[Rect]) -> bool {
    flush_rects
        .iter()
        .copied()
        .any(|flush| intersects(tile, flush))
}

fn intersects(left: Rect, right: Rect) -> bool {
    let left_right = u64::from(left.x) + u64::from(left.width);
    let right_right = u64::from(right.x) + u64::from(right.width);
    let left_bottom = u64::from(left.y) + u64::from(left.height);
    let right_bottom = u64::from(right.y) + u64::from(right.height);
    left.width != 0
        && left.height != 0
        && right.width != 0
        && right.height != 0
        && u64::from(left.x) < right_right
        && u64::from(right.x) < left_right
        && u64::from(left.y) < right_bottom
        && u64::from(right.y) < left_bottom
}

fn union(left: Rect, right: Rect) -> Rect {
    let x = left.x.min(right.x);
    let y = left.y.min(right.y);
    let right_edge = (u64::from(left.x) + u64::from(left.width))
        .max(u64::from(right.x) + u64::from(right.width));
    let bottom_edge = (u64::from(left.y) + u64::from(left.height))
        .max(u64::from(right.y) + u64::from(right.height));
    Rect {
        x,
        y,
        width: (right_edge - u64::from(x)) as u32,
        height: (bottom_edge - u64::from(y)) as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: u32, y: u32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    fn expected_tile_rects(
        width: u32,
        height: u32,
        dirty: &[bool],
        flush: Rect,
    ) -> alloc::vec::Vec<Rect> {
        let tiles_x = tile_axis(width);
        let tiles_y = tile_axis(height);
        let mut expected = alloc::vec::Vec::new();
        for tile_y in 0..tiles_y {
            for tile_x in 0..tiles_x {
                let index = (tile_y * tiles_x + tile_x) as usize;
                let tile = rect(
                    tile_x * TILE_SIZE,
                    tile_y * TILE_SIZE,
                    (width - tile_x * TILE_SIZE).min(TILE_SIZE),
                    (height - tile_y * TILE_SIZE).min(TILE_SIZE),
                );
                if dirty[index] && intersects(tile, flush) {
                    expected.push(tile);
                }
            }
        }
        expected
    }

    fn mark_reference(width: u32, height: u32, dirty: &mut [bool], input: Rect) {
        if input.width == 0 || input.height == 0 || input.x >= width || input.y >= height {
            return;
        }
        let right = (u64::from(input.x) + u64::from(input.width)).min(u64::from(width)) as u32;
        let bottom = (u64::from(input.y) + u64::from(input.height)).min(u64::from(height)) as u32;
        let tiles_x = tile_axis(width);
        for y in input.y..bottom {
            for x in input.x..right {
                dirty[(y / TILE_SIZE * tiles_x + x / TILE_SIZE) as usize] = true;
            }
        }
    }

    fn clear_selected_reference(width: u32, height: u32, dirty: &mut [bool], selected: &[Rect]) {
        let tiles_x = tile_axis(width);
        for tile in selected {
            let tile_x = tile.x / TILE_SIZE;
            let tile_y = tile.y / TILE_SIZE;
            let index = (tile_y * tiles_x + tile_x) as usize;
            dirty[index] = false;
        }
        assert_eq!(dirty.len(), (tile_axis(width) * tile_axis(height)) as usize);
    }

    fn next(seed: &mut u64) -> u32 {
        *seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (*seed >> 32) as u32
    }

    #[test]
    fn one_pixel_transfer_selects_one_full_tile_and_exact_bytes() {
        let mut planner = DirtyTilePlanner::new(128, 128);
        assert_eq!(planner.mark_rect(rect(1, 2, 1, 1)), 1);
        let plan = planner
            .plan(&[rect(0, 0, 128, 128)], UploadMode::Tiled)
            .unwrap();
        assert_eq!(plan.mode(), UploadMode::Tiled);
        assert_eq!(plan.rects(), &[rect(0, 0, 64, 64)]);
        assert_eq!(
            plan.stats(),
            UploadStats {
                selected_tiles: 1,
                uploaded_bytes: 64 * 64 * 4,
                full_frame_bytes: 128 * 128 * 4,
            }
        );
        assert!(planner.is_empty());
        assert!(
            planner
                .plan(&[rect(0, 0, 128, 128)], UploadMode::Tiled)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn full_resource_transfer_selects_every_tile_in_row_major_order() {
        let mut planner = DirtyTilePlanner::new(128, 128);
        assert_eq!(planner.mark_rect(rect(0, 0, 128, 128)), 4);
        let plan = planner
            .plan(&[rect(0, 0, 128, 128)], UploadMode::Tiled)
            .unwrap();
        assert_eq!(
            plan.rects(),
            &[
                rect(0, 0, 64, 64),
                rect(64, 0, 64, 64),
                rect(0, 64, 64, 64),
                rect(64, 64, 64, 64),
            ]
        );
        assert_eq!(plan.stats().selected_tiles, 4);
        assert_eq!(plan.stats().uploaded_bytes, 128 * 128 * 4);
        assert!(planner.is_empty());
    }

    #[test]
    fn tile_boundaries_and_partial_edges_are_clipped_without_outside_regions() {
        let mut planner = DirtyTilePlanner::new(130, 129);
        assert_eq!(planner.mark_rect(rect(63, 63, 2, 2)), 4);
        assert_eq!(planner.mark_rect(rect(129, 128, 1, 1)), 1);
        let plan = planner
            .plan(&[rect(0, 0, 130, 129)], UploadMode::Tiled)
            .unwrap();
        assert_eq!(
            plan.rects(),
            &[
                rect(0, 0, 64, 64),
                rect(64, 0, 64, 64),
                rect(0, 64, 64, 64),
                rect(64, 64, 64, 64),
                rect(128, 128, 2, 1),
            ]
        );
        assert_eq!(plan.stats().uploaded_bytes, 4 * 64 * 64 * 4 + 2 * 4);
        assert!(
            plan.rects()
                .iter()
                .all(|tile| { tile.x + tile.width <= 130 && tile.y + tile.height <= 129 })
        );
    }

    #[test]
    fn flush_intersection_consumes_only_selected_tiles_and_resize_drops_old_state() {
        let mut planner = DirtyTilePlanner::new(128, 128);
        planner.mark_rect(rect(1, 1, 1, 1));
        planner.mark_rect(rect(100, 100, 1, 1));
        let first = planner
            .plan(&[rect(0, 0, 64, 64)], UploadMode::Tiled)
            .unwrap();
        assert_eq!(first.rects(), &[rect(0, 0, 64, 64)]);
        assert_eq!(planner.dirty_tile_count(), 1);
        let second = planner
            .plan(&[rect(0, 0, 128, 128)], UploadMode::Tiled)
            .unwrap();
        assert_eq!(second.rects(), &[rect(64, 64, 64, 64)]);
        assert!(planner.is_empty());

        planner.mark_rect(rect(1, 1, 1, 1));
        planner.resize(65, 65).unwrap();
        assert!(planner.is_empty());
        planner.mark_rect(rect(64, 64, 1, 1));
        let resized = planner
            .plan(&[rect(0, 0, 65, 65)], UploadMode::Tiled)
            .unwrap();
        assert_eq!(resized.rects(), &[rect(64, 64, 1, 1)]);
        assert_eq!(resized.stats().uploaded_bytes, 4);
    }

    #[test]
    fn full_frame_mode_is_a_comparable_bounded_fallback() {
        let mut planner = DirtyTilePlanner::new(130, 129);
        planner.mark_pixel(1, 1);
        let plan = planner
            .plan(&[rect(1, 1, 1, 1)], UploadMode::FullFrame)
            .unwrap();
        assert_eq!(plan.mode(), UploadMode::FullFrame);
        assert_eq!(plan.rects(), &[rect(0, 0, 130, 129)]);
        assert_eq!(plan.stats().selected_tiles, 9);
        assert_eq!(plan.stats().uploaded_bytes, 130 * 129 * 4);
        assert_eq!(plan.stats().full_frame_bytes, 130 * 129 * 4);
        assert!(planner.is_empty());

        let empty = planner.plan(&[], UploadMode::FullFrame).unwrap();
        assert!(empty.is_empty());
        assert_eq!(empty.stats().full_frame_bytes, 130 * 129 * 4);
    }

    #[test]
    fn seeded_random_transfer_flush_resize_sequences_match_reference_tiles() {
        let mut seed = 0xD17E_511E_5EED_u64;
        let mut width = 1 + next(&mut seed) % 193;
        let mut height = 1 + next(&mut seed) % 181;
        let mut planner = DirtyTilePlanner::new(width, height);
        let mut dirty = alloc::vec![false; (tile_axis(width) * tile_axis(height)) as usize];

        for step in 0..10_000 {
            if step != 0 && step % 173 == 0 {
                width = 1 + next(&mut seed) % 193;
                height = 1 + next(&mut seed) % 181;
                planner.resize(width, height).unwrap();
                dirty = alloc::vec![false; (tile_axis(width) * tile_axis(height)) as usize];
            }

            let input = rect(
                next(&mut seed) % (width + 96),
                next(&mut seed) % (height + 96),
                next(&mut seed) % 96,
                next(&mut seed) % 96,
            );
            if next(&mut seed) & 1 == 0 {
                let before = dirty.iter().filter(|value| **value).count() as u32;
                let marked = planner.mark_rect(input);
                mark_reference(width, height, &mut dirty, input);
                let after = dirty.iter().filter(|value| **value).count() as u32;
                assert_eq!(marked, after - before, "dirty count at step {step}");
                assert_eq!(
                    planner.dirty_tile_count(),
                    after,
                    "bitmap count at step {step}"
                );
            } else {
                let expected = expected_tile_rects(width, height, &dirty, input);
                let plan = planner.plan(&[input], UploadMode::Tiled).unwrap();
                assert_eq!(
                    plan.rects(),
                    expected.as_slice(),
                    "tile plan at step {step}"
                );
                assert_eq!(
                    plan.stats().selected_tiles,
                    expected.len() as u32,
                    "selected count at step {step}"
                );
                let expected_bytes = expected.iter().map(|tile| rect_bytes(*tile)).sum();
                assert_eq!(
                    plan.stats().uploaded_bytes,
                    expected_bytes,
                    "bytes at step {step}"
                );
                assert_eq!(
                    plan.stats().full_frame_bytes,
                    u64::from(width) * u64::from(height) * 4
                );
                clear_selected_reference(width, height, &mut dirty, &expected);
                assert_eq!(
                    planner.dirty_tile_count(),
                    dirty.iter().filter(|value| **value).count() as u32,
                    "post-flush count at step {step}"
                );
            }
        }
    }
}
