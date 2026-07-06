//! Interrupt-storm / livelock / WFI-deadlock instrumentation (E2-T20).
//!
//! The three failure shapes every emulator bring-up hits: a **storm** (a level-triggered line
//! re-enters the trap handler endlessly — trap rate ≫ instruction progress), a **livelock**
//! (a trap is delivered but the guest re-executes the same faulting PC forever), and a
//! **deadlock** (`WFI` with no enabled+possible wakeup source, so the machine idles forever).
//!
//! [`IrqStats`] is plain-counter instrumentation: every hook is a single increment, and the
//! detectors run only on the dispatch-quantum boundary — so it is cheap enough to leave on.
//! Counts are fixed arrays (no `HashMap` / time / rand — the determinism gate) keyed by the
//! low bits of `scause` and by PLIC source id.

use alloc::format;
use alloc::string::String;

/// PLIC sources (matches [`crate::dev::plic::NUM_SOURCES`]).
pub const NUM_IRQ: usize = 32;
/// `scause` exception/interrupt code space we bucket by (codes 0..=15).
pub const NUM_CAUSE: usize = 16;

/// A storm diagnosis: sustained trap rate with the hottest line named.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StormReport {
    /// Traps in the window that tripped the detector.
    pub window_traps: u64,
    /// Retired instructions in that window.
    pub window_retired: u64,
    /// The PLIC source with the most claims (id, count), if any external IRQ is hot.
    pub hot_irq: Option<(usize, u64)>,
}

/// Always-on interrupt/trap counters + the sliding-window storm detector.
#[derive(Clone)]
pub struct IrqStats {
    /// Retired instructions (the progress signal the storm rate is measured against).
    pub retired: u64,
    /// Synchronous exceptions taken, by `scause` code (0..=15).
    pub exc: [u64; NUM_CAUSE],
    /// Interrupts taken, by `scause` code (0..=15; the interrupt bit is stripped).
    pub int: [u64; NUM_CAUSE],
    /// PLIC CLAIMs, by source id (0..=31).
    pub claims: [u64; NUM_IRQ],
    /// `WFI` instructions retired.
    pub wfi: u64,
    /// The most recent storm the detector fired on (observable by the host / tests / wasm).
    pub last_storm: Option<StormReport>,
    /// The most recent WFI-deadlock report string (observable by the host / tests / wasm).
    pub last_wfi_report: Option<String>,
    /// A WFI watchdog report was already emitted (fire once per stuck episode).
    wfi_reported: bool,

    // --- sliding-window storm detector state ---
    window_traps: u64,
    window_start_retired: u64,
    consecutive_hot: u32,
    /// PLIC claim counts at the start of the current window — subtracted from the live counts to
    /// name the line hot IN THIS window (not the all-time leader; critic #2).
    claims_window_start: [u64; NUM_IRQ],
}

impl Default for IrqStats {
    fn default() -> Self {
        Self {
            retired: 0,
            exc: [0; NUM_CAUSE],
            int: [0; NUM_CAUSE],
            claims: [0; NUM_IRQ],
            wfi: 0,
            last_storm: None,
            last_wfi_report: None,
            wfi_reported: false,
            window_traps: 0,
            window_start_retired: 0,
            consecutive_hot: 0,
            claims_window_start: [0; NUM_IRQ],
        }
    }
}

impl IrqStats {
    pub fn new() -> Self {
        Self::default()
    }

    /// One retired instruction (the progress denominator). A single increment.
    #[inline]
    pub fn on_retire(&mut self) {
        self.retired += 1;
    }

    /// A synchronous exception was delivered (`scause` low bits).
    #[inline]
    pub fn on_exception(&mut self, cause: u64) {
        let c = (cause as usize) & (NUM_CAUSE - 1);
        self.exc[c] += 1;
        self.window_traps += 1;
    }

    /// An interrupt was delivered (`scause` with the interrupt bit already stripped by the
    /// caller, or the raw value — only the low 4 bits are used).
    #[inline]
    pub fn on_interrupt(&mut self, cause: u64) {
        let c = (cause as usize) & (NUM_CAUSE - 1);
        self.int[c] += 1;
        self.window_traps += 1;
    }

    /// A PLIC CLAIM returned source `id` (0 = spurious/none, ignored).
    #[inline]
    pub fn on_claim(&mut self, id: u32) {
        if id != 0 && (id as usize) < NUM_IRQ {
            self.claims[id as usize] += 1;
        }
    }

    /// A `WFI` retired. Arms the watchdog to look for a stuck-idle episode.
    #[inline]
    pub fn on_wfi(&mut self) {
        self.wfi += 1;
    }

    /// The PLIC source with the most CUMULATIVE claims (for the `--stats` dump). The storm
    /// detector does NOT use this for naming — it uses per-window deltas (see `check_storm`).
    pub fn hottest_irq(&self) -> Option<(usize, u64)> {
        self.claims
            .iter()
            .enumerate()
            .filter(|&(_, &c)| c > 0)
            .max_by_key(|&(_, &c)| c)
            .map(|(i, &c)| (i, c))
    }

