//! E1-T14: the Zicntr counters — mcycle/minstret (+ cycle/instret shadows), time (a window onto
//! CLINT mtime), and the mcounteren/scounteren access gating. Real CSR file, default build only.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{
    CYCLE, CsrOp, Csrs, INSTRET, MCOUNTEREN, MCYCLE, MINSTRET, Priv, SCOUNTEREN, TIME,
};

const CODE: u64 = DRAM_BASE;

/// `csrr rd, csr` = `csrrs rd, csr, x0`.
fn csrr(rd: u32, csr: u32) -> u32 {
    (csr << 20) | (0b010 << 12) | (rd << 7) | 0x73
}

/// Write a CSR, temporarily elevating to M so setup bypasses the counter/privilege gating.
fn set_csr(m: &mut Machine, addr: u16, op: CsrOp, v: u64) {
    let save = m.hart().csr.mode;
    m.hart_mut().csr.mode = Priv::M;
    m.hart_mut()
        .csr
        .access(addr, op, v, false, false, 0)
        .unwrap();
    m.hart_mut().csr.mode = save;
}
fn rd(m: &mut Machine, addr: u16) -> u64 {
    m.hart_mut().csr.read(addr)
}

// ── counting ─────────────────────────────────────────────────────────────────────

#[test]
fn minstret_increments_exactly_once_per_retired_instruction() {
    // K retired instructions increment minstret by exactly K (direct reads don't perturb it).
    let mut m = Machine::new(1024 * 1024);
    m.bus_mut().store32(CODE, 0x0000_006F).unwrap(); // jal x0,0 (self-loop, retires forever)
    m.hart_mut().regs.pc = CODE;
    let before = rd(&mut m, MINSTRET);
    m.run(100);
    assert_eq!(
        rd(&mut m, MINSTRET) - before,
        100,
        "minstret += retired count"
    );
    // mcycle tracks minstret 1:1 in this one-instruction-per-step interpreter.
    let c_before = rd(&mut m, MCYCLE);
    m.run(50);
    assert_eq!(rd(&mut m, MCYCLE) - c_before, 50, "mcycle += retired count");
}

#[test]
fn rdinstret_back_to_back_differs_by_one() {
    // Two `rdinstret` in a row: the second observes the count AFTER the first retired → delta 1
    // (the classic increment-position check Spike is authoritative on).
    let mut m = Machine::new(1024 * 1024);
    m.bus_mut().store32(CODE, csrr(1, INSTRET as u32)).unwrap(); // rdinstret x1
    m.bus_mut()
        .store32(CODE + 4, csrr(2, INSTRET as u32))
        .unwrap(); // rdinstret x2
    m.hart_mut().regs.pc = CODE;
    m.run(2);
    let (x1, x2) = (m.hart().regs.read(1), m.hart().regs.read(2));
    assert_eq!(x2 - x1, 1, "second rdinstret sees the first's retirement");
}

#[test]
fn guest_csrw_counter_does_not_count_its_own_retirement() {
    // Spike: a `csrw minstret, X` writes X and does NOT also count that instruction's own
    // retirement — the written value stands (the classic increment-position divergence). A
    // subsequent `csrr` observes X, and the NEXT instruction increments to X+1.
    // `csrrwi minstret, 0` via a scratch would be awkward; use `csrrw minstret, x5` with x5=100.
    let mut m = Machine::new(1024 * 1024);
    m.hart_mut().regs.write(5, 100);
    // csrrw x0, minstret, x5  (write minstret = x5 = 100, discard old)
    let csrw = (u32::from(MINSTRET) << 20) | (5 << 15) | (0b001 << 12) | 0x73;
    m.bus_mut().store32(CODE, csrw).unwrap();
    m.bus_mut()
        .store32(CODE + 4, csrr(6, MINSTRET as u32))
        .unwrap(); // csrr x6, minstret
    m.hart_mut().regs.pc = CODE;
    m.run(2);
    assert_eq!(
        m.hart().regs.read(6),
        100,
        "csrw minstret,100 stands at 100 (no self-count); the csrr reads it pre-retire (matches Spike)"
    );
    // The written value itself stood at 100 immediately after the csrw (not 101).
    let mut m2 = Machine::new(1024 * 1024);
    m2.hart_mut().regs.write(5, 500);
    let csrw_c = (u32::from(MCYCLE) << 20) | (5 << 15) | (0b001 << 12) | 0x73;
    m2.bus_mut().store32(CODE, csrw_c).unwrap();
    m2.hart_mut().regs.pc = CODE;
    m2.run(1); // just the csrw
    assert_eq!(
        rd(&mut m2, MCYCLE),
        500,
        "csrw mcycle,500 stands at 500, not 501"
    );
}

