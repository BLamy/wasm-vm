//! The turbo run loop: block-to-block interpretation with the per-instruction and per-boundary
//! bookkeeping of the batched interpreter deferred to the points where something can observe it.
//!
//! # What it replaces
//!
//! With the block cache and interrupt batching on, the ordinary run loop
//! (`Machine::run_capture_inner`) executes a decoded block as: a full boundary iteration (session
//! preparation, PMP sync, [`Machine::boundary_sync`], interrupt sampling) that runs the entry op
//! through the general one-op step, then `replay_block_tail` for the rest. Every non-integer op
//! still pays the retire clock (a CLINT borrow), the counters, the progress counter, the
//! live-work counters, the code-write drain and three loop-top tests. Guest code averages about
//! five instructions per block, so that bookkeeping dominates.
//!
//! [`Machine::run_turbo`] runs any number of consecutive blocks without returning to that loop.
//!
//! # Why the result is identical
//!
//! The loop is entered only at a sampled block boundary where the ordinary loop has just done its
//! boundary work and found no interrupt to take, with the device fabric quiescent, the ICount
//! clock, no debug trigger, and no JIT, profiler, HTIF, session clock or source capture.
//!
//! * **Boundaries.** Until an instruction leaves the hart, the boundary work the ordinary loop
//!   would repeat is a function of `mtime` alone: the fabric is quiescent, so no device state
//!   moves; `mip`/`mie`/`mstatus`/privilege move only through CSR instructions, traps and xRET,
//!   all of which return to the ordinary loop. `mtime` is the retire count divided by the clock
//!   divider, so the first boundary at which MTIP or STIP would newly read set is known in
//!   advance as a retire count (the *horizon*). The loop stops at the first boundary at or past
//!   the horizon, before entering the block, and the ordinary loop samples it exactly as before.
//! * **Accounting.** The Zicntr counters, the retire clock, the progress counter and the
//!   live-work counters are plain sums of retired instructions, so the loop counts retirements
//!   and applies them with [`Machine::settle_retired`] before anything that can read them: any op
//!   that is not completed inline (so every CSR, system, FP, atomic, faulting or MMIO access),
//!   any trap, and every exit.
//! * **The `time` shadow.** `csrr time` reads a shadow that the ordinary loop refreshes at each
//!   boundary, so it holds `mtime` as of the start of the block being executed. The loop
//!   reproduces that: whenever it settles, it first settles up to the start of the current
//!   block, refreshes the shadow there ([`Machine::sync_clint`], whose `mip` writes cannot change
//!   inside the horizon), then settles the rest. A CSR or system op always goes through the
//!   ordinary executor, and that path settles first, so the shadow it reads is the one the
//!   ordinary loop would have refreshed at its block's boundary.
//! * **Instructions.** Integer ops use the same `integer_result` the ordinary deferred path uses;
//!   loads, stores, branches and jumps use [`Hart::turbo_step`], which completes an op only on the
//!   path `Hart::execute` would take without leaving the hart, and otherwise leaves it to
//!   `retire_cached_op` — the ordinary executor, with the ordinary per-op accounting.
//! * **Code writes.** An inline store tests its frame against the block cache's code filter and,
//!   on a possible hit, goes through the ordinary page invalidation. If that drops the running
//!   block the loop returns at the next instruction, which the ordinary loop treats as a
//!   boundary, as it always did.
//!
//! Block entry still goes through [`Machine::enter_block`], so translation, the TLBs, the block
//! cache and JIT discovery see the same sequence of lookups as before.

use crate::hart::{self, RetirementCapture, Trap, turbo::TurboCtx, turbo::TurboStep};
use crate::{BlockCursor, Machine, RunCapture, trace};

/// Makes one retirement capture per executed op (the unit capture, or a recorder borrowing the
/// run's trace sink).
pub(crate) trait TurboCaptures {
    type Capture<'a>: RetirementCapture
    where
        Self: 'a;
    fn make(&mut self) -> Self::Capture<'_>;
}

struct UnitCaptures;

impl TurboCaptures for UnitCaptures {
    type Capture<'a> = hart::UnitCapture;

    #[inline(always)]
    fn make(&mut self) -> hart::UnitCapture {
        hart::UnitCapture
    }
}

struct TracedCaptures<'s, T: trace::TraceSink>(&'s mut T);

impl<T: trace::TraceSink> TurboCaptures for TracedCaptures<'_, T> {
    type Capture<'a>
        = hart::RecordingCapture<'a, T>
    where
        Self: 'a;

    #[inline(always)]
    fn make(&mut self) -> hart::RecordingCapture<'_, T> {
        hart::RecordingCapture::new(&mut *self.0)
    }
}

