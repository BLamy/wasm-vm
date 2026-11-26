// ─────────────────────────────────────────────────────────────────────────────────────────────
// E5-T37a — the ROUND 4 VERIFIER's tests (verdict `needs-evidence`, commit 84bb49b1a). Written
// by the first round-4 critic session, which was interrupted before it wrote a verdict, and
// checked by the second, which wrote it (neither is the worker or an earlier verifier): the
// pacer (`time::IdlePacer`) alone. Every test name starts `r4_`.
//
// Source: evidence/e5-t37a/verifier-r4/verifier_r4_tests.rs (sha256 1adbc5673278).
// Part of the suite since the task's `verified` verdict (round 5, 2026-11-26): promoted from
// `evidence/` by the ROUND 5 verifier with evidence/e5-t37a/verifier-r5/promote.py.
// `include!`d by `../turbo_equivalence_tests.rs`, in order round1, round2, round3, round4:
// each file uses that module's assembler and helpers and those of the files before it (rounds
// 1 and 2 also use `R3Vouch` and `r3_levels` from round3.rs). None of these tests has
// `paced_idle` in its path, so the task's acceptance command
// `cargo test -p wasm-vm-core --lib paced_idle` selects the worker's tests only, as before.
//
// Why they exist: the cap on owed waiting time judged BEFORE the idle jump instead of after it
// (`time.rs`, `.min(ceiling.saturating_sub(limited))` -> `…sub(current)`) survived every test
// that existed in round 4; it lets a busy guest skip a debt it has already been paid on top of
// its bound. `r4_nothing_is_owed_beyond_…` states the behaviour with numbers derived from the
// task's Boundary; `r4_pacer_agrees_with_an_anchor_free_model_…` holds the whole pacer against
// the same rules written a second time, without its bookkeeping. (Since round 5 the worker's
// `paced_idle_owed_time_is_capped_by_the_host_lead_after_the_jump` kills that mutant too.)
//
// Nothing differs from the source below this header (the promoting verifier, round 5, wrote
// the header only).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/// Ticks per millisecond at the virt timebase (10 MHz), and nanoseconds per millisecond.
const R4_T: u64 = 10_000;
const R4_N: u64 = 1_000_000;
const R4_FAR: u64 = u64::MAX - 1;

/// "Waiting time … the part of it an idle jump cannot hand over at once … stays owed and
/// survives later work" — but only as long as the host clock is still ahead of the guest by
/// that much. A guest whose own retire-derived clock catches up with the host clock has had
/// the time it waited; a later busy stretch then gets one bound, not the old debt on top
/// ("at most `max_busy_lag` of the time it fell behind may be skipped").
///
/// The host oversleeps 2 s past a deadline 1 ms away: 2 s owed. The handler then retires 1.5 s
/// of guest time in 0.5 s of host time, so the host clock is 1 s ahead of the guest, and
///
/// * with nothing in the way the idle jump takes that whole second: the guest is AT the host
///   clock and is owed nothing; the next busy stretch skips exactly one bound;
/// * with a deadline 400 ms ahead the jump takes 400 ms: the host clock is 600 ms ahead, and
///   600 ms is what is still owed; the next busy stretch skips those 600 ms and one bound.
///
/// (With the cap judged before the jump both cases leave 1 s owed, where 0 and 600 ms are
/// right, and the busy guest skips 1 s + 50 ms.)
#[test]
fn r4_nothing_is_owed_beyond_what_the_host_clock_is_ahead_after_the_jump() {
    for (deadline_ms, jump_ms, owed_ms) in [(None, 1_000, 0), (Some(400), 400, 600)] {
        let mut p = time::IdlePacer::new(0, 0, u64::from(platform::virt::TIMEBASE_FREQ_HZ));
        p.set_max_busy_lag_ticks(50 * R4_T);
        let mut now = p.limit_deadline_after(2_001 * R4_N, 0, R4_T, false);
        assert_eq!((now, p.owed_wait_ticks()), (R4_T, 2_000 * R4_T));
        // The handler: 1.5 s of retirement while the host clock moves 0.5 s.
        now += 1_500 * R4_T;
        let deadline = deadline_ms.map_or(R4_FAR, |ms| now + ms * R4_T);
        let got = p.limit_deadline_after(2_501 * R4_N, now, deadline, true);
        assert_eq!(
            got,
            now + jump_ms * R4_T,
            "deadline {deadline_ms:?}: up to the host clock or the deadline"
        );
        assert_eq!(
            p.owed_wait_ticks(),
            owed_ms * R4_T,
            "deadline {deadline_ms:?}: what the host clock is still ahead by, no more"
        );
        assert_eq!(p.waiting(), deadline_ms.is_none());
        // A busy stretch with the host clock racing and nothing in the way.
        now = got + 10 * R4_T;
        assert_eq!(
            p.limit_deadline_after(100_000 * R4_N, now, R4_FAR, true),
            now + owed_ms * R4_T + 50 * R4_T,
            "deadline {deadline_ms:?}: what is owed and one bound"
        );
        assert_eq!(p.owed_wait_ticks(), 0);
    }
}

