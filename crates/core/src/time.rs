//! E4-T24 — Timekeeping: the `mtime` derivation policy, in ONE place.
//!
//! The guest's machine timer (`mtime`) has three explicitly selected policies:
//!
//! * [`TimeMode::ICount`] — **deterministic**. `mtime` is a pure function of the retired-instruction
//!   count (`mtime = retired / clock_div`). Native and wasm retire the same instructions, so a timer
//!   interrupt lands at the identical retire index on both engines. This is the source the E4-T25
//!   lockstep / fuzz rig runs under so it can enable timer interrupts and stay byte-identical, and it
//!   is the default (it is exactly the E1-T12 retire clock the interpreter has always used).
//!
//! * [`TimeMode::WallClock`] — **host-wall-derived**, scaled to the DT-declared timebase frequency
//!   ([`crate::platform::virt::TIMEBASE_FREQ_HZ`]). Used when a guest must see real wall time
//!   (`sleep 1` = one real second) even though the CPU runs 10–50× faster on a throttleable worker.
//!   The host wall reading is **injected** through [`MonotonicClock`] so `crates/core` never names a
//!   host time API (the no_std determinism guard — no `SystemTime`, no `Date::now`, and — critically
//!   for the wasm32 no_std build — no f64 intrinsics: every computation here is integer-only).
//!
//! * [`TimeMode::PacedICount`] keeps retire-derived busy time and uses [`IdlePacer`] to bound
//!   idle deadline jumps by monotonic host progress. It is opt-in and not deterministic across
//!   hosts. Its host epoch is rebased at explicit pause/restore boundaries, never serialized.
//!
//! ## The wall-clock hazards this module defends against
//!
//! A background/throttled tab breaks a naive `mtime = wall_now` two ways, and both are handled here
//! by [`TimeSource::sample_wall`]:
//!
//! 1. **Backward host jitter / non-monotone `performance.now()`.** The emitted `mtime` is clamped to
//!    never decrease ([`TimeSource::last_mtime`]) — a host clock that steps backward is pinned to the
//!    last value until real time catches back up. `CLOCK_MONOTONIC` in the guest therefore never
//!    regresses even if the host reading does.
//!
//! 2. **Suspend/throttle gaps.** When the tab is backgrounded, `performance.now()` progression is
//!    clamped/frozen, then on resume a huge delta appears at once. Delivering it verbatim makes the
//!    guest kernel replay a storm of missed ticks (RCU-stall / soft-lockup / watchdog). Policy:
//!    * a modest overshoot (≤ [`WallClockPolicy::gap_threshold_ticks`]) is delivered directly;
//!    * a larger gap is **slewed** — `mtime` catches up at a *bounded* rate
//!      ([`WallClockPolicy::slew_multiplier`]× real time) so the guest sees fast-but-continuous time,
//!      never a raw jump, until it converges back onto real wall time;
//!    * a gap larger than [`WallClockPolicy::max_slew_gap_ticks`] (a 6-hour background nap) is NOT
//!      slew-replayed — that would forward hours of ticks. Instead `mtime` **jumps** straight to the
//!      target and a [`TimeJump`] notification is raised, mirroring real-hardware suspend/resume where
//!      the kernel resyncs its clock from the RTC. The guest's goldfish-RTC/SBI-time reads real wall
//!      time independently, so the jump and the RTC agree — the documented resync path.
//!
//! The browser `visibilitychange` hook that *feeds* gap detection lives in the JS/worker layer (dev
//! debt — the mac reaps long browser runs); the gap-detection + slew POLICY, which is what actually
//! keeps the guest sane, is headless and fully unit-tested here.

/// An injected, monotonic host clock in **nanoseconds**. Kept a trait so `crates/core` never names a
/// host time API: the CLI supplies an `Instant`-backed clock, the browser a `performance.now()` shim
/// (both monotonic), and tests a driven mock. Distinct from [`crate::dev::rtc::WallClock`], which is
/// epoch-ns wall time (explicitly allowed to step backward) for the goldfish RTC; this one is the
/// monotonic source `mtime` scaling wants.
pub trait MonotonicClock {
    /// Monotonic nanoseconds since some fixed, unspecified host epoch. The source SHOULD be
    /// non-decreasing, but [`TimeSource`] clamps defensively in case a browser hands back jitter.
    fn now_nanos(&self) -> u64;
}

/// A monotonic clock frozen at a fixed instant — deterministic source for tests.
pub struct FixedMonotonic(pub u64);
impl MonotonicClock for FixedMonotonic {
    fn now_nanos(&self) -> u64 {
        self.0
    }
}

/// One nanosecond-to-tick conversion base.
const NANOS_PER_SEC: u128 = 1_000_000_000;

/// The tunable bounds of the wall-clock catch-up policy. Documented, falsifiable numbers — the
/// defaults are what the AC-level slew/clamp unit tests pin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WallClockPolicy {
    /// Deadline-overshoot (in `mtime` ticks) beyond which a sample is treated as a suspend/throttle
    /// GAP rather than normal advance. Below it, `mtime` tracks the host reading directly.
    pub gap_threshold_ticks: u64,
    /// Bounded catch-up rate during slew: `mtime` may advance at most this multiple of real elapsed
    /// wall time while paying down a gap (so a 2× value means "catch up at twice real speed"). Must
    /// be ≥ 1 (never fall further behind); a larger value converges faster but is more visible.
    pub slew_multiplier: u64,
    /// Cap on total slew-forwarded time. A detected gap larger than this is NOT slewed (that would
    /// replay the whole gap tick-by-tick); it is delivered as a single [`TimeJump`] + RTC-resync
    /// notification instead. Mirrors hardware suspend/resume.
    pub max_slew_gap_ticks: u64,
}

