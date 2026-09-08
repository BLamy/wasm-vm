//! E4-T21: the priority compile-staging queue that sits between block discovery (E4-T08) and the
//! compiled-block executor, keeping compilation OFF the guest-execution hot path.
//!
//! ## Where this fits in the pipeline
//!
//! ```text
//! discovery FIFO (E4-T08)  ──drain at boundary──▶  CompileQueue (this)  ──pop hottest──▶  install
//!   generation-tagged                                priority + bounded                    (exec thread,
//!   nominations                                      backpressure + cancel                 cheap: table+map)
//! ```
//!
//! Discovery nominates hot blocks into its own FIFO in arrival order. At a dispatch-loop boundary the
//! run loop drains that FIFO into THIS queue, which re-orders pending work by **hotness** so the
//! hottest block compiles first (deliverable 5 / adversarial #5), enforces a hard **bound** with a
//! **drop-and-recount** backpressure policy that NEVER blocks execution (deliverable 3 / adversarial
//! #2), and drops any job whose generation went stale while it waited — **cancellation on generation
//! bump** (deliverable 1 / adversarial #4). The actual `WebAssembly.compile` / wasmtime compile is a
//! pure function of the (validated) bytes and can run on a worker later (E4-T22); this queue is the
//! deterministic, `no_std` staging + ordering + admission-control layer, and it owns none of that
//! engine — so it is identical whether compile is synchronous (the deterministic native/test config)
//! or asynchronous (the future worker). See the module test suite for the priority / backpressure /
//! cancellation gates.
//!
//! ## Determinism
//!
//! This structure performs NO guest-observable work: it only decides the ORDER and SET of blocks
//! handed to the executor for compilation. Which blocks are compiled (and when) can never change the
//! guest's architectural trace — a block runs byte-identically in the interpreter or the JIT (the
//! corpus invariant). So re-ordering by hotness, dropping under backpressure, and cancelling stale
//! jobs are all safe against the `riscv_tests_verdict_identical_with_jit` / `predecode_diff` gates:
//! they change host scheduling, never guest bytes. The single hard rule — *never install stale
//! bytes* — is preserved because every popped job is still re-validated at install time by the
//! existing generation + bytes `install_check` (this queue's `generation` filter is a cheap FIRST
//! line of defence, not the only one).

use crate::dispatch::TranslationRequest;
use alloc::vec::Vec;

/// Default bound on pending compile jobs. Generous so a normal boot's hot working set never hits
/// backpressure (the design's queue-depth budget is ~32 *batches*; at up to a batch-worth of blocks
/// each this is comfortably above that), while still finite so a `gcc`-style flood of unique hot
/// blocks degrades gracefully instead of growing without bound. Tests use a tiny cap to exercise the
/// drop-and-recount path.
pub const DEFAULT_COMPILE_QUEUE_CAP: usize = 256;

/// A pending compile job: the discovery [`TranslationRequest`] (carrying the phys key, the
/// generation stamp, and the code-bytes snapshot for the install-time re-validation) plus the
/// **hotness** priority used to order the queue. Higher `hotness` compiles first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompileJob {
    /// The nomination this job will compile + install (unchanged from discovery).
    pub req: TranslationRequest,
    /// Priority: discovery hotness sampled on admission and refreshed for surviving residents just
    /// before selection. Admission/backpressure still uses the stored scores; pop takes the maximum.
    pub hotness: u32,
}

/// Observable counters for the compile-staging queue (folded into `DiscoveryStats` for the report).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CompileQueueStats {
    /// Jobs admitted to the queue.
    pub admitted: u64,
    /// Jobs dropped by backpressure (queue full) — each is re-counted for later re-nomination, never
    /// silently lost and never a blocked execution thread.
    pub dropped_backpressure: u64,
    /// Jobs cancelled because their generation went stale before they could compile.
    pub cancelled_stale: u64,
    /// Jobs popped for compilation (the install-step feed).
    pub popped: u64,
    /// High-water mark of the queue depth.
    pub hwm: usize,
}