/// The rules of the task's Boundary ("Bounded busy lag") and of `limit_deadline_after`'s doc,
/// written a second time RELATIVE TO THE GUEST — no anchor, no ceiling:
///
/// * `lead`: how far the host clock, as far as the guest may still follow it, is ahead of guest
///   time (negative while the guest's retire-derived clock is ahead of the host's);
/// * `owed`: the part of the lead that is waiting time.
///
/// A consultation: host time that passed adds to the lead, retirement takes from it. A guest
/// that worked keeps at most what it is owed plus the bound (the rest is forgotten); a guest
/// that waited is owed all the host time that passed. The idle jump goes to the deadline or as
/// far as the lead reaches; it hands over waiting time first, and nothing stays owed beyond the
/// lead that is left.
struct R4Model {
    host: u64,
    guest: u64,
    lead: i128,
    owed: u64,
    bound: u64,
    /// What the last consultation did: cut the lead of a guest that worked; jumped this far;
    /// dropped owed time the lead no longer covers.
    cut: bool,
    jump: u64,
    capped: bool,
}
impl R4Model {
    fn new(host: u64, guest: u64, bound: u64) -> Self {
        Self {
            host,
            guest,
            lead: 0,
            owed: 0,
            bound,
            cut: false,
            jump: 0,
            capped: false,
        }
    }
    /// Returns guest time after the jump. `host`, like everything here, is in ticks.
    fn consult(&mut self, host: u64, current: u64, deadline: u64, worked: bool) -> u64 {
        let passed = host.saturating_sub(self.host); // a backward reading is no time at all
        self.host = self.host.max(host);
        self.lead += i128::from(passed) - i128::from(current - self.guest);
        self.cut = false;
        if worked {
            let keep = i128::from(self.owed) + i128::from(self.bound);
            self.cut = self.lead > keep;
            self.lead = self.lead.min(keep);
        } else {
            self.owed += passed;
        }
        self.jump = deadline
            .saturating_sub(current)
            .min(self.lead.max(0) as u64);
        self.lead -= i128::from(self.jump);
        let left = self.owed - self.owed.min(self.jump);
        let covered = self.lead.max(0) as u64;
        self.capped = left > covered;
        self.owed = left.min(covered);
        self.guest = current + self.jump;
        self.guest
    }
    /// Host ticks until the guest may reach `deadline`.
    fn ticks_until(&self, deadline: u64) -> u64 {
        (i128::from(deadline) - i128::from(self.guest) - self.lead).max(0) as u64
    }
}

