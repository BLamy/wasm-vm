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

/// The per-subsystem host-time accumulator the COLD paths write to during a run (E4-T01 phase 3).
///
/// It lives on the `SystemBus` — the seam the cold `load_device`/`store_device` MMIO dispatch and
/// the cold `walk_leaf` TLB-miss walk can reach without a borrow conflict against guest RAM or the
/// `Machine`'s [`ProfStats`]. Timing physically happens here (at the bus), so the accumulator lives
/// here; [`Machine::prof_report`](crate::Machine::prof_report) folds this snapshot into the final
/// report at report time — non-destructively, so the accumulation stays a single source of truth
/// and repeated reports are idempotent. Fixed `[u64; N]` array, same determinism discipline as the
/// irqstats counters.
#[derive(Clone)]
pub struct TimeAccum {
    /// Nanoseconds per subsystem, indexed by position in [`Subsystem::ALL`] (device time keyed by
    /// the accessed window's subsystem; page-walk time under [`Subsystem::MmuWalk`]).
    pub ns: [u64; Subsystem::ALL.len()],
    /// Page-table walks timed over the run (the report's walk denominator).
    pub walk_count: u64,
}

impl Default for TimeAccum {
    fn default() -> Self {
        Self::new()
    }
}

impl TimeAccum {
    /// A fresh, zeroed accumulator.
    pub const fn new() -> Self {
        Self {
            ns: [0; Subsystem::ALL.len()],
            walk_count: 0,
        }
    }

    /// Attribute `ns` nanoseconds to `sub` (saturating).
    #[inline]
    pub fn add_ns(&mut self, sub: Subsystem, ns: u64) {
        let idx = subsystem_index(sub);
        self.ns[idx] = self.ns[idx].saturating_add(ns);
    }

    /// Note one timed page-table walk.
    #[inline]
    pub fn note_walk(&mut self) {
        self.walk_count += 1;
    }
}

/// The index of `sub` in [`Subsystem::ALL`] — the position used by every fixed-array accumulator.
#[inline]
fn subsystem_index(sub: Subsystem) -> usize {
    Subsystem::ALL
        .iter()
        .position(|s| *s == sub)
        .expect("every Subsystem is in ALL")
}

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
        let idx = subsystem_index(sub);
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

    /// Assemble a [`ProfReport`] from THIS aggregate's own `add_ns`/`note_walk` accumulators — the
    /// phase-1 entry point (unit tests) and the shape the report takes when nothing external times
    /// the run. See [`Self::report_with_time`] for the wired path that folds in the bus's cold-path
    /// [`TimeAccum`].
    pub fn report(&self, total_ns: u64, top_k: usize) -> ProfReport {
        self.build_report(total_ns, top_k, &self.ns, self.walk_count)
    }

    /// Assemble a [`ProfReport`] folding an EXTERNAL per-subsystem time snapshot (`ns` + `walk_count`,
    /// the bus's [`TimeAccum`]) over this aggregate's histogram/sampling. This is the phase-3 wired
    /// path: device and page-walk nanoseconds are measured at the bus (the cold paths reach it),
    /// so they arrive here rather than through `add_ns`. Non-destructive (reads a borrowed snapshot,
    /// mutates nothing) — calling it twice yields the identical report, and CpuInterp is derived
    /// fresh each call, never double-subtracted.
    pub fn report_with_time(
        &self,
        total_ns: u64,
        top_k: usize,
        ns: &[u64; Subsystem::ALL.len()],
        walk_count: u64,
    ) -> ProfReport {
        self.build_report(total_ns, top_k, ns, walk_count)
    }

    /// Shared report builder. `ns`/`walk_count` are the per-subsystem time source (either this
    /// aggregate's own or the bus's snapshot). CPU-interp time is NOT measured directly — it is
    /// derived by SUBTRACTION: `total_ns − (sum of every other subsystem's ns)`, saturating at zero
    /// so it can never go negative. This is why the per-instruction hot loop reads the clock zero
    /// extra times (only the cold device/walk paths and the once-per-run total are timed); the
    /// honest cost is that CPU time's accuracy is bounded by that single total-span measurement.
    fn build_report(
        &self,
        total_ns: u64,
        top_k: usize,
        ns: &[u64; Subsystem::ALL.len()],
        walk_count: u64,
    ) -> ProfReport {
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
        let cpu_idx = subsystem_index(Subsystem::CpuInterp);
        // Everything NOT attributed to CpuInterp — the measured (device + walk) time.
        let attributed: u64 = ns
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != cpu_idx)
            .map(|(_, v)| *v)
            .fold(0u64, |a, v| a.saturating_add(v));
        let cpu_ns = total_ns.saturating_sub(attributed);
        let subsystem_ns = Subsystem::ALL
            .iter()
            .enumerate()
            .map(|(i, sub)| (*sub, if i == cpu_idx { cpu_ns } else { ns[i] }))
            .collect();
        ProfReport {
            top_regions,
            subsystem_ns,
            total_ns,
            sample_count: self.sample_count,
            walk_count,
            collisions: self.hist.collisions(),
        }
    }
}

#[cfg(test)]
mod tests;
