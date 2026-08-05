//! The injected HOST monotonic timer for scoped subsystem timing (E4-T01).
//!
//! `crates/core` never names `std::Instant` or `performance.now()` — the determinism /
//! `no_std` boundary bans any direct host time call (same rule as [`crate::dev::rtc::WallClock`]).
//! So a scoped timer is an injected trait the outer crates implement: the CLI wraps a monotonic
//! `Instant`, wasm wraps `performance.now()`, and tests use the deterministic [`FixedTimer`].
//!
//! # Why this is a SEPARATE trait from [`crate::dev::rtc::WallClock`]
//! `WallClock` is *wall / epoch* time — nanoseconds since 1970, and explicitly **NOT** required
//! to be monotonic (its doc says the RTC tolerates the host clock stepping backwards). Profiling
//! measures DURATIONS by subtracting two reads, so a non-monotonic source would produce negative
//! (wrapping) intervals and garbage attribution. [`HostTimer`] therefore carries a stricter
//! contract — non-decreasing — and a distinct name, so a caller can never accidentally hand the
//! RTC's steppable wall clock to the profiler (or vice-versa).

/// A monotonic, high-resolution HOST timer, injected so core never names `std::Instant` or
/// `performance.now()` (preserving the `no_std` / determinism boundary — outer crates provide the
/// impl).
pub trait HostTimer {
    /// Monotonic host time in nanoseconds. MUST be non-decreasing across calls (durations are
    /// computed by subtracting two reads; a backward step would underflow the interval).
    fn now_ns(&self) -> u64;
}

/// Deterministic mock for tests: returns whatever it is set to, advanceable by the test so a unit
/// test can script an exact sequence of "host" instants without ever reading a real clock. Uses a
/// [`Cell`](core::cell::Cell) so `now_ns(&self)` can read the scripted value through a shared
/// reference (the trait takes `&self`).
pub struct FixedTimer(core::cell::Cell<u64>);

impl FixedTimer {
    /// A timer frozen at `start` nanoseconds.
    pub fn new(start: u64) -> Self {
        Self(core::cell::Cell::new(start))
    }
    /// Jump the timer to an absolute value `v`.
    pub fn set(&self, v: u64) {
        self.0.set(v);
    }
    /// Advance the timer by `d` nanoseconds (saturating, so a test can never accidentally step it
    /// backwards and violate the monotonic contract).
    pub fn advance(&self, d: u64) {
        self.0.set(self.0.get().saturating_add(d));
    }
}

impl HostTimer for FixedTimer {
    fn now_ns(&self) -> u64 {
        self.0.get()
    }
}