/// The pacer against `R4Model` on random closed loops: after every consultation the guest time
/// returned, the waiting time owed, the `waiting` flag and `ticks_until` are equal. Guests that
/// work and guests that only wait, a retire-derived clock much slower and much faster than the
/// host's, host readings that stand still, crawl, leap and run backwards, deadlines 1 tick to
/// 4 s ahead, far, and already past, six bounds, rebases. Host readings are whole ticks, so the
/// nanosecond conversion is exact and the comparison is too.
#[test]
fn r4_pacer_agrees_with_an_anchor_free_model_of_the_boundary_rules() {
    const HZ: u64 = 10_000_000;
    const NS_PER_TICK: u64 = 100;
    // What the walk reached, so that it cannot go vacuous: [0] a guest that worked had its lead
    // cut to owed + bound; [1] owed time was dropped because the lead no longer covered it;
    // [2] the same at a jump of more than nothing; [3] the guest ended ahead of the host clock;
    // [4] time stayed owed across a consultation after work; [5] a deadline ahead was reached;
    // [6] a host reading behind the clock (the pacer keeps its latest); [7] a rebase.
    let mut reached = [0u64; 8];
    let mut steps = 0u64;
    for seed in 1..=400u64 {
        let mut s = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        let mut next = move || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            s
        };
        let bound = [0, 1, 500, 50_000, 500_000, 20_000_000][(seed % 6) as usize];
        // Three kinds of guest: retirement far slower than the host clock (the desktop under
        // load), about as fast, and far faster (a small clock divider).
        let pace = seed / 6 % 3;
        let (mut host, mut current) = (next() % (1 << 40), next() % (1 << 40));
        let mut p = time::IdlePacer::new(host * NS_PER_TICK, current, HZ);
        p.set_max_busy_lag_ticks(bound);
        let mut model = R4Model::new(host, current, bound);
        for _ in 0..500 {
            if next().is_multiple_of(151) {
                host += next() % 50_000_000;
                current += next() % 1_000;
                p.rebase(host * NS_PER_TICK, current);
                model = R4Model::new(host, current, bound);
                assert!(!p.waiting() && p.owed_wait_ticks() == 0, "seed {seed}");
                assert_eq!(p.max_busy_lag_ticks(), bound, "seed {seed}");
                reached[7] += 1;
            }
            let worked = next().is_multiple_of(3);
            let passed = match next() % 8 {
                0 => 0,
                1 => next() % 30_000_000, // up to 3 s
                2 => next() % 2_000,
                _ => next() % 300_000, // up to 30 ms
            };
            host += passed;
            let reading = if next().is_multiple_of(37) {
                reached[6] += 1;
                host.saturating_sub(1 + next() % 1_000_000)
            } else {
                host
            };
            current += match (worked, pace) {
                (false, _) => next() % 200,
                (true, 0) => passed / 5 + next() % 300,
                (true, 1) => passed / 2 + next() % (passed + 1),
                (true, _) => passed * 3 + next() % 5_000_000,
            };
            let deadline = match next() % 8 {
                0 => current + 1 + next() % 500,
                1 | 2 => current + 1 + next() % 50_000,
                3 | 4 => current + 1 + next() % 40_000_000,
                5 => current.saturating_sub(next() % 1_000),
                _ => R4_FAR,
            };
            let want = model.consult(reading, current, deadline, worked);
            let got = p.limit_deadline_after(reading * NS_PER_TICK, current, deadline, worked);
            let at = (seed, steps, bound, worked, current, deadline);
            assert_eq!(got, want, "{at:?}: guest time after the jump");
            assert_eq!(p.owed_wait_ticks(), model.owed, "{at:?}: waiting time owed");
            assert_eq!(p.waiting(), got < deadline, "{at:?}: the waiting flag");
            assert_eq!(
                p.ticks_until(deadline),
                model.ticks_until(deadline),
                "{at:?}"
            );
            for (n, hit) in [
                model.cut,
                model.capped,
                model.capped && model.jump > 0,
                model.lead < 0,
                worked && model.owed > 0,
                model.jump > 0 && got == deadline,
            ]
            .into_iter()
            .enumerate()
            {
                reached[n] += u64::from(hit);
            }
            current = got;
            steps += 1;
        }
    }
    std::eprintln!("R4 model: {steps} consultations; reached {reached:?}");
    assert!(reached.iter().all(|&n| n >= 200), "{reached:?}");
}
