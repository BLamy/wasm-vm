//! E4-T21: execution-thread pause instrumentation for the JIT compile pipeline.
//!
//! The load-bearing pause target (`docs/jit-architecture.md` §7 D10) is **< 5 ms per JIT-attributable
//! main-thread stall**. This module is the honest measurement of that: every time the execution
//! thread does JIT work that is NOT interpreting the guest — draining the compile queue, validating a
//! nomination against live memory, batching, and INSTALLING a compiled batch (the only step allowed
//! to touch execution-thread state) — it records the stall here as one sample.
//!
//! Two signals are kept because two things must be true:
//!
//! * **Time** (`ns` samples): the real ≤5 ms wall assertion, populated only when a host timer is
//!   injected (the booted-guest histogram is dev debt — see the ticket). `max_ns`, `sum_ns`, and a
//!   coarse power-of-two bucket array give p50/p95/p100 without unbounded storage.
//! * **Work** (`blocks`/`bytes` per install step): a HEADLESS, deterministic bound — the install step
//!   is cheap by construction (table writes + a map insert per block), so a unit test can assert
//!   `max_submitted_blocks` never exceeds the per-pump submission budget without needing a wall clock. This
//!   is the "install-step work is bounded" assertion the ticket asks for as the headless stand-in.
//!
//! Pure `no_std` + `alloc`-free fixed arrays, same determinism discipline as the irqstats counters.

/// Number of power-of-two duration buckets: bucket `b` counts pauses in `[2^b, 2^(b+1))` nanoseconds,
/// with the final bucket absorbing everything at or above `2^(LEN-1)` ns (~1.15 s), so no pause is
/// ever unbucketed. Covers sub-ns … multi-second, which brackets the 5 ms (≈2^22 ns) target.
pub const PAUSE_BUCKETS: usize = 32;

/// The 5 ms pause target expressed in nanoseconds (`docs/jit-architecture.md` §7 D10). Any recorded
/// pause `> PAUSE_TARGET_NS` is counted in `over_target` — the p100 refutation signal.
pub const PAUSE_TARGET_NS: u64 = 5_000_000;

/// A fixed-memory summary of JIT-attributable execution-thread stalls (E4-T21 deliverable 2).
///
/// Sampled continuously by [`crate::Machine::pump_jit_translations`]. Non-destructive to read; the
/// percentile queries walk the bucket array so a report needs no sort and no heap.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JitPauseStats {
    /// Total pause samples recorded (every compile-queue drain that did any work is one sample).
    pub count: u64,
    /// Largest single pause seen, in nanoseconds (p100 wall — the ≤5 ms AC's headline number).
    pub max_ns: u64,
    /// Sum of all pause nanoseconds (÷ `count` = mean; also the total JIT tax on the exec thread).
    pub sum_ns: u64,
    /// Pauses whose duration exceeded [`PAUSE_TARGET_NS`] — non-zero refutes the 5 ms target.
    pub over_target: u64,
    /// Power-of-two duration histogram (see [`PAUSE_BUCKETS`]); the percentile source.
    pub buckets: [u64; PAUSE_BUCKETS],
    /// Largest number of queued translation requests examined in one pump, including requests later
    /// refused as stale or missing from the decoded cache.
    pub max_attempted_blocks: u64,
    /// Cumulative queued translation requests examined through the timed path.
    pub total_attempted_blocks: u64,
    /// Largest number of validated blocks submitted to the executor in one step. An executor may
    /// skip duplicates or translation/module failures, so actual compiled truth remains its
    /// `compiled_count`; this is the conservative synchronous-work bound.
    pub max_submitted_blocks: u64,
    /// Largest source-code byte count submitted in a single step (secondary work bound).
    pub max_submitted_bytes: u64,
    /// Cumulative validated blocks submitted through the timed path.
    pub total_submitted_blocks: u64,
    /// Number of public run calls whose JIT work was summarized. This is distinct from `count`,
    /// which counts individual periodic/final install steps.
    pub run_count: u64,
    /// Translation attempts made by the most recently completed public run call.
    pub last_run_attempted_blocks: u64,
    /// Largest aggregate translation-attempt count observed in one public run call.
    pub max_run_attempted_blocks: u64,
    /// Blocks submitted by the most recently completed public run call (periodic plus final pump).
    pub last_run_submitted_blocks: u64,
    /// Largest aggregate submission count observed in any one public run call. Browser executors bind
    /// this to their cooperative-slice budget; it is the deterministic counterpart to max wall time.
    pub max_run_submitted_blocks: u64,
    /// Discovery nominations staged by the most recently completed public run call.
    pub last_run_staged_nominations: u64,
    /// Largest aggregate nomination-staging count observed in any one public run call.
    pub max_run_staged_nominations: u64,
    /// Final-pump count in the most recent run call. E4-T32 requires this to be at most one.
    pub last_final_pumps: u64,
    /// Largest final-pump count observed in one run call (the old drain-all loop made this >1).
    pub max_final_pumps: u64,
    /// Translation attempts made by the most recent run's single final pump.
    pub last_final_attempted_blocks: u64,
    /// Largest attempt count made by a final pump in any one run call.
    pub max_final_attempted_blocks: u64,
    /// Blocks submitted by the most recent run's single final pump.
    pub last_final_submitted_blocks: u64,
    /// Largest block count submitted by a final pump in any one run call.
    pub max_final_submitted_blocks: u64,
}