    /// The PLIC source that claimed the MOST in the current window (live `claims` minus the
    /// window-start snapshot) — this is what names a storming line correctly even if some other
    /// line has a bigger lifetime total (critic #2).
    fn hottest_irq_in_window(&self) -> Option<(usize, u64)> {
        self.claims
            .iter()
            .zip(self.claims_window_start.iter())
            .enumerate()
            .map(|(i, (&now, &start))| (i, now.saturating_sub(start)))
            .filter(|&(_, d)| d > 0)
            .max_by_key(|&(_, d)| d)
    }

    /// Sliding-window storm check — call when a trap lands (interrupt OR exception). A window
    /// closes once `window` instructions have retired; the trap RATE (`traps` normalized to the
    /// window's actual retired length, since traps may be sparse) exceeding `threshold / window`
    /// makes it a "hot" window. `needed` consecutive hot windows fire a [`StormReport`] naming
    /// the line hot IN the firing window, and reset the streak (one storm reports once). Windows
    /// too short to close yet return `None`. Callers should sync live PLIC claims into
    /// [`Self::claims`] before calling so the naming is current.
    pub fn check_storm(&mut self, window: u64, threshold: u64, needed: u32) -> Option<StormReport> {
        let window = window.max(1);
        let retired_in_window = self.retired.saturating_sub(self.window_start_retired);
        if retired_in_window < window {
            // Sweep-critic (E2-T20, MEDIUM): a ZERO-progress trap loop (mtvec pointing at a
            // faulting instruction) never retires, so a retire-count window would never close
            // and the most total storm possible stayed invisible forever. Fire on the raw
            // in-window trap count alone once it exceeds 3x the threshold — with the window
            // still open, that many traps against so few retires is a storm by any reading.
            if self.window_traps > threshold.saturating_mul(3) {
                let traps = self.window_traps;
                let hot = self.hottest_irq_in_window();
                self.window_start_retired = self.retired;
                self.window_traps = 0;
                self.claims_window_start = self.claims;
                self.consecutive_hot = 0;
                let report = StormReport {
                    window_traps: traps,
                    window_retired: retired_in_window,
                    hot_irq: hot,
                };
                self.last_storm = Some(report.clone());
                return Some(report);
            }
            return None; // window still open
        }
        let traps = self.window_traps;
        let hot = self.hottest_irq_in_window();
        // Close the window: reset trap count, advance retired baseline, snapshot claims.
        self.window_start_retired = self.retired;
        self.window_traps = 0;
        self.claims_window_start = self.claims;
        // Rate normalization (critic #5): compare traps/retired to threshold/window without
        // division — `traps * window > threshold * retired_in_window`.
        let hot_window =
            (traps as u128) * (window as u128) > (threshold as u128) * (retired_in_window as u128);
        if hot_window {
            self.consecutive_hot += 1;
            if self.consecutive_hot >= needed {
                self.consecutive_hot = 0;
                let report = StormReport {
                    window_traps: traps,
                    window_retired: retired_in_window,
                    hot_irq: hot,
                };
                self.last_storm = Some(report.clone());
                return Some(report);
            }
        } else {
            self.consecutive_hot = 0;
        }
        None
    }

    /// WFI-deadlock watchdog: given the guest just idled on `WFI` and whether ANY wakeup source
    /// is armed (a timer deadline, or any pending/enabled device interrupt line), decide
    /// whether to emit a one-shot "stuck in WFI with no wakeup" report. Returns the report
    /// string once per stuck episode; re-arms after `any_wakeup_armed` becomes true again.
    pub fn wfi_watchdog(&mut self, idling_on_wfi: bool, any_wakeup_armed: bool) -> Option<String> {
        if !idling_on_wfi || any_wakeup_armed {
            self.wfi_reported = false; // making progress / has a wakeup → re-arm
            return None;
        }
        if self.wfi_reported {
            return None; // already reported this episode
        }
        self.wfi_reported = true;
        let msg = format!(
            "WFI with no wakeup source armed — the guest will idle forever (no timer deadline, \
             no pending+enabled device interrupt). retired={}, wfi_count={}",
            self.retired, self.wfi
        );
        self.last_wfi_report = Some(msg.clone());
        Some(msg)
    }