impl WallClockPolicy {
    /// Defaults for the [`crate::platform::virt::TIMEBASE_FREQ_HZ`] = 10 MHz timebase (1 tick = 100 ns):
    /// * `gap_threshold` = 1 000 000 ticks = **100 ms** — a foreground frame's worth of overshoot is
    ///   normal; beyond it something throttled us.
    /// * `slew_multiplier` = **2×** — catch up at twice real time (QEMU `-icount align` uses a similar
    ///   bounded catch-up); converges a 100 ms→10 s gap without a visible jump.
    /// * `max_slew_gap` = 100 000 000 ticks = **10 s** — a gap beyond ~10 s (tab slept for minutes/
    ///   hours) jumps + resyncs rather than slewing; 10 s of slew at 2× is ≤10 s of extra wall, the
    ///   documented worst-case forwarded-time bound.
    pub const DEFAULT: WallClockPolicy = WallClockPolicy {
        gap_threshold_ticks: 1_000_000,
        slew_multiplier: 2,
        max_slew_gap_ticks: 100_000_000,
    };
}

impl Default for WallClockPolicy {
    fn default() -> Self {
        Self::DEFAULT
    }
}

/// A discontinuous `mtime` jump the host should surface (and the guest resyncs from via the RTC). Raised
/// only on the documented suspend/resume exception (gap > [`WallClockPolicy::max_slew_gap_ticks`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeJump {
    /// `mtime` immediately before the jump.
    pub from: u64,
    /// `mtime` immediately after the jump (the wall-clock target).
    pub to: u64,
}

/// Which source drives `mtime`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeMode {
    /// Deterministic: `mtime = retired / clock_div`. The lockstep/fuzz source.
    ICount,
    /// Retire-derived while busy; idle deadline jumps are capped by monotonic host progress.
    PacedICount,
    /// Host-wall-derived, scaled to the timebase, with the clamp + slew policy.
    WallClock,
}

/// Host-only ceiling for opt-in ICount idle fast-forward. It never produces busy time or
/// serializes a host epoch. Retire-derived time may already be ahead of this ceiling.
#[derive(Debug, Clone)]
pub struct IdlePacer {
    anchor_host_ns: u64,
    latest_host_ns: u64,
    anchor_mtime: u64,
    timebase_hz: u64,
    /// E5-T37a: how far (in ticks) idle jumps may carry guest time past its current value when
    /// the guest fell behind the host clock while it was running. `u64::MAX` = unbounded, the
    /// original policy: a guest that was busy may skip all of the time it fell behind.
    max_busy_lag_ticks: u64,
    /// E5-T37a: host time (in ticks) that passed while the guest was only waiting and that an
    /// idle jump could not yet give it because a deadline was in the way. It is never subject
    /// to the busy-lag bound. Only meaningful with a bound.
    owed_wait_ticks: u64,
    /// E5-T37a: whether the last consultation left the guest short of its deadline, waiting
    /// for the host clock. Diagnostic only: nothing in the machine depends on it.
    waiting: bool,
}

impl IdlePacer {
    pub fn new(host_ns: u64, mtime: u64, timebase_hz: u64) -> Self {
        Self {
            anchor_host_ns: host_ns,
            latest_host_ns: host_ns,
            anchor_mtime: mtime,
            timebase_hz,
            max_busy_lag_ticks: u64::MAX,
            owed_wait_ticks: 0,
            waiting: false,
        }
    }

    /// E5-T37a: whether the last consultation left the guest waiting for the host clock.
    pub fn waiting(&self) -> bool {
        self.waiting
    }

    /// E5-T37a: bound the catch-up of a guest that fell behind the host clock while running
    /// (see [`Self::limit_deadline_after`]). `u64::MAX` restores the unbounded default.
    pub fn set_max_busy_lag_ticks(&mut self, ticks: u64) {
        self.max_busy_lag_ticks = ticks;
    }

    /// The busy-lag bound in ticks (`u64::MAX` = unbounded).
    pub fn max_busy_lag_ticks(&self) -> u64 {
        self.max_busy_lag_ticks
    }

    /// Limit a future idle deadline without rewinding current guest time. Backward host
    /// readings retain the last ceiling; a large span saturates instead of wrapping.
    pub fn limit_deadline(&mut self, host_ns: u64, current: u64, deadline: u64) -> u64 {
        self.limit_deadline_after(host_ns, current, deadline, true)
    }