/// Retirements not yet applied to the machine's accounting.
struct Deferred {
    /// Retired inline since the last settle.
    pending: u64,
    /// `Some(n)`: the current block's boundary has not been applied to the `time` shadow yet, and
    /// `n` of the pending retirements preceded that boundary.
    before_block: Option<u64>,
}

/// Per-entry tallies, folded into [`TurboStats`] on exit so the loop keeps them in registers.
#[derive(Default)]
struct Tally {
    /// Retired since entry by any path: what the horizon is measured in.
    retired: u64,
    slow: u64,
    blocks: u64,
}

/// Counters describing how the turbo loop ran (diagnostics only; never part of machine state).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TurboStats {
    /// Times the run loop entered the turbo loop.
    pub entries: u64,
    /// Blocks entered inside the turbo loop.
    pub blocks: u64,
    /// Instructions retired inline (integer ops, fast-TLB loads/stores, branches, jumps).
    pub inline_ops: u64,
    /// Instructions the turbo loop handed to the ordinary executor.
    pub slow_ops: u64,
    /// Exits because the timer horizon was reached.
    pub exit_horizon: u64,
    /// Exits because the run's work budget was used up.
    pub exit_budget: u64,
    /// Exits because an op ended its block outside inline execution (a CSR or system op, an
    /// invalidated block) or a device was touched.
    pub exit_boundary: u64,
    /// Exits with a trap for the run loop to deliver.
    pub exit_trap: u64,
}

/// Why the loop handed control back at a block boundary.
enum Stop {
    Horizon,
    Budget,
    Device,
}

impl Machine {
    /// Turn the turbo run loop on or off (on by default). Off, every block goes through the
    /// ordinary batched loop; the guest-visible result is the same either way.
    pub fn set_turbo(&mut self, on: bool) {
        self.turbo_enabled = on;
    }

    /// Whether the turbo run loop is enabled (it still engages only in the batched block-cache
    /// interpreter; see the module docs).
    pub fn turbo(&self) -> bool {
        self.turbo_enabled
    }

    /// Diagnostics for the turbo loop since construction.
    pub fn turbo_stats(&self) -> TurboStats {
        self.turbo_stats
    }

    /// Whether the device fabric is quiescent: no device has work and no MMIO access has touched
    /// a fabric window since the last full boundary sync.
    #[inline(always)]
    fn fabric_quiescent(&self) -> bool {
        #[cfg(test)]
        if self.fabric_fast_path_off {
            return false;
        }
        self.fabric_idle_epoch == Some(self.fabric_epoch.get())
    }

    /// The data context to enter the turbo loop with, or `None` when a condition that can change
    /// during a run does not hold. The caller has already established the run-invariant
    /// conditions, that this is a sampled block boundary, and that no interrupt is deliverable.
    #[inline(always)]
    pub(crate) fn turbo_entry(&self) -> Option<TurboCtx> {
        if self.fabric_quiescent() && self.tick_accum < self.clock_div {
            self.hart.turbo_ctx()
        } else {
            None
        }
    }

    /// Retirements from now until a timer interrupt level (MTIP from the CLINT, STIP from the
    /// built-in SBI timer) that reads clear would first read set at a boundary sync. `u64::MAX`
    /// when no clear level has a reachable deadline. A level that is already set stays set
    /// (`mtime` only grows here), so it bounds nothing.
    fn turbo_horizon(&self) -> u64 {
        let Some(clint) = &self.clint else {
            return u64::MAX;
        };
        let c = *clint.borrow();
        let mut ticks = u64::MAX;
        if c.mtime < c.mtimecmp {
            ticks = ticks.min(c.mtimecmp - c.mtime);
        }
        if self.builtin_sbi && c.mtime < self.sbi_state.stimecmp {
            ticks = ticks.min(self.sbi_state.stimecmp - c.mtime);
        }
        // `mtime` after `r` more retirements is `mtime + (tick_accum + r) / clock_div`, so it has
        // advanced by `ticks` exactly when `tick_accum + r >= ticks * clock_div`.
        match ticks.checked_mul(self.clock_div) {
            Some(span) => span - self.tick_accum,
            None => u64::MAX,
        }
    }

    /// Apply the deferred accounting, refreshing the `time` shadow at the current block's
    /// boundary on the way if that has not happened yet (see the module docs).
    #[inline(always)]
    fn turbo_settle(&mut self, deferred: &mut Deferred) {
        match deferred.before_block.take() {
            Some(before) => {
                if before != 0 {
                    self.settle_retired(before);
                }
                self.sync_clint();
                let within = deferred.pending - before;
                if within != 0 {
                    self.settle_retired(within);
                }
            }
            None => {
                if deferred.pending != 0 {
                    self.settle_retired(deferred.pending);
                }
            }
        }
        deferred.pending = 0;
    }

