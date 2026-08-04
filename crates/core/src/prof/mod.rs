//! Profiling infrastructure (E4-T01): a fixed-memory hot-PC histogram, an injected monotonic host
//! timer, and per-subsystem time accounting, assembled into a [`report::ProfReport`].
//!
//! Like [`crate::diag::irqstats`] this is pure `no_std` + `alloc` core logic — always compiled,
//! never JS/host-facing. Phase 1 defines and unit-tests the aggregate [`ProfStats`]; wiring it onto
//! the `Machine` (sampling in the run loop, timing the device services) is a LATER phase, so
//! nothing here touches the hart, bus, mmu, or `Machine`.

pub mod clock;
pub mod histogram;
pub mod report;

pub use clock::{FixedTimer, HostTimer};
pub use histogram::HotHistogram;
pub use report::{HotRegion, ProfReport, Subsystem};

/// The aggregate a later phase will own on `Machine`: the hot-PC histogram plus a per-subsystem
/// nanosecond accumulator plus the sampling/walk counters. Phase 1 defines the shape and its
/// arithmetic; the run loop will drive `record_pc` / `add_ns` / `note_walk` later.
pub struct ProfStats {
    /// The fixed-memory hot-PC histogram (see [`histogram`]).
    hist: HotHistogram,
    /// Nanoseconds attributed per subsystem, indexed by position in [`Subsystem::ALL`] (fixed
    /// array — the same discipline the irqstats counters use).
    ns: [u64; Subsystem::ALL.len()],
    /// Total PC samples fed to the histogram (mirrors `hist.samples()`, kept separately as the
    /// report's denominator so the field is explicit).
    sample_count: u64,
    /// Page-table walks noted over the run.
    walk_count: u64,
}

impl Default for ProfStats {
    fn default() -> Self {
        Self::new()
    }
}

impl ProfStats {
    /// A fresh, empty aggregate.
    pub fn new() -> Self {
        Self {
            hist: HotHistogram::new(),
            ns: [0; Subsystem::ALL.len()],
            sample_count: 0,
            walk_count: 0,
        }
    }

    /// Record one PC sample (buckets into the histogram; bumps the denominator).
    #[inline]
    pub fn record_pc(&mut self, phys_pc: u64) {
        self.hist.record(phys_pc);
        self.sample_count += 1;
    }

    /// Attribute `ns` nanoseconds to `sub` (saturating; the index is the variant's position in
    /// [`Subsystem::ALL`]).
    #[inline]
    pub fn add_ns(&mut self, sub: Subsystem, ns: u64) {
        let idx = Subsystem::ALL
            .iter()
            .position(|s| *s == sub)
            .expect("every Subsystem is in ALL");
        self.ns[idx] = self.ns[idx].saturating_add(ns);
    }

    /// Note one page-table walk.
    #[inline]
    pub fn note_walk(&mut self) {
        self.walk_count += 1;
    }

    /// The raw histogram (for tests / direct inspection).
    pub fn histogram(&self) -> &HotHistogram {
        &self.hist
    }

    /// Assemble a [`ProfReport`]: the top `top_k` hot regions (with percentages against the sample
    /// count), the per-subsystem times, and `total_ns` passed straight through as the profiled
    /// span the caller measured.
    pub fn report(&self, total_ns: u64, top_k: usize) -> ProfReport {
        let denom = self.sample_count.max(1) as f64; // guard div-by-zero on an empty profile
        let top_regions = self
            .hist
            .top(top_k)
            .into_iter()
            .map(|(phys_pc, samples)| HotRegion {
                phys_pc,
                samples,
                pct: samples as f64 / denom * 100.0,
            })
            .collect();
        let subsystem_ns = Subsystem::ALL
            .iter()
            .enumerate()
            .map(|(i, sub)| (*sub, self.ns[i]))
            .collect();
        ProfReport {
            top_regions,
            subsystem_ns,
            total_ns,
            sample_count: self.sample_count,
            walk_count: self.walk_count,
            collisions: self.hist.collisions(),
        }
    }
}

#[cfg(test)]
mod tests;