/// A bounded max-priority queue of [`CompileJob`]s, ordered by hotness. Backing store is a plain
/// `Vec` (the bound is small — tens to low-hundreds — so linear select-max / select-min on
/// push-overflow is cheaper than a heap's constant factor and keeps the code obviously correct).
pub struct CompileQueue {
    jobs: Vec<CompileJob>,
    cap: usize,
    stats: CompileQueueStats,
    /// Physical PCs dropped (by backpressure or cancellation) since the last [`Self::take_recount`],
    /// to be handed back to discovery so an evicted-from-queue-but-still-hot block is re-nominated
    /// rather than suppressed forever.
    recount: Vec<u64>,
}

impl Default for CompileQueue {
    fn default() -> Self {
        Self::with_cap(DEFAULT_COMPILE_QUEUE_CAP)
    }
}

impl CompileQueue {
    /// A queue bounded at `cap` (minimum 1).
    pub fn with_cap(cap: usize) -> Self {
        Self {
            jobs: Vec::new(),
            cap: cap.max(1),
            stats: CompileQueueStats::default(),
            recount: Vec::new(),
        }
    }

    /// Admit `job`. **Never blocks.** If the queue is under its bound the job is admitted. If it is
    /// full, backpressure runs **drop-and-recount**: the COLDEST resident job and the incoming job
    /// are compared, the colder of the two is dropped (its phys PC queued for re-count), and the
    /// hotter stays — so a newly-arriving hot block can displace a cold straggler, but the queue
    /// depth never exceeds the bound and the execution thread is never stalled waiting for space.
    pub fn push(&mut self, job: CompileJob) {
        if self.jobs.len() < self.cap {
            self.jobs.push(job);
            self.stats.admitted = self.stats.admitted.saturating_add(1);
            if self.jobs.len() > self.stats.hwm {
                self.stats.hwm = self.jobs.len();
            }
            return;
        }
        // Full: find the coldest resident.
        let (cold_idx, cold_hot) = self
            .jobs
            .iter()
            .enumerate()
            .map(|(i, j)| (i, j.hotness))
            .min_by_key(|&(_, h)| h)
            .expect("queue is full so non-empty");
        if job.hotness > cold_hot {
            // Evict the coldest resident, admit the hotter newcomer.
            let evicted = self.jobs.swap_remove(cold_idx);
            self.recount.push(evicted.req.phys_pc);
            self.stats.dropped_backpressure = self.stats.dropped_backpressure.saturating_add(1);
            self.jobs.push(job);
            self.stats.admitted = self.stats.admitted.saturating_add(1);
        } else {
            // Newcomer is no hotter than everything resident — drop it (and recount it).
            self.recount.push(job.req.phys_pc);
            self.stats.dropped_backpressure = self.stats.dropped_backpressure.saturating_add(1);
        }
    }

    /// Cancellation on generation bump: drop every resident job whose generation != `live_gen`
    /// (stale — an invalidation happened while it waited). Dropped phys PCs are NOT re-counted: a
    /// generation bump already cleared discovery's per-block state (`on_invalidate`), so the block
    /// re-nominates naturally when it next runs hot. Returns the number cancelled.
    pub fn cancel_stale(&mut self, live_gen: u64) -> usize {
        let before = self.jobs.len();
        self.jobs.retain(|j| j.req.generation == live_gen);
        let cancelled = before - self.jobs.len();
        self.stats.cancelled_stale = self.stats.cancelled_stale.saturating_add(cancelled as u64);
        cancelled
    }

    /// Refresh surviving residents in place after staging, cancellation and recount. Exactly one
    /// lookup per resident (bounded by `cap`); payloads, order, counters and recount stay untouched.
    #[cfg(any(test, not(feature = "zicsr-stub")))]
    pub(crate) fn refresh_hotness(&mut self, mut current: impl FnMut(u64) -> u32) {
        for job in &mut self.jobs {
            job.hotness = current(job.req.phys_pc);
        }
    }

    /// Pop the HOTTEST pending job (max `hotness`), or `None` if empty. Ties break by lowest index
    /// (insertion order) for a deterministic order under equal hotness.
    pub fn pop_hottest(&mut self) -> Option<CompileJob> {
        if self.jobs.is_empty() {
            return None;
        }
        // Select the max-hotness job; on ties keep the earliest (smallest index).
        let mut best = 0usize;
        for i in 1..self.jobs.len() {
            if self.jobs[i].hotness > self.jobs[best].hotness {
                best = i;
            }
        }
        // Preserve relative order of the rest by using remove (not swap_remove) so tie-breaking is
        // stable; the queue is small so the shift is cheap.
        let job = self.jobs.remove(best);
        self.stats.popped = self.stats.popped.saturating_add(1);
        Some(job)
    }