    /// One op through the ordinary executor with the ordinary per-op accounting: exactly the
    /// non-deferred iteration of `replay_block_tail` (and of the run loop's one-op step). The
    /// deferred accounting must already be settled and the machine cursor already positioned.
    #[inline(always)]
    fn turbo_ordinary_op<K: TurboCaptures>(
        &mut self,
        op: &crate::dispatch::MicroOp,
        pc: u64,
        remaining_work: &mut u64,
        caps: &mut K,
        tally: &mut Tally,
    ) -> Result<(), Trap> {
        self.hart.csr.arm_counters();
        self.retire_cached_op(op, pc, caps.make(), false)?;
        *remaining_work -= 1;
        tally.retired += 1;
        tally.slow += 1;
        self.advance_clock();
        self.irqstats.on_retire();
        self.advance_live_work(1, 1);
        if self.hart.last_was_wfi {
            self.after_wfi_retire();
        }
        Ok(())
    }

    /// Run consecutive decoded blocks from the current sampled boundary (see the module docs for
    /// the entry conditions and the equivalence argument). `ctx` comes from
    /// [`Self::turbo_entry`].
    ///
    /// Returns `Some(trap)` when an op trapped: like `replay_block_tail`, that op has NOT
    /// consumed its work slot, and the run loop charges it and delivers the trap. Returns `None`
    /// when the run loop must take over at the current instruction, which is either a block
    /// boundary (no continuing cursor) or a mid-block position (cursor in place). Whenever it
    /// returns `None` it has retired at least one instruction.
    #[inline(never)]
    pub(crate) fn run_turbo<T: trace::TraceSink>(
        &mut self,
        ctx: TurboCtx,
        remaining_work: &mut u64,
        capture: &mut RunCapture<'_, T>,
    ) -> Option<Trap> {
        let mut tally = Tally::default();
        let result = match capture {
            RunCapture::Unit => self.turbo_loop(ctx, remaining_work, &mut UnitCaptures, &mut tally),
            RunCapture::Traced(sink) => self.turbo_loop(
                ctx,
                remaining_work,
                &mut TracedCaptures(&mut **sink),
                &mut tally,
            ),
        };
        let stats = &mut self.turbo_stats;
        stats.entries += 1;
        stats.blocks += tally.blocks;
        stats.slow_ops += tally.slow;
        stats.inline_ops += tally.retired - tally.slow;
        if result.is_some() {
            stats.exit_trap += 1;
        }
        result
    }

