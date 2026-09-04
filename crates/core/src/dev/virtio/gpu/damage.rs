//! Bounded virtio-gpu damage rectangle accumulation (E5-T09a).
//!
//! The guest may submit many small transfers before a RESOURCE_FLUSH.  Keeping every rectangle
//! forever would make host memory depend on guest traffic, while immediately taking a full
//! bounding box destroys the small-update signal needed by later tile and presentation layers.
//! This accumulator keeps at most [`MAX_RECTS`] connected/disjoint rectangles and deliberately
//! collapses the next disjoint rectangle to one bounded box.

use super::protocol::Rect;

/// Maximum number of rectangles retained before the accumulator spills to one bounding box.
pub const MAX_RECTS: usize = 16;

/// A resource-sized, allocation-free damage accumulator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DamageAccumulator {
    width: u32,
    height: u32,
    rects: [Rect; MAX_RECTS],
    len: usize,
    collapsed: bool,
}

impl DamageAccumulator {
    /// Construct an empty accumulator for one immutable resource size.
    pub const fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            rects: [Rect {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            }; MAX_RECTS],
            len: 0,
            collapsed: false,
        }
    }

    /// Resource width used to clip future inserts.
    pub const fn width(&self) -> u32 {
        self.width
    }

    /// Resource height used to clip future inserts.
    pub const fn height(&self) -> u32 {
        self.height
    }

    /// Number of non-empty rectangles currently retained.
    pub const fn len(&self) -> usize {
        self.len
    }

    /// Whether the retained plan is the deliberate spill-to-bounding-box form.
    pub const fn is_collapsed(&self) -> bool {
        self.collapsed
    }

    /// Whether no damage has been recorded.
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Borrow the deterministic rectangle plan in insertion order.
    pub fn rects(&self) -> &[Rect] {
        &self.rects[..self.len]
    }

    /// Return the union of the retained plan, or `None` when it is empty.
    pub fn bounds(&self) -> Option<Rect> {
        self.rects().iter().copied().reduce(Self::union)
    }

    /// Remove all retained damage while preserving the resource dimensions.
    pub fn clear(&mut self) {
        self.len = 0;
        self.collapsed = false;
    }

    /// Take the current plan and leave this accumulator empty.
    pub fn take(&mut self) -> Self {
        let taken = *self;
        self.clear();
        taken
    }

    /// Add one rectangle after clipping it to the resource.
    ///
    /// Rectangles that overlap or share an edge are unioned.  A corner-only touch is left as two
    /// rectangles because their bounding box would introduce an unnecessary diagonal gap.  When a
    /// new disjoint rectangle would exceed [`MAX_RECTS`], all damage is collapsed to one box.
    /// Returns `false` only when clipping removes the entire input rectangle.
    pub fn push(&mut self, rect: Rect) -> bool {
        let Some(clipped) = self.clip(rect) else {
            return false;
        };

        if self.collapsed {
            self.rects[0] = Self::union(self.rects[0], clipped);
            return true;
        }

        let mut merged = clipped;
        let mut insert_at = self.len;
        let mut index = 0;
        while index < self.len {
            if Self::overlaps_or_shares_edge(self.rects[index], merged) {
                insert_at = insert_at.min(index);
                merged = Self::union(self.rects[index], merged);
                self.remove(index);
                // The enlarged union may now touch a rectangle that appeared earlier in the
                // array, so restart the bounded scan after every merge.
                index = 0;
            } else {
                index += 1;
            }
        }

        if self.len == MAX_RECTS {
            self.collapse_with(merged);
            return true;
        }

        self.insert(insert_at.min(self.len), merged);
        true
    }

    /// Compute the half-open union of two non-empty rectangles.
    pub fn union(left: Rect, right: Rect) -> Rect {
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

    /// Whether `inner` is completely covered by `outer` using widened edge arithmetic.
    pub fn contains(outer: Rect, inner: Rect) -> bool {
        u64::from(inner.x) >= u64::from(outer.x)
            && u64::from(inner.y) >= u64::from(outer.y)
            && u64::from(inner.x) + u64::from(inner.width)
                <= u64::from(outer.x) + u64::from(outer.width)
            && u64::from(inner.y) + u64::from(inner.height)
                <= u64::from(outer.y) + u64::from(outer.height)
    }

    fn clip(&self, rect: Rect) -> Option<Rect> {
        if rect.width == 0 || rect.height == 0 || rect.x >= self.width || rect.y >= self.height {
            return None;
        }
        let right = (u64::from(rect.x) + u64::from(rect.width)).min(u64::from(self.width));
        let bottom = (u64::from(rect.y) + u64::from(rect.height)).min(u64::from(self.height));
        if right <= u64::from(rect.x) || bottom <= u64::from(rect.y) {
            return None;
        }
        Some(Rect {
            x: rect.x,
            y: rect.y,
            width: (right - u64::from(rect.x)) as u32,
            height: (bottom - u64::from(rect.y)) as u32,
        })
    }

    fn overlaps_or_shares_edge(left: Rect, right: Rect) -> bool {
        let left_right = u64::from(left.x) + u64::from(left.width);
        let right_right = u64::from(right.x) + u64::from(right.width);
        let left_bottom = u64::from(left.y) + u64::from(left.height);
        let right_bottom = u64::from(right.y) + u64::from(right.height);
        let x_connected = u64::from(left.x) <= right_right && u64::from(right.x) <= left_right;
        let y_connected = u64::from(left.y) <= right_bottom && u64::from(right.y) <= left_bottom;
        let x_overlap = u64::from(left.x) < right_right && u64::from(right.x) < left_right;
        let y_overlap = u64::from(left.y) < right_bottom && u64::from(right.y) < left_bottom;
        x_connected && y_connected && (x_overlap || y_overlap)
    }

    fn remove(&mut self, index: usize) {
        for position in index..self.len.saturating_sub(1) {
            self.rects[position] = self.rects[position + 1];
        }
        self.len -= 1;
    }

    fn insert(&mut self, index: usize, rect: Rect) {
        for position in (index..self.len).rev() {
            self.rects[position + 1] = self.rects[position];
        }
        self.rects[index] = rect;
        self.len += 1;
    }

    fn collapse_with(&mut self, rect: Rect) {
        let bounds = self.rects().iter().copied().fold(rect, Self::union);
        self.rects[0] = bounds;
        self.len = 1;
        self.collapsed = true;
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

    #[test]
    fn overlapping_rectangles_union_and_contained_rectangles_do_not_expand() {
        let mut damage = DamageAccumulator::new(128, 128);
        assert!(damage.push(rect(10, 10, 20, 20)));
        assert!(damage.push(rect(20, 20, 20, 20)));
        assert_eq!(damage.rects(), &[rect(10, 10, 30, 30)]);
        assert!(damage.push(rect(15, 15, 2, 2)));
        assert_eq!(damage.rects(), &[rect(10, 10, 30, 30)]);
        assert!(!damage.is_collapsed());
    }

    #[test]
    fn edge_adjacent_rectangles_union_but_corner_only_rectangles_remain_separate() {
        let mut damage = DamageAccumulator::new(128, 128);
        assert!(damage.push(rect(0, 0, 8, 4)));
        assert!(damage.push(rect(8, 1, 4, 2)));
        assert_eq!(damage.rects(), &[rect(0, 0, 12, 4)]);

        damage.clear();
        assert!(damage.push(rect(0, 0, 4, 4)));
        assert!(damage.push(rect(4, 4, 4, 4)));
        assert_eq!(damage.len(), 2);
    }

    #[test]
    fn seventeenth_disjoint_rectangle_spills_to_one_bounded_box() {
        let mut damage = DamageAccumulator::new(128, 128);
        for index in 0..MAX_RECTS as u32 {
            assert!(damage.push(rect(index * 2, 0, 1, 1)));
        }
        assert_eq!(damage.len(), MAX_RECTS);
        assert!(!damage.is_collapsed());

        assert!(damage.push(rect(100, 100, 2, 3)));
        assert_eq!(damage.len(), 1);
        assert!(damage.is_collapsed());
        assert_eq!(damage.bounds(), Some(rect(0, 0, 102, 103)));

        assert!(damage.push(rect(127, 127, 4, 4)));
        assert_eq!(damage.bounds(), Some(rect(0, 0, 128, 128)));
    }

    #[test]
    fn clipping_and_empty_input_are_bounded_and_drain_is_empty() {
        let mut damage = DamageAccumulator::new(10, 8);
        assert!(!damage.push(rect(10, 0, 4, 4)));
        assert!(!damage.push(rect(0, 8, 4, 4)));
        assert!(!damage.push(rect(2, 2, 0, 4)));
        assert!(damage.push(rect(8, 6, 9, 9)));
        assert_eq!(damage.bounds(), Some(rect(8, 6, 2, 2)));

        let taken = damage.take();
        assert_eq!(taken.bounds(), Some(rect(8, 6, 2, 2)));
        assert!(damage.is_empty());
        assert_eq!((damage.width(), damage.height()), (10, 8));
    }

    #[test]
    fn seeded_random_rectangles_never_drop_reference_damage() {
        const WIDTH: u32 = 32;
        const HEIGHT: u32 = 24;
        const PIXELS: usize = (WIDTH * HEIGHT) as usize;

        fn next(seed: &mut u64) -> u32 {
            *seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (*seed >> 32) as u32
        }

        fn plan_covers_reference(plan: &DamageAccumulator, reference: &[bool; PIXELS]) {
            for y in 0..HEIGHT {
                for x in 0..WIDTH {
                    let index = (y * WIDTH + x) as usize;
                    if !reference[index] {
                        continue;
                    }
                    assert!(
                        plan.rects().iter().any(|rect| {
                            x >= rect.x
                                && x < rect.x + rect.width
                                && y >= rect.y
                                && y < rect.y + rect.height
                        }),
                        "reference pixel ({x}, {y}) was dropped from {plan:?}"
                    );
                }
            }
        }

        let mut damage = DamageAccumulator::new(WIDTH, HEIGHT);
        let mut reference = [false; PIXELS];
        let mut seed = 0x5eed_f00d_cafe_beef;

        for step in 0..10_000 {
            let input = rect(
                next(&mut seed) % 48,
                next(&mut seed) % 40,
                next(&mut seed) % 18,
                next(&mut seed) % 18,
            );
            let accepted = damage.push(input);

            let right = u64::from(input.x) + u64::from(input.width);
            let bottom = u64::from(input.y) + u64::from(input.height);
            let clipped = input.width > 0
                && input.height > 0
                && input.x < WIDTH
                && input.y < HEIGHT
                && right.min(u64::from(WIDTH)) > u64::from(input.x)
                && bottom.min(u64::from(HEIGHT)) > u64::from(input.y);
            assert_eq!(accepted, clipped, "clip result changed at step {step}");

            if clipped {
                let clipped_right = right.min(u64::from(WIDTH)) as u32;
                let clipped_bottom = bottom.min(u64::from(HEIGHT)) as u32;
                for y in input.y..clipped_bottom {
                    for x in input.x..clipped_right {
                        reference[(y * WIDTH + x) as usize] = true;
                    }
                }
            }
            plan_covers_reference(&damage, &reference);

            if step % 211 == 210 {
                let taken = damage.take();
                plan_covers_reference(&taken, &reference);
                assert_eq!((taken.width(), taken.height()), (WIDTH, HEIGHT));
                assert!(damage.is_empty());
                reference.fill(false);
            }
        }
    }
}