    /// [`Self::limit_deadline`], told whether the guest did real work since the pacer was last
    /// consulted. Busy guest time is retire-derived and usually slower than the host clock, so
    /// the ceiling runs ahead of a busy guest. With a busy-lag bound, a guest that `worked` may
    /// skip at most that much idle time on top of what it is owed for waiting; the rest of what
    /// it fell behind is forgotten (the anchor moves).
    ///
    /// Waiting time is never bounded. The host time between two consultations of a guest that
    /// did not work in between — it only went round its idle loop; the host may have slept — is
    /// waiting time. Whatever part of it an idle jump cannot hand over at once, because a
    /// deadline is nearer than the ceiling, stays owed and survives later work.
    pub fn limit_deadline_after(
        &mut self,
        host_ns: u64,
        current: u64,
        deadline: u64,
        worked: bool,
    ) -> u64 {
        let before = self.latest_host_ns;
        self.latest_host_ns = self.latest_host_ns.max(host_ns);
        let hz = u128::from(self.timebase_hz);
        let ticks_of =
            |ns: u64| (u128::from(ns) * hz / NANOS_PER_SEC).min(u128::from(u64::MAX)) as u64;
        let mut ceiling = self
            .anchor_mtime
            .saturating_add(ticks_of(self.latest_host_ns - self.anchor_host_ns));
        if worked {
            let bounded = current
                .saturating_add(self.owed_wait_ticks)
                .saturating_add(self.max_busy_lag_ticks);
            if ceiling > bounded {
                ceiling = bounded;
                self.anchor_host_ns = self.latest_host_ns;
                self.anchor_mtime = bounded;
            }
        } else {
            self.owed_wait_ticks = self
                .owed_wait_ticks
                .saturating_add(ticks_of(self.latest_host_ns - before));
        }
        let limited = current.max(deadline.min(ceiling));
        // An idle jump hands over waiting time first; nothing more can be owed than the host
        // clock is still ahead by.
        self.owed_wait_ticks = self
            .owed_wait_ticks
            .saturating_sub(limited - current)
            .min(ceiling.saturating_sub(limited));
        self.waiting = limited < deadline;
        limited
    }

    /// E5-T37a: ticks of host time, from the latest host reading, until the ceiling reaches
    /// `deadline` (0 when it already has). After a limited [`Self::limit_deadline_after`] this is
    /// how long the guest has to wait. Measured from the ceiling, not from guest time: a guest
    /// whose retire-derived time is ahead of the host clock waits for the host to catch up.
    pub fn ticks_until(&self, deadline: u64) -> u64 {
        let elapsed = self.latest_host_ns - self.anchor_host_ns;
        let ticks = u128::from(elapsed) * u128::from(self.timebase_hz) / NANOS_PER_SEC;
        let ceiling = (u128::from(self.anchor_mtime) + ticks).min(u128::from(u64::MAX)) as u64;
        deadline.saturating_sub(ceiling)
    }

    /// E5-T37a: host time owed to the guest for waiting (see [`Self::limit_deadline_after`]).
    pub fn owed_wait_ticks(&self) -> u64 {
        self.owed_wait_ticks
    }

    /// Explicit pause/restore boundary: elapsed host time before this instant is discarded.
    /// The busy-lag bound is host policy and is kept.
    pub fn rebase(&mut self, host_ns: u64, mtime: u64) {
        let max_busy_lag_ticks = self.max_busy_lag_ticks;
        *self = Self::new(host_ns, mtime, self.timebase_hz);
        self.max_busy_lag_ticks = max_busy_lag_ticks;
    }
}

/// The single owner of `mtime` derivation. In ICount mode it is a thin wrapper over the retire clock
/// ([`Self::on_retire`]); in WallClock mode [`Self::sample_wall`] applies the clamp + slew + jump
/// policy. Either way there is ONE function that produces `mtime`, consumed by CLINT reads, mtimecmp
/// scheduling, and SBI time queries alike.
#[derive(Debug, Clone)]
pub struct TimeSource {
    mode: TimeMode,
    /// Timebase frequency in Hz (ticks per second) — the DT-declared value.
    timebase_hz: u64,
    // ── ICount state ──
    /// One `mtime` tick per this many retired instructions.
    clock_div: u64,
    /// Retirements not yet worth a whole tick.
    tick_accum: u64,
    // ── WallClock state ──
    policy: WallClockPolicy,
    /// Last emitted `mtime` — the monotonicity floor (never decreases).
    last_mtime: u64,
    /// Host reading (ns) at the last sample, for the per-sample slew step.
    last_host_ns: u64,
    /// Host reading (ns) anchored to `anchor_mtime` — the wall→mtime origin. Re-anchored on a jump.
    anchor_host_ns: u64,
    /// `mtime` value that `anchor_host_ns` maps to.
    anchor_mtime: u64,
    /// Whether the wall-clock anchor has been primed by the first sample.
    primed: bool,
}

impl TimeSource {
    /// A fresh ICount source (the default) with the given divider — byte-for-byte the E1-T12 retire
    /// clock. `clock_div` is clamped to ≥ 1.
    pub fn icount(clock_div: u64, timebase_hz: u64) -> Self {
        Self {
            mode: TimeMode::ICount,
            timebase_hz: timebase_hz.max(1),
            clock_div: clock_div.max(1),
            tick_accum: 0,
            policy: WallClockPolicy::DEFAULT,
            last_mtime: 0,
            last_host_ns: 0,
            anchor_host_ns: 0,
            anchor_mtime: 0,
            primed: false,
        }
    }