#[test]
fn writing_minstret_takes_effect_and_instret_shadows_it() {
    let mut m = Machine::new(64 * 1024);
    set_csr(&mut m, MINSTRET, CsrOp::Write, 0x1234_5678);
    assert_eq!(rd(&mut m, MINSTRET), 0x1234_5678, "minstret writable");
    assert_eq!(rd(&mut m, INSTRET), 0x1234_5678, "instret shadows minstret");
    set_csr(&mut m, MCYCLE, CsrOp::Write, 0xDEAD);
    assert_eq!(rd(&mut m, CYCLE), 0xDEAD, "cycle shadows mcycle");
}

#[test]
fn minstret_wraps_around_unsigned() {
    let mut m = Machine::new(64 * 1024);
    set_csr(&mut m, MINSTRET, CsrOp::Write, u64::MAX - 1);
    m.bus_mut().store32(CODE, 0x0000_006F).unwrap(); // jal x0,0
    m.hart_mut().regs.pc = CODE;
    m.run(1);
    assert_eq!(rd(&mut m, MINSTRET), u64::MAX, "MAX-1 + 1");
    m.run(1);
    assert_eq!(rd(&mut m, MINSTRET), 0, "wrapped to 0");
    assert_eq!(rd(&mut m, INSTRET), 0, "instret shadow wrapped too");
}

// ── counteren WARL ───────────────────────────────────────────────────────────────

#[test]
fn counteren_warl_exposes_only_cy_tm_ir() {
    let mut c = Csrs::at_reset();
    c.access(MCOUNTEREN, CsrOp::Write, u64::MAX, false, false, 0)
        .unwrap();
    assert_eq!(
        c.access(MCOUNTEREN, CsrOp::Set, 0, true, false, 0).unwrap(),
        0b111,
        "mcounteren reads back only CY/TM/IR"
    );
    c.access(SCOUNTEREN, CsrOp::Write, u64::MAX, false, false, 0)
        .unwrap();
    assert_eq!(
        c.access(SCOUNTEREN, CsrOp::Set, 0, true, false, 0).unwrap(),
        0b111,
        "scounteren reads back only CY/TM/IR"
    );
}

// ── the access-gating matrix ({S,U} × {CY,TM,IR} × counteren) ─────────────────────

/// Read `addr` from `mode` with the given counteren bits, returning Ok(())/Err for trap.
fn gated_read(mode: Priv, addr: u16, mcen: u64, scen: u64) -> Result<(), ()> {
    let mut c = Csrs::at_reset(); // M-mode
    c.access(MCOUNTEREN, CsrOp::Write, mcen, false, false, 0)
        .unwrap();
    c.access(SCOUNTEREN, CsrOp::Write, scen, false, false, 0)
        .unwrap();
    c.mode = mode;
    c.access(addr, CsrOp::Set, 0, true, false, 0)
        .map(|_| ())
        .map_err(|_| ())
}

#[test]
fn counter_gating_matrix_matches_spec() {
    for (addr, bit) in [(CYCLE, 1u64), (TIME, 2), (INSTRET, 4)] {
        // M-mode: never gated.
        assert!(gated_read(Priv::M, addr, 0, 0).is_ok(), "M never gated");
        // S-mode: needs the mcounteren bit only.
        assert!(gated_read(Priv::S, addr, 0, 0).is_err(), "S, mcen=0 → trap");
        assert!(
            gated_read(Priv::S, addr, bit, 0).is_ok(),
            "S, mcen set → ok"
        );
        // U-mode: needs BOTH mcounteren and scounteren bits.
        assert!(
            gated_read(Priv::U, addr, bit, 0).is_err(),
            "U, scen=0 → trap"
        );
        assert!(
            gated_read(Priv::U, addr, 0, bit).is_err(),
            "U, mcen=0 → trap"
        );
        assert!(
            gated_read(Priv::U, addr, bit, bit).is_ok(),
            "U, both set → ok"
        );
    }
}