    /// Drain the accumulated recount list (phys PCs dropped by backpressure) for the caller to feed
    /// back to `BlockDiscovery::renominate`.
    pub fn take_recount(&mut self) -> Vec<u64> {
        core::mem::take(&mut self.recount)
    }

    /// Current pending depth.
    pub fn len(&self) -> usize {
        self.jobs.len()
    }

    /// Whether the queue is empty.
    pub fn is_empty(&self) -> bool {
        self.jobs.is_empty()
    }

    /// The bound.
    pub fn cap(&self) -> usize {
        self.cap
    }

    /// The observable counters (depth reflects the live length).
    pub fn stats(&self) -> CompileQueueStats {
        CompileQueueStats {
            hwm: self.stats.hwm.max(self.jobs.len()),
            ..self.stats
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatch::TerminatorKind;
    use alloc::vec;

    fn req(phys: u64, generation: u64, bytes: &[u8]) -> TranslationRequest {
        TranslationRequest {
            phys_pc: phys,
            code_bytes: bytes.to_vec(),
            op_lens: vec![4u8; bytes.len() / 4],
            terminator: TerminatorKind::Jal,
            generation,
        }
    }

    fn job(phys: u64, hotness: u32, generation: u64) -> CompileJob {
        CompileJob {
            req: req(phys, generation, &[0x13, 0, 0, 0]),
            hotness,
        }
    }

    #[test]
    fn priority_hotter_compiles_first() {
        // Two pending nominations; the hotter must pop first regardless of insertion order.
        let mut q = CompileQueue::with_cap(8);
        q.push(job(0x1000, 70, 1)); // cold-ish, inserted first
        q.push(job(0x2000, 500, 1)); // hotter, inserted second
        q.push(job(0x3000, 120, 1));
        assert_eq!(
            q.pop_hottest().unwrap().req.phys_pc,
            0x2000,
            "hottest first"
        );
        assert_eq!(q.pop_hottest().unwrap().req.phys_pc, 0x3000, "next hottest");
        assert_eq!(q.pop_hottest().unwrap().req.phys_pc, 0x1000, "coldest last");
        assert!(q.pop_hottest().is_none());
    }

    #[test]
    fn backpressure_drops_and_recounts_never_overflows() {
        // Bound of 2. Push 4 jobs of rising hotness; depth must never exceed 2, the two hottest must
        // survive, and every dropped phys must appear in the recount list (drop-and-recount).
        let mut q = CompileQueue::with_cap(2);
        q.push(job(0xA000, 10, 1));
        q.push(job(0xB000, 20, 1));
        assert_eq!(q.len(), 2);
        q.push(job(0xC000, 5, 1)); // colder than both residents → dropped outright
        assert_eq!(q.len(), 2, "never exceeds the bound");
        q.push(job(0xD000, 100, 1)); // hotter than the coldest resident (0xA000) → displaces it
        assert_eq!(q.len(), 2, "still bounded");

        let recount = q.take_recount();
        assert!(recount.contains(&0xC000), "colder newcomer recounted");
        assert!(recount.contains(&0xA000), "displaced resident recounted");
        assert_eq!(recount.len(), 2);

        // Survivors are the two hottest ever seen: 0xD000 (100) and 0xB000 (20).
        let a = q.pop_hottest().unwrap();
        let b = q.pop_hottest().unwrap();
        assert_eq!(a.req.phys_pc, 0xD000);
        assert_eq!(b.req.phys_pc, 0xB000);
        assert!(q.is_empty());
        let s = q.stats();
        assert_eq!(s.dropped_backpressure, 2);
        assert_eq!(s.admitted, 3); // A, B, D admitted (C never admitted)
    }

    #[test]
    fn cancellation_on_generation_bump_drops_stale() {
        // A job stamped gen 1 that is still pending when the live generation becomes 2 (an
        // invalidation) is cancelled — modelling async-with-delay where the world changes under a
        // queued compile. The current-generation job survives.
        let mut q = CompileQueue::with_cap(8);
        q.push(job(0x1000, 100, 1)); // stale after the bump
        q.push(job(0x2000, 100, 2)); // fresh
        let cancelled = q.cancel_stale(2);
        assert_eq!(cancelled, 1);
        assert_eq!(q.len(), 1);
        assert_eq!(q.pop_hottest().unwrap().req.phys_pc, 0x2000);
        assert_eq!(q.stats().cancelled_stale, 1);
    }

    #[test]
    fn never_blocks_execution_thread_under_flood() {
        // A "compile storm": far more unique hot blocks than the bound. The invariant is simply that
        // push always RETURNS (no blocking, no panic, no unbounded growth) and depth stays bounded.
        let mut q = CompileQueue::with_cap(4);
        for i in 0..10_000u64 {
            q.push(job(0x10_000 + i * 0x40, (i % 256) as u32, 1));
            assert!(q.len() <= 4);
        }
        // Backpressure recount accrued but nothing deadlocked.
        assert!(!q.take_recount().is_empty());
    }

    #[test]
    fn refresh_visits_only_residents_preserving_payload_order_counters_and_recount() {
        use crate::dispatch::{BlockDiscovery, MicroOp};
        let ops = [MicroOp {
            instr: crate::decode::decode(0x6f).unwrap(),
            len: 4,
            raw: 0x6f,
        }];
        let mut discovery = BlockDiscovery::new();
        discovery.set_threshold(1);
        let mut q = CompileQueue::with_cap(3);
        for pc in [0x1000, 0x2000, 0x3000] {
            discovery.on_block_entry(pc, &ops);
        }
        for req in discovery.take_requests_bounded(3) {
            let hotness = discovery.queued_hotness(req.phys_pc);
            q.push(CompileJob { req, hotness });
        }
        q.push(job(0x4000, 0, discovery.generation())); // Keep a nonempty recount list.
        for _ in 0..1000 {
            discovery.on_block_entry(0x3000, &ops);
        }
        let before = q.jobs.clone();
        let stats = q.stats();
        let recount = q.recount.clone();
        let discovery_stats = discovery.stats();
        let allocation = (q.jobs.as_ptr(), q.jobs.capacity());
        let mut visited = Vec::new();
        q.refresh_hotness(|pc| {
            visited.push(pc);
            discovery.queued_hotness(pc)
        });
        assert_eq!(visited, [0x1000, 0x2000, 0x3000]);
        assert_eq!(visited.len(), q.len());
        assert!(visited.len() <= q.cap());
        assert_eq!((q.jobs.as_ptr(), q.jobs.capacity()), allocation);
        assert_eq!(q.stats(), stats);
        assert_eq!(q.recount, recount);
        assert_eq!(discovery.stats(), discovery_stats);
        for (old, refreshed) in before.iter().zip(&q.jobs) {
            assert_eq!(old.req, refreshed.req);
        }
        assert_eq!(
            q.jobs.iter().map(|j| j.hotness).collect::<Vec<_>>(),
            [1, 1, 1001]
        );
        assert_eq!(q.pop_hottest().unwrap().req.phys_pc, 0x3000);
        assert_eq!(q.pop_hottest().unwrap().req.phys_pc, 0x1000);
        assert_eq!(q.pop_hottest().unwrap().req.phys_pc, 0x2000);
    }

    #[test]
    fn refresh_empty_is_inert_and_equal_saturated_scores_keep_order() {
        let mut q = CompileQueue::with_cap(3);
        let empty = q.stats();
        q.refresh_hotness(|_| panic!("empty refresh must not query discovery"));
        assert_eq!(q.stats(), empty);
        assert!(q.take_recount().is_empty());
        for score in [0, 64, u32::MAX] {
            for pc in [0x3000, 0x1000, 0x2000] {
                q.push(job(pc, 123, 1));
            }
            q.refresh_hotness(|_| score);
            for pc in [0x3000, 0x1000, 0x2000] {
                let popped = q.pop_hottest().unwrap();
                assert_eq!(popped.req.phys_pc, pc);
                assert_eq!(popped.hotness, score);
            }
        }
    }

    #[test]
    fn refresh_uses_actual_missing_and_recount_reset_hotness_without_changing_discovery() {
        use crate::dispatch::{BlockDiscovery, MicroOp};
        let mut discovery = BlockDiscovery::new();
        let ops = [MicroOp {
            instr: crate::decode::decode(0x6f).unwrap(),
            len: 4,
            raw: 0x6f,
        }];
        for _ in 0..discovery.threshold() + 10 {
            discovery.on_block_entry(0x1000, &ops);
        }
        let mut q = CompileQueue::with_cap(2);
        q.push(job(0x1000, 74, discovery.generation()));
        q.push(job(0x2000, u32::MAX, discovery.generation())); // No hotness record exists.
        q.push(job(0x1000, 0, discovery.generation())); // Existing drop/recount behavior.
        for pc in q.take_recount() {
            discovery.renominate(pc);
        }
        let before = discovery.stats();
        let queue_before = q.stats();
        q.refresh_hotness(|pc| discovery.queued_hotness(pc));
        assert_eq!(discovery.stats(), before);
        assert_eq!(q.stats(), queue_before);
        assert_eq!(
            q.jobs.iter().map(|j| j.hotness).collect::<Vec<_>>(),
            [64, 64]
        );
        assert_eq!(q.pop_hottest().unwrap().req.phys_pc, 0x1000);
    }

    #[test]
    fn staged_stale_resident_and_incoming_cancel_before_refresh_of_fresh_same_pc() {
        use crate::dispatch::{BlockDiscovery, MicroOp};
        let mut discovery = BlockDiscovery::new();
        discovery.set_threshold(1);
        let old_gen = discovery.generation();
        let mut q = CompileQueue::with_cap(4);
        q.push(job(0x1000, u32::MAX, old_gen)); // Stale resident.
        discovery.on_invalidate();
        let ops = [MicroOp {
            instr: crate::decode::decode(0x6f).unwrap(),
            len: 4,
            raw: 0x6f,
        }];
        discovery.on_block_entry(0x1000, &ops); // Fresh same-PC nomination.
        let fresh = discovery.take_requests_bounded(1).pop().unwrap();
        q.push(job(0x2000, u32::MAX, old_gen)); // Stale incoming, staged BEFORE cancellation.
        q.push(CompileJob {
            hotness: discovery.queued_hotness(0x1000),
            req: fresh.clone(),
        });
        assert_eq!(q.cancel_stale(discovery.generation()), 2);
        assert!(
            q.take_recount().is_empty(),
            "cancellation must not recount fresh same-PC state"
        );
        let before = discovery.stats();
        q.refresh_hotness(|pc| {
            assert_eq!(pc, 0x1000, "stale job reached refresh");
            discovery.queued_hotness(pc)
        });
        assert_eq!(discovery.stats(), before);
        assert_eq!(q.stats().cancelled_stale, 2);
        let popped = q.pop_hottest().unwrap();
        assert_eq!(popped.req, fresh);
        assert!(discovery.install_check(&popped.req, &0x6fu32.to_le_bytes()));
        assert!(!discovery.install_check(&popped.req, &0x13u32.to_le_bytes()));
        discovery.on_block_entry(0x1000, &ops);
        assert_eq!(discovery.stats().nominated, before.nominated);
        assert_eq!(discovery.stats().deduped, before.deduped + 1);
    }

    #[test]
    fn stale_incoming_admission_and_backpressure_are_not_reordered_by_refresh() {
        let mut q = CompileQueue::with_cap(1);
        q.push(job(0x1000, 1, 2));
        q.push(job(0x2000, 2, 1)); // Existing admission evicts the colder fresh resident.
        assert_eq!(q.cancel_stale(2), 1); // The incoming stale job is then cancelled.
        assert_eq!(q.take_recount(), [0x1000]);
        let before = q.stats();
        q.refresh_hotness(|_| panic!("nothing survives the established ordering"));
        assert_eq!(q.stats(), before);
        assert_eq!(before.dropped_backpressure, 1);
        assert_eq!(before.cancelled_stale, 1);
        assert!(q.pop_hottest().is_none());
    }
}