impl Default for JitPauseStats {
    fn default() -> Self {
        Self::new()
    }
}

impl JitPauseStats {
    /// A fresh, zeroed summary.
    pub const fn new() -> Self {
        Self {
            count: 0,
            max_ns: 0,
            sum_ns: 0,
            over_target: 0,
            buckets: [0; PAUSE_BUCKETS],
            max_attempted_blocks: 0,
            total_attempted_blocks: 0,
            max_submitted_blocks: 0,
            max_submitted_bytes: 0,
            total_submitted_blocks: 0,
            run_count: 0,
            last_run_attempted_blocks: 0,
            max_run_attempted_blocks: 0,
            last_run_submitted_blocks: 0,
            max_run_submitted_blocks: 0,
            last_run_staged_nominations: 0,
            max_run_staged_nominations: 0,
            last_final_pumps: 0,
            max_final_pumps: 0,
            last_final_attempted_blocks: 0,
            max_final_attempted_blocks: 0,
            last_final_submitted_blocks: 0,
            max_final_submitted_blocks: 0,
        }
    }

    /// Record one JIT-attributable execution-thread pause of `ns` nanoseconds that submitted
    /// `blocks` validated blocks totalling `bytes` source bytes. `ns` may be 0 when no host timer is injected
    /// (the work bounds are still recorded — the headless path).
    pub fn record(&mut self, ns: u64, attempted: u64, submitted: u64, bytes: u64) {
        self.count = self.count.saturating_add(1);
        self.sum_ns = self.sum_ns.saturating_add(ns);
        if ns > self.max_ns {
            self.max_ns = ns;
        }
        if ns > PAUSE_TARGET_NS {
            self.over_target = self.over_target.saturating_add(1);
        }
        let b = bucket_of(ns);
        self.buckets[b] = self.buckets[b].saturating_add(1);
        self.max_attempted_blocks = self.max_attempted_blocks.max(attempted);
        self.total_attempted_blocks = self.total_attempted_blocks.saturating_add(attempted);
        if submitted > self.max_submitted_blocks {
            self.max_submitted_blocks = submitted;
        }
        if bytes > self.max_submitted_bytes {
            self.max_submitted_bytes = bytes;
        }
        self.total_submitted_blocks = self.total_submitted_blocks.saturating_add(submitted);
    }

    /// Record the compile work attributable to one completed public run call. This separate
    /// aggregation proves a sequence of individually bounded pumps cannot add up to unbounded work
    /// inside one browser `runChunk`.
    pub fn record_run(
        &mut self,
        attempted: u64,
        submitted: u64,
        staged_nominations: u64,
        final_pumps: u64,
        final_attempted: u64,
        final_submitted: u64,
    ) {
        self.run_count = self.run_count.saturating_add(1);
        self.last_run_attempted_blocks = attempted;
        self.max_run_attempted_blocks = self.max_run_attempted_blocks.max(attempted);
        self.last_run_submitted_blocks = submitted;
        self.max_run_submitted_blocks = self.max_run_submitted_blocks.max(submitted);
        self.last_run_staged_nominations = staged_nominations;
        self.max_run_staged_nominations = self.max_run_staged_nominations.max(staged_nominations);
        self.last_final_pumps = final_pumps;
        self.max_final_pumps = self.max_final_pumps.max(final_pumps);
        self.last_final_attempted_blocks = final_attempted;
        self.max_final_attempted_blocks = self.max_final_attempted_blocks.max(final_attempted);
        self.last_final_submitted_blocks = final_submitted;
        self.max_final_submitted_blocks = self.max_final_submitted_blocks.max(final_submitted);
    }