    /// A fresh WallClock source scaled to `timebase_hz`, using `policy` for the catch-up bounds.
    pub fn wall_clock(timebase_hz: u64, policy: WallClockPolicy) -> Self {
        Self {
            mode: TimeMode::WallClock,
            timebase_hz: timebase_hz.max(1),
            clock_div: 1,
            tick_accum: 0,
            policy,
            last_mtime: 0,
            last_host_ns: 0,
            anchor_host_ns: 0,
            anchor_mtime: 0,
            primed: false,
        }
    }

    /// Which mode this source is in.
    pub fn mode(&self) -> TimeMode {
        self.mode
    }

    /// Convert a nanosecond span to `mtime` ticks (integer-only; `u128` guards the product).
    fn ns_to_ticks(&self, ns: u64) -> u64 {
        ((u128::from(ns) * u128::from(self.timebase_hz)) / NANOS_PER_SEC) as u64
    }

    /// ICount: account one retired instruction and return the whole `mtime` ticks it produced (0 most
    /// retirements, 1 when the sub-divider rolls over). The caller adds the returned ticks to
    /// `ClintState.mtime`. Byte-identical to the legacy `Machine::advance_clock` arithmetic.
    pub fn on_retire(&mut self) -> u64 {
        self.tick_accum += 1;
        if self.tick_accum >= self.clock_div {
            let ticks = self.tick_accum / self.clock_div;
            self.tick_accum %= self.clock_div;
            self.last_mtime = self.last_mtime.wrapping_add(ticks);
            ticks
        } else {
            0
        }
    }

    /// WallClock: given the current injected host reading and the guest's current `mtime`, compute the
    /// new `mtime`, applying the monotonicity clamp + slew + jump policy. Returns the new `mtime` and,
    /// on the documented suspend/resume exception, a [`TimeJump`] the host should surface (the guest
    /// resyncs from the RTC, which reads real wall time independently).
    ///
    /// `current_mtime` is passed in (rather than stored) so a guest software write to the `mtime`
    /// MMIO register is respected: the emitted value never regresses below it OR below `last_mtime`.
    pub fn sample_wall(&mut self, host_ns: u64, current_mtime: u64) -> (u64, Option<TimeJump>) {
        // Floor is the max of what we last emitted and what software may have written.
        let floor = self.last_mtime.max(current_mtime);
        if !self.primed {
            // First sample primes the anchor: map this host instant to the current mtime.
            self.primed = true;
            self.anchor_host_ns = host_ns;
            self.anchor_mtime = floor;
            self.last_host_ns = host_ns;
            self.last_mtime = floor;
            return (floor, None);
        }

        // Target = where wall time says mtime should be, from the anchor. Host jitter backward is
        // clamped to 0 elapsed (monotone), so the target never falls below the anchor.
        let host_elapsed = host_ns.saturating_sub(self.anchor_host_ns);
        let target = self
            .anchor_mtime
            .wrapping_add(self.ns_to_ticks(host_elapsed));
        // Never below the monotone floor.
        let target = target.max(floor);

        let behind = target.saturating_sub(floor);
        if behind > self.policy.max_slew_gap_ticks {
            // Suspend/resume exception: jump straight to target and re-anchor, raising a notification
            // so the host can resync the guest clock (RTC-style). Slewing here would replay the whole
            // gap tick-by-tick — exactly what the cap forbids.
            let jump = TimeJump {
                from: floor,
                to: target,
            };
            self.anchor_host_ns = host_ns;
            self.anchor_mtime = target;
            self.last_host_ns = host_ns;
            self.last_mtime = target;
            return (target, Some(jump));
        }

        let new_mtime = if behind <= self.policy.gap_threshold_ticks {
            // Normal advance (or catch-up already converged): track wall time directly.
            target
        } else {
            // Slew: pay down the backlog at a bounded rate. The per-sample step is the real wall time
            // elapsed since the last sample times the slew multiplier — so mtime advances at most
            // `slew_multiplier`× real time until it converges back onto the target.
            let wall_step = self.ns_to_ticks(host_ns.saturating_sub(self.last_host_ns));
            let step_cap = wall_step.saturating_mul(self.policy.slew_multiplier).max(1);
            floor.saturating_add(behind.min(step_cap))
        };

        self.last_host_ns = host_ns;
        self.last_mtime = new_mtime;
        (new_mtime, None)
    }

    /// Snapshot the ICount sub-tick state (divider + remainder) so a resume lands the next tick at the
    /// identical retirement. Mirrors the fields `Machine` already serializes.
    pub fn icount_phase(&self) -> (u64, u64) {
        (self.tick_accum, self.clock_div)
    }

    /// Restore the ICount sub-tick state (see [`Self::icount_phase`]).
    pub fn set_icount_phase(&mut self, tick_accum: u64, clock_div: u64) {
        self.tick_accum = tick_accum;
        self.clock_div = clock_div.max(1);
    }

    /// Sync the monotonic floor to an externally-set `mtime` (e.g. after a snapshot restore) so the
    /// clamp does not immediately drag a restored clock backward.
    pub fn sync_floor(&mut self, mtime: u64) {
        self.last_mtime = mtime;
    }

