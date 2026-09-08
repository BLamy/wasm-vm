// Isolated verifier-only attack appended to crates/core/tests/guest_clock.rs at exact
// 99b8e692fddb7b1e82e4175e152ef5682c6b9373. Not a shared-source modification.
#[test]
fn verifier_repeated_rebase_preserves_nonzero_time_deadline_and_mode_handoff() {
    let mut m = machine();
    let initial = 9_007_199_254_740_993u64;
    let deadline = initial + 40_000;
    m.bus_mut()
        .store64(virt::CLINT_BASE + 0xbff8, initial)
        .unwrap();
    m.bus_mut()
        .store64(virt::CLINT_BASE + 0x4000, deadline)
        .unwrap();
    let clock = arm(&mut m, 20_000_000_000);

    for _ in 0..4 {
        m.rebase_guest_clock();
        assert_eq!(m.clint_mtime(), initial);
    }
    clock.ns.set(19_000_000_000);
    assert_eq!(rdtime(&mut m), initial);
    assert_eq!(
        m.bus_mut().load64(virt::CLINT_BASE + 0x4000).unwrap(),
        deadline
    );
    assert!(m.take_time_jump().is_none());

    clock.ns.set(20_001_000_000);
    assert_eq!(rdtime(&mut m), initial + 10_000);
    m.rebase_guest_clock();
    m.rebase_guest_clock();
    assert_eq!(m.clint_mtime(), initial + 10_000);
    clock.ns.set(20_002_000_000);
    assert_eq!(rdtime(&mut m), initial + 20_000);
    assert_eq!(
        m.bus_mut().load64(virt::CLINT_BASE + 0x4000).unwrap(),
        deadline
    );
    assert!(m.take_time_jump().is_none());

    m.set_icount_clock();
    let before = m.clint_mtime();
    clock.ns.set(u64::MAX);
    m.rebase_guest_clock();
    assert_eq!(m.run(9), RunOutcome::MaxInstrs);
    assert_eq!(m.clint_mtime(), before);
    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
    assert_eq!(m.clint_mtime(), before + 1);
    assert_eq!(m.guest_clock_mode(), TimeMode::ICount);
    assert!(m.take_time_jump().is_none());
}