    /// Mean pause nanoseconds (0 if no samples).
    pub fn mean_ns(&self) -> u64 {
        self.sum_ns.checked_div(self.count).unwrap_or(0)
    }

    /// The `q`-quantile pause in nanoseconds (`q` in `[0.0, 1.0]`), estimated from the power-of-two
    /// buckets as the UPPER edge of the bucket the quantile falls in — a conservative (never
    /// under-reporting) estimate, which is the right bias for a latency ceiling. `p100` returns
    /// [`Self::max_ns`] exactly (buckets would only over-estimate the true max).
    pub fn percentile_ns(&self, q: f64) -> u64 {
        if self.count == 0 {
            return 0;
        }
        if q >= 1.0 {
            return self.max_ns;
        }
        // Manual ceil (no_std wasm32 has no f64::ceil intrinsic): truncate toward zero, then
        // bump by one if a fractional part remains. `prod` is non-negative here.
        let prod = q.clamp(0.0, 1.0) * self.count as f64;
        let trunc = prod as u64;
        let target = trunc + if prod > trunc as f64 { 1 } else { 0 };
        let mut acc = 0u64;
        for (b, &n) in self.buckets.iter().enumerate() {
            acc = acc.saturating_add(n);
            if acc >= target {
                // Upper edge of bucket b = 2^(b+1) ns, saturating for the top bucket.
                return 1u64.checked_shl(b as u32 + 1).unwrap_or(u64::MAX);
            }
        }
        self.max_ns
    }
}

/// The power-of-two bucket index for `ns`: `floor(log2(ns))`, clamped to the last bucket. `ns == 0`
/// lands in bucket 0.
#[inline]
fn bucket_of(ns: u64) -> usize {
    if ns == 0 {
        return 0;
    }
    let b = 63 - ns.leading_zeros() as usize;
    b.min(PAUSE_BUCKETS - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_bound_tracks_max() {
        let mut s = JitPauseStats::new();
        s.record(0, 4, 3, 300);
        s.record(0, 8, 7, 100);
        s.record(0, 2, 2, 900);
        assert_eq!(s.max_submitted_blocks, 7);
        assert_eq!(s.max_submitted_bytes, 900);
        assert_eq!(s.total_submitted_blocks, 12);
        assert_eq!(s.max_attempted_blocks, 8);
        assert_eq!(s.total_attempted_blocks, 14);
        assert_eq!(s.count, 3);
        s.record_run(14, 12, 20, 1, 3, 2);
        s.record_run(5, 4, 5, 0, 0, 0);
        assert_eq!(s.run_count, 2);
        assert_eq!(s.last_run_submitted_blocks, 4);
        assert_eq!(s.max_run_submitted_blocks, 12);
        assert_eq!(s.last_run_attempted_blocks, 5);
        assert_eq!(s.max_run_attempted_blocks, 14);
        assert_eq!(s.last_run_staged_nominations, 5);
        assert_eq!(s.max_run_staged_nominations, 20);
        assert_eq!(s.last_final_pumps, 0);
        assert_eq!(s.max_final_pumps, 1);
        assert_eq!(s.max_final_submitted_blocks, 2);
    }

    #[test]
    fn over_target_and_max_ns() {
        let mut s = JitPauseStats::new();
        s.record(1_000_000, 1, 1, 1); // 1 ms — under
        s.record(6_000_000, 1, 1, 1); // 6 ms — over
        assert_eq!(s.over_target, 1);
        assert_eq!(s.max_ns, 6_000_000);
        // p100 is the exact max; a low quantile is well under it.
        assert_eq!(s.percentile_ns(1.0), 6_000_000);
        assert!(s.percentile_ns(0.5) <= s.max_ns);
    }

    #[test]
    fn buckets_bracket_the_target() {
        // 2^22 = 4_194_304 ns ≈ 4.19 ms < 5 ms; 2^23 ≈ 8.39 ms > 5 ms.
        assert_eq!(bucket_of(4_194_304), 22);
        assert_eq!(bucket_of(0), 0);
        assert_eq!(bucket_of(1), 0);
    }
}