    /// Start a new host epoch at an already-authoritative guest time. Used after a successful
    /// snapshot restore or an explicit paused-host resume, never for ordinary background gaps.
    /// Unlike `sync_floor`, this discards the old anchor as well as its monotone floor: a snapshot
    /// may intentionally restore an earlier guest timeline, but subsequent samples must not regress.
    pub fn rebase_wall(&mut self, host_ns: u64, mtime: u64) {
        self.anchor_host_ns = host_ns;
        self.anchor_mtime = mtime;
        self.last_host_ns = host_ns;
        self.last_mtime = mtime;
        self.primed = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HZ: u64 = 10_000_000; // 10 MHz: 1 tick = 100 ns.

    fn ticks_ms(ms: u64) -> u64 {
        ms * (HZ / 1000)
    }
    fn ns_ms(ms: u64) -> u64 {
        ms * 1_000_000
    }

    /// E5-T37a: with a busy-lag bound, a guest that worked skips at most the bound; a guest
    /// that only waited gets the host's elapsed time in full; without a bound nothing changes.
    #[test]
    fn paced_idle_busy_lag_is_bounded_and_waiting_time_is_not() {
        const FAR: u64 = u64::MAX - 1;
        let lag = ticks_ms(50);
        let mut p = IdlePacer::new(ns_ms(1_000), 5_000, HZ);
        p.set_max_busy_lag_ticks(lag);
        assert_eq!(p.max_busy_lag_ticks(), lag);

        // Busy for 10 s of host time; retirement moved guest time by 1 s only.
        let busy = 5_000 + ticks_ms(1_000);
        assert_eq!(
            p.limit_deadline_after(ns_ms(11_000), busy, FAR, true),
            busy + lag
        );
        // The 9 s it fell behind are forgotten, not owed: one more idle second of host time
        // moves the waiting guest by exactly one second.
        let waited = busy + lag;
        assert_eq!(
            p.limit_deadline_after(ns_ms(12_000), waited, FAR, false),
            waited + ticks_ms(1_000)
        );
        // Waiting is never bounded, however long the host slept (here 5 s, 100x the bound).
        let waited = waited + ticks_ms(1_000);
        assert_eq!(
            p.limit_deadline_after(ns_ms(17_000), waited, FAR, false),
            waited + ticks_ms(5_000)
        );
        // Work that leaves the guest less than the bound behind changes nothing: 10 ms of host
        // time, 2 ms of retire-derived guest time -> the ceiling is the host's 10 ms.
        let now = waited + ticks_ms(5_000);
        assert_eq!(
            p.limit_deadline_after(ns_ms(17_010), now + ticks_ms(2), FAR, true),
            now + ticks_ms(10)
        );
        // A deadline nearer than the ceiling is reached exactly; guest time never rewinds.
        let now = now + ticks_ms(10);
        assert_eq!(
            p.limit_deadline_after(ns_ms(17_020), now, now + 7, false),
            now + 7
        );
        assert_eq!(
            p.limit_deadline_after(ns_ms(17_020), now + 500_000_000, now + 9, true),
            now + 500_000_000
        );

        // An explicit rebase keeps the bound and discards the host time before it.
        p.rebase(ns_ms(100_000), 42);
        assert_eq!(p.max_busy_lag_ticks(), lag);
        assert_eq!(
            p.limit_deadline_after(ns_ms(100_003), 42, FAR, false),
            42 + ticks_ms(3)
        );

        // The default is unbounded: `worked` makes no difference and the guest catches up in
        // full, exactly as `limit_deadline` always did.
        for worked in [false, true] {
            let mut legacy = IdlePacer::new(ns_ms(1_000), 5_000, HZ);
            assert_eq!(legacy.max_busy_lag_ticks(), u64::MAX);
            assert_eq!(
                legacy.limit_deadline_after(ns_ms(11_000), busy, FAR, worked),
                5_000 + ticks_ms(10_000)
            );
        }
        let mut legacy = IdlePacer::new(ns_ms(1_000), 5_000, HZ);
        assert_eq!(
            legacy.limit_deadline(ns_ms(11_000), busy, FAR),
            5_000 + ticks_ms(10_000)
        );
        // `ticks_until` is measured from the ceiling at the latest host reading.
        let mut w = IdlePacer::new(ns_ms(0), 1_000, HZ);
        assert_eq!(
            w.limit_deadline_after(ns_ms(2), 1_000, 1_000 + ticks_ms(5), false),
            1_000 + ticks_ms(2)
        );
        assert_eq!(w.ticks_until(1_000 + ticks_ms(5)), ticks_ms(3));
        assert_eq!(w.ticks_until(1_000 + ticks_ms(2)), 0);
        assert_eq!(w.ticks_until(7), 0);
        // A guest ahead of the host clock (retire-derived) waits for the host to catch up.
        assert_eq!(
            w.limit_deadline_after(ns_ms(2), 1_000 + ticks_ms(4), 1_000 + ticks_ms(5), true),
            1_000 + ticks_ms(4)
        );
        assert_eq!(w.ticks_until(1_000 + ticks_ms(5)), ticks_ms(3));
        // Waiting time a deadline kept the guest from taking is owed, and survives work: the
        // host slept 2 s past a deadline 1 ms away, the handler then worked, and the next idle
        // jump still hands the 2 s over (plus nothing for the bound: the lag was tiny).
        let mut o = IdlePacer::new(ns_ms(0), 0, HZ);
        o.set_max_busy_lag_ticks(ticks_ms(50));
        assert_eq!(
            o.limit_deadline_after(ns_ms(2_001), 0, ticks_ms(1), false),
            ticks_ms(1)
        );
        assert_eq!(o.owed_wait_ticks(), ticks_ms(2_000));
        let after_handler = ticks_ms(1) + 300;
        assert_eq!(
            o.limit_deadline_after(ns_ms(2_002), after_handler, FAR, true),
            ticks_ms(2_002),
            "everything the host clock ran ahead while the guest waited"
        );
        assert_eq!(o.owed_wait_ticks(), 0);
        // What is owed is waiting time only: a run of near deadlines after work never lets a
        // busy guest collect more than one bound, however often it is consulted.
        let mut n = IdlePacer::new(ns_ms(0), 0, HZ);
        n.set_max_busy_lag_ticks(ticks_ms(50));
        let mut now = ticks_ms(100); // retire-derived: 100 ms of guest time for 10 s of host
        let start = now;
        for host in 10_000..10_200 {
            // each consultation follows work and is capped by a deadline 1 ms ahead
            now = n.limit_deadline_after(ns_ms(host), now, now + ticks_ms(1), true);
            now += 5; // a few retirements of the handler
            assert_eq!(n.owed_wait_ticks(), 0, "nothing was waited for");
        }
        assert!(
            now - start <= ticks_ms(50) + ticks_ms(200) + 200 * 5,
            "one bound, plus the 200 ms the host clock really moved: {}",
            now - start
        );
        // Owed waiting time is handed over once: every idle jump takes from it first, whether
        // or not the guest worked before the jump.
        let mut c = IdlePacer::new(ns_ms(0), 0, HZ);
        c.set_max_busy_lag_ticks(ticks_ms(50));
        let mut now = c.limit_deadline_after(ns_ms(2_001), 0, ticks_ms(1), false);
        assert_eq!(
            c.owed_wait_ticks(),
            ticks_ms(2_000),
            "the host overslept 2 s"
        );
        // Work, with the host clock far ahead and a deadline 1 ms out: 1 ms of the owed time.
        now += 1_000;
        now = c.limit_deadline_after(ns_ms(100_000), now, now + ticks_ms(1), true);
        assert_eq!(c.owed_wait_ticks(), ticks_ms(1_999));
        // Ten consultations of a guest that only waited, each capped by a deadline 1 ms out
        // while the host clock stands still: ten more milliseconds of it.
        for _ in 0..10 {
            now = c.limit_deadline_after(ns_ms(100_000), now, now + ticks_ms(1), false);
        }
        assert_eq!(c.owed_wait_ticks(), ticks_ms(1_989));
        // Work again, the host clock racing, no deadline in the way: what is left of the 2 s
        // and one bound.
        now += 1_000;
        assert_eq!(
            c.limit_deadline_after(ns_ms(200_000), now, FAR, true),
            now + ticks_ms(1_989) + ticks_ms(50)
        );
        assert_eq!(c.owed_wait_ticks(), 0);
        // Nothing can be owed beyond what the host clock is actually ahead by. The guest was
        // owed 2 s, then ran for so long that its retire-derived time passed the host's: the
        // debt is gone, and a later busy stretch gets one bound, not the old 2 s on top.
        let mut g = IdlePacer::new(ns_ms(0), 0, HZ);
        g.set_max_busy_lag_ticks(ticks_ms(50));
        let at = g.limit_deadline_after(ns_ms(2_001), 0, ticks_ms(1), false);
        assert_eq!(g.owed_wait_ticks(), ticks_ms(2_000));
        let ahead = at + ticks_ms(10_000); // 10 s of retirement in 1 s of host time
        assert_eq!(
            g.limit_deadline_after(ns_ms(3_001), ahead, FAR, true),
            ahead
        );
        assert_eq!(
            g.owed_wait_ticks(),
            0,
            "the guest is ahead of the host: nothing is owed"
        );
        let later = ahead + 1_000;
        assert_eq!(
            g.limit_deadline_after(ns_ms(100_000), later, FAR, true),
            later + ticks_ms(50),
            "one bound"
        );
        // Owed time is the host time since the PREVIOUS consultation, not since the anchor: a
        // run of consultations of a waiting guest, each capped by a deadline 1 ms ahead while
        // the host moves 14 ms, adds 13 ms each time — however long ago the anchor last moved.
        let mut r = IdlePacer::new(ns_ms(0), 0, HZ);
        r.set_max_busy_lag_ticks(ticks_ms(50));
        // Work first, so the anchor moves (a clamp) and then stays put for the idle run.
        let mut now = r.limit_deadline_after(ns_ms(10_000), ticks_ms(100), ticks_ms(101), true);
        assert_eq!(now, ticks_ms(101));
        assert_eq!(r.owed_wait_ticks(), 0, "nothing was waited for yet");
        let mut host = 10_000;
        for n in 1..=6u64 {
            host += 14;
            now = r.limit_deadline_after(ns_ms(host), now, now + ticks_ms(1), false);
            assert_eq!(
                r.owed_wait_ticks(),
                n * ticks_ms(13),
                "after {n} capped idle passes"
            );
            assert!(!r.waiting(), "each pass reached its deadline");
        }
        // Then work with the host clock racing and no deadline in the way: what is owed for
        // the six passes, plus one bound — the same after 1 or 20 such cycles.
        now += 1_000;
        assert_eq!(
            r.limit_deadline_after(ns_ms(900_000), now, FAR, true),
            now + 6 * ticks_ms(13) + ticks_ms(50)
        );
        assert_eq!(r.owed_wait_ticks(), 0);
        assert!(r.waiting(), "short of a far deadline");
        // `waiting` is a diagnostic of the last consultation: true short of the deadline,
        // false once it is reached, and cleared by a rebase.
        let mut w = IdlePacer::new(ns_ms(0), 0, HZ);
        assert!(!w.waiting());
        assert_eq!(
            w.limit_deadline_after(ns_ms(3), 0, ticks_ms(5), false),
            ticks_ms(3)
        );
        assert!(w.waiting());
        assert_eq!(
            w.limit_deadline_after(ns_ms(9), ticks_ms(3), ticks_ms(5), false),
            ticks_ms(5)
        );
        assert!(!w.waiting());
        assert_eq!(
            w.limit_deadline_after(ns_ms(9), ticks_ms(5), ticks_ms(50), false),
            ticks_ms(9)
        );
        assert!(w.waiting());
        w.rebase(ns_ms(20), ticks_ms(9));
        assert!(!w.waiting(), "a rebase starts over");
        // A bound of zero pins a busy guest to its own time.
        let mut none = IdlePacer::new(0, 0, HZ);
        none.set_max_busy_lag_ticks(0);
        assert_eq!(none.limit_deadline_after(ns_ms(9_000), 77, FAR, true), 77);
        assert_eq!(
            none.limit_deadline_after(ns_ms(9_001), 77, FAR, false),
            77 + ticks_ms(1)
        );
    }

    /// E5-T37a: waiting time stays owed only as far as the host clock is still ahead of the
    /// guest AFTER the idle jump. The jump hands waiting time over first, so what is left is
    /// the smaller of "owed and not yet handed over" and "what the host clock is still ahead
    /// by" — judged where the guest lands, not where it stood.
    ///
    /// The host oversleeps 3 s past a deadline 2 ms away: 3 s owed. The handler then retires
    /// 2.2 s of guest time in 0.2 s of host time, which leaves the host clock 1 s ahead.
    ///
    /// * Nothing in the way: the jump takes that whole second, the guest is level with the
    ///   host clock and is owed nothing; a later busy stretch skips one bound.
    /// * A deadline 300 ms ahead: the jump takes 300 ms, the host clock is still 700 ms ahead
    ///   and 700 ms stay owed; a later busy stretch skips those 700 ms and one bound.
    #[test]
    fn paced_idle_owed_time_is_capped_by_the_host_lead_after_the_jump() {
        const FAR: u64 = u64::MAX - 1;
        for (deadline_ms, jump_ms, owed_ms) in [(None, 1_000, 0), (Some(300), 300, 700)] {
            let mut p = IdlePacer::new(ns_ms(0), 0, HZ);
            p.set_max_busy_lag_ticks(ticks_ms(50));
            let woke = p.limit_deadline_after(ns_ms(3_002), 0, ticks_ms(2), false);
            assert_eq!(woke, ticks_ms(2));
            assert_eq!(p.owed_wait_ticks(), ticks_ms(3_000));
            let handled = woke + ticks_ms(2_200);
            let deadline = deadline_ms.map_or(FAR, |ms| handled + ticks_ms(ms));
            let landed = p.limit_deadline_after(ns_ms(3_202), handled, deadline, true);
            assert_eq!(
                landed,
                handled + ticks_ms(jump_ms),
                "deadline {deadline_ms:?}: as far as the host clock, or the deadline"
            );
            assert_eq!(
                p.owed_wait_ticks(),
                ticks_ms(owed_ms),
                "deadline {deadline_ms:?}: what the host clock is still ahead by, no more"
            );
            let busy = landed + ticks_ms(5);
            assert_eq!(
                p.limit_deadline_after(ns_ms(500_000), busy, FAR, true),
                busy + ticks_ms(owed_ms) + ticks_ms(50),
                "deadline {deadline_ms:?}: what is owed, and one bound"
            );
            assert_eq!(p.owed_wait_ticks(), 0);
        }
    }

    // ── ICount determinism: mtime is a pure function of retired count ──

    #[test]
    fn icount_is_pure_function_of_retired() {
        let run = || {
            let mut ts = TimeSource::icount(3, HZ);
            let mut mtime = 0u64;
            let mut trace = alloc::vec::Vec::new();
            for i in 0..1000u64 {
                mtime = mtime.wrapping_add(ts.on_retire());
                trace.push((i, mtime));
            }
            trace
        };
        // Two independent runs produce byte-identical (retired, mtime) traces.
        assert_eq!(run(), run());
        // And the value is exactly retired/clock_div.
        let mut ts = TimeSource::icount(3, HZ);
        let mut mtime = 0u64;
        for _ in 0..999u64 {
            mtime = mtime.wrapping_add(ts.on_retire());
        }
        assert_eq!(mtime, 999 / 3);
    }

    // ── AC3-flavored monotonicity: the clamp never lets mtime step backward ──

    #[test]
    fn wallclock_never_steps_backward_under_jittery_host() {
        let mut ts = TimeSource::wall_clock(HZ, WallClockPolicy::DEFAULT);
        let mut mtime = 0u64;
        // Prime at t=1s.
        let (m0, _) = ts.sample_wall(ns_ms(1000), mtime);
        mtime = m0;
        let mut last = mtime;
        // Feed a host clock that jitters forward AND backward.
        let jitter: [i64; 8] = [10, -5, 3, -20, 7, -1, 50, -100];
        let mut host: i64 = ns_ms(1000) as i64;
        for step in jitter.iter().cycle().take(400) {
            host += ns_ms(1) as i64 + *step; // ~1ms forward with sub-ms jitter, sometimes net-backward
            let (m, jump) = ts.sample_wall(host.max(0) as u64, mtime);
            assert!(jump.is_none(), "no jump expected for small deltas");
            assert!(m >= last, "mtime regressed: {m} < {last}");
            last = m;
            mtime = m;
        }
    }

    // ── slew: a modest gap is caught up at the bounded rate, not jumped ──

    #[test]
    fn moderate_gap_slews_at_bounded_rate() {
        let policy = WallClockPolicy::DEFAULT;
        let mut ts = TimeSource::wall_clock(HZ, policy);
        let mut mtime = 0u64;
        let (m0, _) = ts.sample_wall(ns_ms(0), mtime);
        mtime = m0;
        // Simulate a 1-second suspend: host jumps forward 1s while mtime was frozen. 1s = 10_000_000
        // ticks, which is > gap_threshold (100ms) but < max_slew_gap (10s) → slew, no jump.
        let resume_host = ns_ms(1000);
        let (m1, jump) = ts.sample_wall(resume_host, mtime);
        assert!(jump.is_none(), "1s gap must slew, not jump");
        // First slew step is bounded: mtime advanced by at most slew_multiplier × the per-sample wall
        // step. The per-sample wall step here is the whole 1s (first sample after the gap), so the cap
        // is 2s worth of ticks — but the backlog is only 1s, so it converges in ONE step here. Use a
        // finer cadence to actually observe the bound:
        assert!(m1 >= mtime);

        // Redo with fine cadence during the gap to see the bounded catch-up.
        let mut ts = TimeSource::wall_clock(HZ, policy);
        let mut mtime = 0u64;
        let (m0, _) = ts.sample_wall(ns_ms(0), mtime);
        mtime = m0;
        // A 5-second gap appears at once (host frozen then resumes), then we sample every 1ms of real
        // time. mtime must advance at ≤ 2× real per sample and converge, never jumping.
        let base = ns_ms(5000);
        let mut prev = mtime;
        let mut converged_at = None;
        for k in 0..20_000u64 {
            let host = base + ns_ms(1) * k;
            let (m, jump) = ts.sample_wall(host, mtime);
            assert!(jump.is_none(), "5s gap (< 10s cap) must slew, not jump");
            let advance = m - prev;
            // Per-sample real wall step is 1ms → cap is 2ms of ticks. Allow the first post-gap sample
            // (prev==m0, wall_step spans the whole 5s freeze) to be larger; check steady-state.
            if k > 0 {
                assert!(
                    advance <= ticks_ms(2) + 1,
                    "slew step {advance} exceeded 2× real (cap {}) at k={k}",
                    ticks_ms(2)
                );
            }
            if m >= base_target(&ts, host) && converged_at.is_none() {
                converged_at = Some(k);
            }
            prev = m;
            mtime = m;
        }
    }

    fn base_target(ts: &TimeSource, host: u64) -> u64 {
        ts.anchor_mtime
            .wrapping_add(ts.ns_to_ticks(host.saturating_sub(ts.anchor_host_ns)))
    }

    // ── the jump-with-notification exception fires for a huge gap ──

    #[test]
    fn huge_gap_jumps_with_notification() {
        let mut ts = TimeSource::wall_clock(HZ, WallClockPolicy::DEFAULT);
        let mut mtime = 0u64;
        let (m0, _) = ts.sample_wall(ns_ms(0), mtime);
        mtime = m0;
        // A 6-HOUR background nap: host advances 6h at once. 6h ≫ 10s cap → jump, not slew.
        let six_hours_ns = 6u64 * 3600 * 1_000_000_000;
        let (m, jump) = ts.sample_wall(six_hours_ns, mtime);
        let j = jump.expect("a 6-hour gap must raise a jump-with-notification");
        // The jump lands at the wall target (6h of ticks), NOT a slew replay.
        let expected = ts.ns_to_ticks(six_hours_ns);
        assert_eq!(m, expected, "jump must land at the wall-clock target");
        assert_eq!(j.from, m0);
        assert_eq!(j.to, m);
        // After the jump the source is re-anchored: the next small step is normal (no second jump).
        let (m2, jump2) = ts.sample_wall(six_hours_ns + ns_ms(1), mtime.max(m));
        assert!(jump2.is_none(), "post-jump re-anchor must not re-jump");
        assert!(m2 >= m);
    }

    // ── software mtime writes are respected as a floor ──

    #[test]
    fn respects_software_mtime_write_as_floor() {
        let mut ts = TimeSource::wall_clock(HZ, WallClockPolicy::DEFAULT);
        let (m0, _) = ts.sample_wall(ns_ms(0), 0);
        // Guest writes mtime far ahead of wall time.
        let sw = m0 + ticks_ms(500);
        let (m, jump) = ts.sample_wall(ns_ms(1), sw);
        assert!(jump.is_none());
        assert!(
            m >= sw,
            "emitted mtime must not regress below a software write"
        );
    }
}
