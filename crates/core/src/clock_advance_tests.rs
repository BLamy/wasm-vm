//! Accounting boundaries too large to execute as a real guest instruction budget.
use super::*;

#[test]
fn single_retirements_match_wide_oracle_across_ticks_and_invalid_phases() {
    let mut m = Machine::new(4096);
    let clint = m.enable_clint(64);
    for divisor in [0, 1, 2, 3, 10, 64, 1024, 1 << 63, u64::MAX] {
        for initial_phase in [0, 1, divisor.saturating_sub(1), u64::MAX] {
            for initial_time in [0u64, u64::MAX - 1, u64::MAX] {
                m.clock_div = divisor;
                m.tick_accum = initial_phase;
                clint.borrow_mut().mtime = initial_time;
                let mut expected_phase = initial_phase;
                let mut expected_time = initial_time;
                for _ in 0..129 {
                    let total = u128::from(expected_phase) + 1;
                    let denominator = u128::from(divisor.max(1));
                    expected_phase = (total % denominator) as u64;
                    expected_time = expected_time.wrapping_add((total / denominator) as u64);
                    m.advance_clock();
                    assert_eq!(m.tick_accum, expected_phase);
                    assert_eq!(clint.borrow().mtime, expected_time);
                }
            }
        }
    }
}

#[test]
fn clock_spans_match_wide_oracle_including_overflow_and_mtime_wrap() {
    for divisor in [0, 1, 2, 3, 10, 64, 1024, 1 << 63, u64::MAX] {
        let mut m = Machine::new(4096);
        let clint = m.enable_clint(divisor);
        m.clock_div = divisor; // Also preserve the historical zero-divisor clamp.
        let denominator = u128::from(divisor.max(1));
        for phase in [0, 1, divisor.saturating_sub(1), u64::MAX] {
            for retired in [0, 1, 2, 63, 64, 129, u64::MAX - 1, u64::MAX] {
                for start in [0u64, u64::MAX - 1, u64::MAX] {
                    m.tick_accum = phase;
                    clint.borrow_mut().mtime = start;
                    clint.borrow_mut().mtimecmp = 17;
                    clint.borrow_mut().msip = true;
                    let total = u128::from(phase) + u128::from(retired);
                    m.advance_clock_by(retired);
                    assert_eq!(m.tick_accum, (total % denominator) as u64);
                    assert_eq!(
                        clint.borrow().mtime,
                        start.wrapping_add((total / denominator) as u64),
                        "divider={divisor} phase={phase} span={retired} start={start}"
                    );
                    assert_eq!(clint.borrow().mtimecmp, 17);
                    assert!(clint.borrow().msip);
                }
            }
        }
    }
}

#[test]
fn clock_spans_match_wide_oracle_across_varied_schedules() {
    let mut m = Machine::new(4096);
    let clint = m.enable_clint(64);
    for mut seed in [1u64, 0x5eed, 0xcafef00d, u64::MAX] {
        for _ in 0..10_000 {
            let mut next = || {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                seed
            };
            let divisor = next().max(1);
            let phase = next() % divisor;
            let retired = next();
            let start = next();
            m.clock_div = divisor;
            m.tick_accum = phase;
            clint.borrow_mut().mtime = start;
            let total = u128::from(phase) + u128::from(retired);
            m.advance_clock_by(retired);
            assert_eq!(m.tick_accum, (total % u128::from(divisor)) as u64);
            assert_eq!(
                clint.borrow().mtime,
                start.wrapping_add((total / u128::from(divisor)) as u64)
            );
        }
    }
}

#[test]
fn clock_accounting_is_inert_without_clint_or_in_wall_mode() {
    let mut missing = Machine::new(4096);
    missing.tick_accum = 7;
    missing.advance_clock_by(u64::MAX);
    assert_eq!(missing.tick_accum, 7);

    struct FixedClock;
    impl time::MonotonicClock for FixedClock {
        fn now_nanos(&self) -> u64 {
            0
        }
    }
    let mut wall = Machine::new(4096);
    let clint = wall.enable_clint(64);
    wall.tick_accum = 63;
    clint.borrow_mut().mtime = 17;
    wall.set_wall_clock(
        alloc::boxed::Box::new(FixedClock),
        time::WallClockPolicy::DEFAULT,
    );
    wall.advance_clock_by(u64::MAX);
    assert_eq!(wall.tick_accum, 63);
    assert_eq!(clint.borrow().mtime, 17);
}

#[test]
fn clock_extremes_match_verifier_fixed_predictions() {
    let mut m = Machine::new(4096);
    let clint = m.enable_clint(64);
    m.tick_accum = u64::MAX;
    clint.borrow_mut().mtime = u64::MAX - 1;
    m.advance_clock_by(u64::MAX);
    assert_eq!(m.tick_accum, 62);
    assert_eq!(clint.borrow().mtime, 576_460_752_303_423_485);

    m.clock_div = u64::MAX;
    m.tick_accum = u64::MAX;
    clint.borrow_mut().mtime = u64::MAX;
    m.advance_clock();
    assert_eq!(m.tick_accum, 1);
    assert_eq!(clint.borrow().mtime, 0);

    m.clock_div = 0;
    m.tick_accum = u64::MAX;
    clint.borrow_mut().mtime = u64::MAX;
    m.advance_clock_by(u64::MAX);
    assert_eq!(m.tick_accum, 0);
    assert_eq!(clint.borrow().mtime, u64::MAX - 2);
}