    /// Human-readable counter dump (the `--stats` body). Lists nonzero exception/interrupt
    /// causes and the top PLIC claim lines.
    pub fn dump(&self) -> String {
        let mut s = String::new();
        s.push_str(&format!(
            "=== irq/trap stats ===\nretired={}  wfi={}\n",
            self.retired, self.wfi
        ));
        s.push_str("exceptions (scause):");
        for (c, &n) in self.exc.iter().enumerate() {
            if n > 0 {
                s.push_str(&format!(" [{c}]={n}"));
            }
        }
        s.push_str("\ninterrupts (scause):");
        for (c, &n) in self.int.iter().enumerate() {
            if n > 0 {
                s.push_str(&format!(" [{c}]={n}"));
            }
        }
        s.push_str("\nPLIC claims (irq):");
        for (i, &n) in self.claims.iter().enumerate() {
            if n > 0 {
                s.push_str(&format!(" [{i}]={n}"));
            }
        }
        s.push('\n');
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storm_fires_after_consecutive_hot_windows() {
        let mut s = IrqStats::new();
        // Simulate 3 windows of 1000 retires each with 100 traps/window (threshold 50).
        for _ in 0..3 {
            for _ in 0..1000 {
                s.on_retire();
            }
            for _ in 0..100 {
                s.on_interrupt(9); // S-external
            }
            s.on_claim(10); // UART claims once THIS window
            let r = s.check_storm(1000, 50, 3);
            // Only the 3rd window (3 consecutive hot) fires.
            if s.retired == 3000 {
                let r = r.expect("storm fires on the 3rd consecutive hot window");
                // Per-WINDOW delta (critic #2): 1 claim in the firing window, not the cumulative 3.
                assert_eq!(
                    r.hot_irq,
                    Some((10, 1)),
                    "names IRQ 10 as the hot line (this window)"
                );
                assert!(r.window_traps >= 100);
            } else {
                assert!(r.is_none(), "no fire before 3 consecutive hot windows");
            }
        }
    }

    #[test]
    fn quiet_windows_never_fire_and_reset_the_streak() {
        let mut s = IrqStats::new();
        // hot, hot, QUIET, hot, hot — the quiet window resets the streak so no run of 3
        // consecutive hot windows ever forms, hence no fire.
        let hot = [true, true, false, true, true];
        for &is_hot in &hot {
            for _ in 0..1000 {
                s.on_retire();
            }
            let traps = if is_hot { 100 } else { 1 };
            for _ in 0..traps {
                s.on_exception(5);
            }
            assert!(
                s.check_storm(1000, 50, 3).is_none(),
                "a quiet window breaks the streak → never 3 consecutive hot"
            );
        }
    }

    #[test]
    fn window_stays_open_until_enough_retired() {
        let mut s = IrqStats::new();
        for _ in 0..500 {
            s.on_retire();
        }
        s.on_interrupt(9);
        assert!(
            s.check_storm(1000, 0, 1).is_none(),
            "500 < 1000 window → open"
        );
        for _ in 0..500 {
            s.on_retire();
        }
        assert!(
            s.check_storm(1000, 0, 1).is_some(),
            "window closes at 1000 with traps > 0"
        );
    }

    #[test]
    fn wfi_watchdog_fires_once_then_rearms() {
        let mut s = IrqStats::new();
        // Idle on WFI with nothing armed → one report.
        assert!(s.wfi_watchdog(true, false).is_some(), "reports stuck WFI");
        assert!(
            s.wfi_watchdog(true, false).is_none(),
            "only once per episode"
        );
        // A wakeup gets armed → re-arm.
        assert!(
            s.wfi_watchdog(true, true).is_none(),
            "armed wakeup → no report"
        );
        assert!(
            s.wfi_watchdog(true, false).is_some(),
            "re-fires after re-arming"
        );
    }

    #[test]
    fn wfi_watchdog_silent_when_making_progress_or_armed() {
        let mut s = IrqStats::new();
        assert!(
            s.wfi_watchdog(false, false).is_none(),
            "not idling → silent"
        );
        assert!(s.wfi_watchdog(true, true).is_none(), "timer armed → silent");
    }

    #[test]
    fn naming_uses_the_window_not_the_lifetime_leader() {
        // Critic #2: IRQ 10 claims heavily in windows 0-1 then goes quiet; IRQ 11 storms in
        // windows 2-4. The firing window must name IRQ 11 (this-window delta), NOT IRQ 10
        // (which still has the larger lifetime total).
        let mut s = IrqStats::new();
        let claim_pattern = [(10, 500), (10, 500), (11, 10), (11, 10), (11, 10)];
        let mut fired = None;
        for &(irq, n) in &claim_pattern {
            for _ in 0..1000 {
                s.on_retire();
            }
            for _ in 0..100 {
                s.on_exception(2); // keep every window "hot" so the streak builds
            }
            for _ in 0..n {
                s.on_claim(irq);
            }
            if let Some(r) = s.check_storm(1000, 50, 3) {
                fired = Some(r);
            }
        }
        let r = fired.expect("storm fired");
        assert_eq!(
            r.hot_irq.map(|(id, _)| id),
            Some(11),
            "names the line hot IN the firing window (11), not the lifetime leader (10)"
        );
    }

    #[test]
    fn hottest_irq_picks_the_max() {
        let mut s = IrqStats::new();
        assert_eq!(s.hottest_irq(), None);
        for _ in 0..3 {
            s.on_claim(10);
        }
        for _ in 0..7 {
            s.on_claim(11);
        }
        assert_eq!(s.hottest_irq(), Some((11, 7)));
    }
}
