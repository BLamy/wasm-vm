//! Deterministic work counts at the real cache synchronization boundary. This
//! instrumentation is absent in release builds and never controls any decision.
use super::*;
use csr::Priv;

fn populated(count: usize, mode: Priv) -> Machine {
    populated_with(count, mode, |_| {})
}

fn populated_with(count: usize, mode: Priv, configure: impl FnOnce(&mut pmp::Pmp)) -> Machine {
    let mut m = Machine::new(0);
    m.hart.csr.pmp.allow_all();
    configure(&mut m.hart.csr.pmp);
    m.hart.csr.mode = mode;
    m.set_block_cache_capacity(count * 4);
    m.set_block_cache(true);
    for i in 0..count {
        m.block_cache.insert(dispatch::DecodedBlock::new(
            0x8000_0000 + (i as u64) * 512,
            alloc::vec![dispatch::MicroOp {
                instr: decode::Instr::Addi { rd: 1, rs1: 1, imm: 1 },
                len: 4,
                raw: 0x00108093,
            }; 128],
            512,
        ));
    }
    assert_eq!(m.block_cache.live_blocks().count(), count);
    m
}

#[test]
fn su_pmp_audit_work_is_zero_for_populated_caches() {
    for count in [1, 16, 128, 2048] {
        let mut m = populated(count, Priv::S);
        let generation = m.discovery_stats().generation;
        for turn in 0..1000 {
            m.hart.csr.mode = if turn % 2 == 0 { Priv::U } else { Priv::S };
            m.sync_pmp_code_permissions();
            assert_eq!(m.pmp_mode_seen, m.hart.csr.mode);
            assert_eq!(
                m.pmp_audited_ops, 0,
                "S/U inspected cached instructions; count={count}, turn={turn}"
            );
        }
        assert_eq!(m.block_cache.live_blocks().count(), count);
        assert_eq!(m.discovery_stats().generation, generation);
    }
}

#[test]
fn m_pmp_audit_still_visits_cached_instructions() {
    for (from, to) in [
        (Priv::M, Priv::S),
        (Priv::U, Priv::M),
        (Priv::M, Priv::U),
        (Priv::S, Priv::M),
    ] {
        let mut m = populated(16, from);
        m.hart.csr.mode = to;
        m.sync_pmp_code_permissions();
        assert_eq!(
            m.pmp_audited_ops,
            16 * 128,
            "M boundary lost audit: {from:?}->{to:?}"
        );
        assert_eq!(m.block_cache.live_blocks().count(), 16);
        assert_eq!(m.pmp_mode_seen, to);
    }
}

#[test]
fn su_pmp_revision_change_flushes_before_shortcut() {
    for (from, to) in [(Priv::S, Priv::U), (Priv::U, Priv::S)] {
        let mut m = populated(16, from);
        m.hart.csr.pmp.write_cfg(0, 0x1b); // same all-address NAPOT, no X
        m.hart.csr.mode = to;
        m.sync_pmp_code_permissions();
        assert_eq!(m.block_cache.live_blocks().count(), 0);
        assert_eq!(m.pmp_revision_seen, m.hart.csr.pmp.revision());
        assert_eq!(m.pmp_mode_seen, to);
    }
}

#[test]
fn su_pmp_ignored_locked_tor_writes_keep_revision_and_zero_work() {
    let mut m = populated_with(16, Priv::S, |pmp| {
        pmp.write_addr(0, 0x8000_0000 >> 2);
        pmp.write_addr(1, 0x8000_2000 >> 2);
        pmp.write_cfg(0, 0x8f00); // OFF entry0, locked RWX TOR entry1
    });
    let before = m.hart.csr.pmp.clone();
    let revision = m.hart.csr.pmp.revision();
    m.hart.csr.pmp.write_cfg(0, 0);
    m.hart.csr.pmp.write_addr(0, 0); // lower bound protected by locked TOR neighbor
    m.hart.csr.pmp.write_addr(1, 0); // locked entry's own address
    assert_eq!(m.hart.csr.pmp, before);
    assert_eq!(m.hart.csr.pmp.revision(), revision);
    m.hart.csr.mode = Priv::U;
    m.sync_pmp_code_permissions();
    assert_eq!(m.pmp_audited_ops, 0);
    assert_eq!(m.block_cache.live_blocks().count(), 16);
}

#[test]
fn su_pmp_effective_address_change_cannot_take_shortcut() {
    let mut m = populated(16, Priv::S);
    let revision = m.hart.csr.pmp.revision();
    m.hart.csr.pmp.write_addr(0, 0x8000_0000 >> 2);
    assert_ne!(m.hart.csr.pmp.revision(), revision);
    m.hart.csr.mode = Priv::U;
    m.sync_pmp_code_permissions();
    assert_eq!(m.block_cache.live_blocks().count(), 0);
}
