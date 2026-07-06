//! E3-T03 prefetch heuristics — PURE, native-testable decision logic (no fetching, no web-sys). Two
//! sources of speculative reads, plus accuracy accounting:
//!
//! * [`Readahead`] — sequential detection: a forward run of consecutive guest accesses (k-2, k-1, k)
//!   triggers a readahead of `k+1..=k+window`. This is what turns a `dd if=/dev/vda` from one fetch
//!   per demand miss into batched lookahead.
//! * [`boot_prefetch`] — boot-profile batching: given the recorded ordered chunk-access list of a
//!   full boot, hand back the next chunks that still need fetching, up to a concurrency cap.
//! * [`PrefetchTracker`] — accuracy metric: prefetched chunks actually used ÷ prefetched total.
//!
//! The wasm layer issues the actual fetches (with bounded concurrency + in-flight dedup via
//! [`crate::plan_fetches`]); these functions only decide WHAT to speculatively fetch.

use alloc::collections::BTreeSet;
use alloc::vec::Vec;

/// Sequential-readahead detector. Tracks the current forward run of consecutive ascending accesses;
/// once the run is long enough it proposes the next `window` chunks. Stateless w.r.t. the cache — the
/// caller filters the proposal against what is already resident / in-flight.
#[derive(Debug, Clone)]
pub struct Readahead {
    window: usize,
    last: Option<usize>,
    /// Length of the current run of consecutive `+1` accesses (1 = just this access).
    run: u32,
}

impl Readahead {
    /// Readahead of `window` chunks ahead (T03 default 4). `window == 0` disables it.
    pub fn new(window: usize) -> Readahead {
        Readahead {
            window,
            last: None,
            run: 1,
        }
    }

    /// Observe a guest access to `chunk`. Returns `k+1..=k+window` when a forward sequential run of at
    /// least three consecutive accesses (k-2, k-1, k) is detected, else empty. Targets are NOT clamped
    /// to the image or deduped — the caller does that against the cache + in-flight set.
    pub fn observe(&mut self, chunk: usize) -> Vec<usize> {
        // A run continues only on an exact +1 step from the previous access.
        self.run = match self.last {
            Some(prev) if chunk == prev + 1 => self.run.saturating_add(1),
            _ => 1,
        };
        self.last = Some(chunk);
        // Need k-2, k-1, k (run ≥ 3) before committing to speculative fetches — two-in-a-row can be
        // coincidence; three is a stream. window 0 disables.
        if self.window == 0 || self.run < 3 {
            return Vec::new();
        }
        (1..=self.window).map(|d| chunk + d).collect()
    }
}

/// Boot-profile batching: from the recorded ordered `profile` (chunk indices touched during a full
/// boot), return up to `max` chunks — in profile order — for which `needs_fetch(chunk)` is true (i.e.
/// not resident and not already in-flight). Called each tick; as chunks land, `needs_fetch` flips and
/// the batch advances, so a fixed `max` acts as the concurrency cap. Deduped in profile order.
pub fn boot_prefetch(
    profile: &[usize],
    max: usize,
    needs_fetch: impl Fn(usize) -> bool,
) -> Vec<usize> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for &c in profile {
        if out.len() >= max {
            break;
        }
        if seen.insert(c) && needs_fetch(c) {
            out.push(c);
        }
    }
    out
}

/// Prefetch-accuracy accounting: how many speculatively-fetched chunks the guest actually went on to
/// read. `accuracy = used / issued`. A chunk is counted `used` at most once (the first demand access).
#[derive(Debug, Clone, Default)]
pub struct PrefetchTracker {
    outstanding: BTreeSet<usize>,
    issued: u64,
    used: u64,
}

impl PrefetchTracker {
    pub fn new() -> PrefetchTracker {
        PrefetchTracker::default()
    }

    /// Record that `chunk` was fetched speculatively (readahead or boot-profile). Idempotent per chunk
    /// while outstanding — re-issuing an already-outstanding prefetch is not double-counted.
    pub fn record_issued(&mut self, chunk: usize) {
        if self.outstanding.insert(chunk) {
            self.issued += 1;
        }
    }

    /// Note a demand access to `chunk`. If it was an outstanding prefetch, count it used (once) and
    /// retire it so a later access doesn't double-count.
    pub fn note_access(&mut self, chunk: usize) {
        if self.outstanding.remove(&chunk) {
            self.used += 1;
        }
    }

    /// `(issued, used)` — the caller computes accuracy = used/issued (guarding issued == 0).
    pub fn counts(&self) -> (u64, u64) {
        (self.issued, self.used)
    }

    /// Accuracy in percent (0 when nothing was prefetched yet), integer to stay float-free/deterministic.
    pub fn accuracy_pct(&self) -> u64 {
        self.used
            .saturating_mul(100)
            .checked_div(self.issued)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests;
