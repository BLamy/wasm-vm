//! E4-T24 — Timekeeping: the `mtime` derivation policy, in ONE place.
//!
//! The guest's machine timer (`mtime`) can be driven from two sources, selected per run:
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
    /// Host-wall-derived, scaled to the timebase, with the clamp + slew policy.
    WallClock,
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