    #[inline(always)]
    fn turbo_loop<K: TurboCaptures>(
        &mut self,
        mut ctx: TurboCtx,
        remaining_work: &mut u64,
        caps: &mut K,
        tally: &mut Tally,
    ) -> Option<Trap> {
        debug_assert!(*remaining_work != 0);
        let mut horizon = self.turbo_horizon();
        let mut deferred = Deferred {
            pending: 0,
            before_block: None,
        };
        // A device access by an op the ordinary executor ran can move CLINT, PLIC or fabric
        // state, which only the ordinary loop's boundary work folds into `mip`.
        let mut device_touched = false;
        // The counter write flags are cleared at the start of every instruction; no inline op
        // sets them, so clearing them once here covers every inline retirement.
        self.hart.csr.arm_counters();
        let mut first_block = true;
        loop {
            // ── A block boundary. The ordinary loop has sampled it only for the first block. ──
            if !first_block {
                let stop = if tally.retired >= horizon {
                    Some(Stop::Horizon)
                } else if *remaining_work == 0 {
                    Some(Stop::Budget)
                } else if device_touched || !self.fabric_quiescent() {
                    Some(Stop::Device)
                } else {
                    None
                };
                if let Some(stop) = stop {
                    self.turbo_settle(&mut deferred);
                    self.block_cursor = None;
                    match stop {
                        Stop::Horizon => self.turbo_stats.exit_horizon += 1,
                        Stop::Budget => self.turbo_stats.exit_budget += 1,
                        Stop::Device => self.turbo_stats.exit_boundary += 1,
                    }
                    return None;
                }
            }
            first_block = false;
            // This boundary is now the one the `time` shadow belongs to: everything pending was
            // retired before it. (A previous block that never settled leaves its own boundary
            // unapplied; the ordinary loop would have refreshed the shadow again here.)
            deferred.before_block = Some(deferred.pending);
            let entry_pc = self.hart.regs.pc;
            let first = match self.enter_block(entry_pc) {
                Ok(first) => first,
                Err(trap) => {
                    self.turbo_settle(&mut deferred);
                    return Some(trap);
                }
            };
            tally.blocks += 1;
            // Own the block for the duration; the machine's cursor is put back whenever the
            // ordinary machinery needs it (a slow op, a code-page store, an exit mid-block).
            let Some(BlockCursor { block, .. }) = self.block_cursor.take() else {
                // An entry op that straddles a page is not cached: `enter_block` decoded it and
                // left no cursor. Run exactly that op the ordinary way; what follows it is a
                // boundary for the run loop.
                self.turbo_settle(&mut deferred);
                if let Err(trap) =
                    self.turbo_ordinary_op(&first, entry_pc, remaining_work, caps, tally)
                {
                    return Some(trap);
                }
                self.turbo_stats.exit_boundary += 1;
                return None;
            };
            // `enter_block` drained the code-write log and nothing has stored since (this MMU
            // never writes a PTE while translating), so the inline ops below start from an
            // empty log, as the ordinary loop's entry op does.
            debug_assert!(self.bus.code_write_log_mut().is_empty());
            let ops = &block.ops[..];
            let mut idx = 0usize;
            while idx < ops.len() {
                if *remaining_work == 0 {
                    self.turbo_settle(&mut deferred);
                    self.block_cursor = Some(BlockCursor {
                        block: alloc::rc::Rc::clone(&block),
                        idx,
                        next_va: self.hart.regs.pc,
                    });
                    self.turbo_stats.exit_budget += 1;
                    return None;
                }
                let op = &ops[idx];
                let pc = self.hart.regs.pc;
                // `Some(frame)` after an inline store, `Some(None)` after any other inline op,
                // `None` when the op must go through the ordinary executor.
                let inline: Option<Option<u64>> = {
                    let mut cap = caps.make();
                    if block.op_deferrable(idx) {
                        let (rd, value) = self
                            .hart
                            .integer_result(op.instr)
                            .expect("deferred operations have pure integer semantics");
                        self.hart.regs.write(rd, value);
                        self.hart.regs.pc = pc.wrapping_add(u64::from(op.len));
                        let output = cap.finish(rd, value);
                        cap.retire(output, pc, op.raw);
                        Some(None)
                    } else {
                        match self.hart.turbo_step(
                            &mut self.bus,
                            &ctx,
                            op.instr,
                            u64::from(op.len),
                            &mut cap,
                        ) {
                            TurboStep::Retired(output) => {
                                cap.retire(output, pc, op.raw);
                                Some(None)
                            }
                            TurboStep::Stored(output, pa) => {
                                cap.retire(output, pc, op.raw);
                                Some(Some(pa >> 12))
                            }
                            TurboStep::Slow => None,
                        }
                    }
                };
                let Some(stored) = inline else {
                    // The ordinary executor, with the ordinary cursor and accounting.
                    self.turbo_settle(&mut deferred);
                    self.block_cursor = Some(BlockCursor {
                        block: alloc::rc::Rc::clone(&block),
                        idx: idx + 1,
                        next_va: pc.wrapping_add(u64::from(op.len)),
                    });
                    let device_accesses = self.bus.device_access_count();
                    if let Err(trap) = self.turbo_ordinary_op(op, pc, remaining_work, caps, tally) {
                        return Some(trap);
                    }
                    // The run loop's next loop-top tests, in its order.
                    if *remaining_work == 0 {
                        self.turbo_stats.exit_budget += 1;
                        return None;
                    }
                    if self.syscon.as_ref().is_some_and(|c| c.borrow().is_some())
                        || self.at_block_boundary()
                    {
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    }
                    // Still inside the block (an FP op, an atomic, a slow-path memory access).
                    // Carry on inline; the op went through the general executor, so recompute
                    // what it could have changed.
                    let Some(next) = self.hart.turbo_ctx() else {
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    };
                    ctx = next;
                    if self.bus.device_access_count() != device_accesses {
                        device_touched = true;
                        horizon = u64::MAX;
                    }
                    self.block_cursor = None;
                    idx += 1;
                    continue;
                };
                *remaining_work -= 1;
                tally.retired += 1;
                deferred.pending += 1;
                idx += 1;
                if let Some(frame) = stored
                    && self.bus.tracks_code_writes()
                    && self.block_cache.may_hold_code(frame)
                {
                    // The store may have hit cached code: the ordinary page invalidation, with
                    // the cursor in place so a dropped running block is observable.
                    self.turbo_settle(&mut deferred);
                    self.block_cursor = Some(BlockCursor {
                        block: alloc::rc::Rc::clone(&block),
                        idx,
                        next_va: self.hart.regs.pc,
                    });
                    self.bus.code_write_log_mut().push(frame);
                    self.drain_code_writes_slow();
                    if self.block_cursor.is_none() {
                        // The running block was dropped: the next instruction is a boundary.
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    }
                    self.block_cursor = None;
                }
            }
        }
    }
}