#[test]
fn rdtime_from_s_traps_when_tm_clear_and_returns_mtime_when_set() {
    // S-mode rdtime with mcounteren.TM=0 → illegal (mcause 2, mtval = the rdtime encoding).
    let mut m = Machine::new(64 * 1024);
    let clint = m.enable_clint(1_000_000);
    clint.borrow_mut().mtime = 12345;
    let word = csrr(5, TIME as u32); // rdtime x5
    m.bus_mut().store32(CODE, word).unwrap();
    m.hart_mut().csr.pmp.allow_all(); // E1-T15: grant S-mode fetch/access to RAM
    m.hart_mut().csr.mode = Priv::S;
    // mcounteren.TM = 0 (reset). Pure step surfaces the raw trap.
    m.hart_mut().regs.pc = CODE;
    match m.step() {
        Err(t) => {
            assert_eq!(t.cause as u64, 2, "illegal instruction");
            assert_eq!(t.tval, u64::from(word), "mtval = the rdtime encoding");
        }
        Ok(()) => panic!("rdtime with TM=0 must trap in S"),
    }
    // Now set mcounteren.TM and it returns mtime.
    set_csr(&mut m, MCOUNTEREN, CsrOp::Set, 1 << 1); // TM
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = CODE;
    m.run(1);
    assert_eq!(m.hart().regs.read(5), 12345, "rdtime returns CLINT mtime");
}

#[test]
fn hpmcounter_always_traps_from_below_m() {
    // hpmcounter3 (0xC03): its counteren bit is read-only 0 (mask 0b111), so it can never be
    // enabled from S/U — the read always traps regardless of counteren writes.
    let mut c = Csrs::at_reset();
    c.access(MCOUNTEREN, CsrOp::Write, u64::MAX, false, false, 0)
        .unwrap(); // try to enable all
    c.access(SCOUNTEREN, CsrOp::Write, u64::MAX, false, false, 0)
        .unwrap();
    c.mode = Priv::S;
    assert!(
        c.access(0xC03, CsrOp::Set, 0, true, false, 0).is_err(),
        "hpmcounter3 traps from S despite counteren all-ones (bit 3 is RO 0)"
    );
    // M-mode reads it fine (returns 0, unimplemented HPM).
    c.mode = Priv::M;
    assert_eq!(c.access(0xC03, CsrOp::Set, 0, true, false, 0).unwrap(), 0);
}

// ── time tracks mtime ─────────────────────────────────────────────────────────────

#[test]
fn time_tracks_clint_mtime_as_a_live_window() {
    // `time` is a window onto CLINT mtime refreshed each instruction boundary — NOT a cached copy
    // set once. A slow clock (no auto-advance over a few steps) isolates the tracking: whatever
    // the CLINT mtime is at the boundary is exactly what a guest `rdtime` sees this instruction.
    let mut m = Machine::new(64 * 1024);
    let clint = m.enable_clint(1_000_000); // no mtime tick over the handful of steps below
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap(); // nop
    m.hart_mut().regs.pc = CODE;

    clint.borrow_mut().mtime = 500;
    m.run(1); // the boundary sync refreshes the shadow to 500
    assert_eq!(rd(&mut m, TIME), 500, "time == mtime at the boundary");
    assert_eq!(clint.borrow().mtime, 500, "slow clock: mtime unchanged");

    // A later direct CLINT write is picked up on the next boundary (no stale cached value).
    clint.borrow_mut().mtime = 999_000;
    m.run(1);
    assert_eq!(
        rd(&mut m, TIME),
        999_000,
        "time follows a direct mtime write"
    );

    // With a fast clock, the guest's rdtime equals the guest's own MMIO mtime read (both sampled
    // at the same boundary) — proven here by the shadow matching mtime BEFORE that step's tick.
    let mut m2 = Machine::new(64 * 1024);
    let c2 = m2.enable_clint(1);
    m2.bus_mut().store32(CODE, 0x0000_0013).unwrap();
    m2.hart_mut().regs.pc = CODE;
    let mtime_before = c2.borrow().mtime; // 0
    m2.run(1); // sync sets time = mtime_before, THEN advance ticks mtime
    assert_eq!(
        rd(&mut m2, TIME),
        mtime_before,
        "time = mtime as of this instruction's boundary"
    );
    assert_eq!(
        c2.borrow().mtime,
        mtime_before + 1,
        "the tick lands after the boundary sample"
    );
}
