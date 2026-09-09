// Temporary critic-only test appended to crates/core/tests/icount_divider.rs.
// It was removed after the passing run; this durable copy is not compiled.
#[test]
fn critic_full_domain_phase_oracle() {
    let mut seed = 0xd1b5_4a32_d192_ed03_u64;
    let mut next = || {
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        seed
    };

    for case in 0..256 {
        let old = next() | 1;
        let phase = next() % old;
        let new = next() % 1024 + 1;
        let stimecmp = next();
        let (mut m, clint) = machine(old);
        let initial = m.save_resume().unwrap();
        m.load_resume(&with_clock(&initial, [phase, old, stimecmp]))
            .unwrap();
        let before = m.save_resume().unwrap();
        let mapped = (u128::from(phase) * u128::from(new) / u128::from(old)) as u64;

        m.set_icount_divider(new).unwrap();
        assert_eq!(
            m.save_resume().unwrap(),
            with_clock(&before, [mapped, new, stimecmp]),
            "case={case}, old={old}, phase={phase}, new={new}"
        );
        run(&mut m, new - mapped - 1);
        assert_eq!(clint.borrow().mtime, 0, "case={case}");
        run(&mut m, 1);
        assert_eq!(clint.borrow().mtime, 1, "case={case}");
    }
}
