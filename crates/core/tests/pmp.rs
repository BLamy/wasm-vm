//! E1-T15: Physical Memory Protection — OFF/TOR/NA4/NAPOT matching, R/W/X permissions, the L
//! lock bit (incl. the TOR-neighbor quirk), the "no-match ⇒ S/U fail" default, and MPRV. Real
//! CSR file + run loop, default build only.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, Csrs, MSTATUS, MTVEC, PMPADDR0, PMPCFG0, Priv};
use wasm_vm_core::pmp::{Pmp, PmpAccess};

const CODE: u64 = DRAM_BASE;

// pmpcfg byte bits.
const R: u8 = 1;
const W: u8 = 2;
const X: u8 = 4;
const A_TOR: u8 = 1 << 3;
const A_NA4: u8 = 2 << 3;
const A_NAPOT: u8 = 3 << 3;
const L: u8 = 1 << 7;

/// Build a fresh PMP unit programmed through the CSR interface (entry i cfg + addr).
fn pmp_with(entries: &[(u8, u64)]) -> Pmp {
    let mut c = Csrs::at_reset();
    // Pack cfg bytes into pmpcfg0 (entries 0..8) and set pmpaddrN.
    let mut cfg0 = 0u64;
    for (i, (cfg, addr)) in entries.iter().enumerate() {
        cfg0 |= u64::from(*cfg) << (i * 8);
        c.access(PMPADDR0 + i as u16, CsrOp::Write, *addr, false, false, 0)
            .unwrap();
    }
    c.access(PMPCFG0, CsrOp::Write, cfg0, false, false, 0)
        .unwrap();
    c.pmp.clone()
}

/// NAPOT-encode a [base, base+size) region (size a power of two ≥ 8) into a pmpaddr value.
fn napot(base: u64, size: u64) -> u64 {
    ((base >> 2) & !((size >> 3) - 1)) | ((size >> 3) - 1)
}

// ── matching + permissions (unit level) ──────────────────────────────────────────

#[test]
fn napot_grants_rwx_and_off_default_denies_su() {
    // One NAPOT entry granting RWX over a 4 KiB page to everyone.
    let base = 0x8000_0000;
    let p = pmp_with(&[(R | W | X | A_NAPOT, napot(base, 0x1000))]);
    for m in [Priv::M, Priv::S, Priv::U] {
        assert!(p.check(base, 4, PmpAccess::Read, m), "{m:?} read granted");
        assert!(
            p.check(base + 0xFFC, 4, PmpAccess::Exec, m),
            "{m:?} exec last word"
        );
    }
    // Outside the region: no match → M ok, S/U fail.
    let out = base + 0x1000;
    assert!(
        p.check(out, 4, PmpAccess::Read, Priv::M),
        "M passes unmatched"
    );
    assert!(
        !p.check(out, 4, PmpAccess::Read, Priv::S),
        "S fails unmatched"
    );
    assert!(
        !p.check(out, 4, PmpAccess::Read, Priv::U),
        "U fails unmatched"
    );
}

#[test]
fn no_armed_entry_denies_su_but_allows_m() {
    let p = Pmp::default(); // all OFF
    assert!(
        p.check(DRAM_BASE, 8, PmpAccess::Read, Priv::M),
        "M ok with no entries armed"
    );
    assert!(
        !p.check(DRAM_BASE, 8, PmpAccess::Read, Priv::S),
        "S denied (≥1 entry implemented)"
    );
    assert!(!p.check(DRAM_BASE, 8, PmpAccess::Read, Priv::U), "U denied");
}

#[test]
fn tor_readonly_for_s_with_straddle_and_store_faults() {
    // TOR entry [0x8000_0000, 0x8000_1000) R-only for S (entry 0 uses base 0 for its lower bound;
    // add a lower TOR bound via pmpaddr0, region via pmpaddr1).
    let lo = 0x8000_0000u64;
    let hi = 0x8000_1000u64;
    // entry0: TOR up to `lo` (OFF-ish lower guard, no perms) — actually use entry0 addr as the
    // base for entry1's TOR. entry1: TOR [lo,hi) R-only.
    let p = pmp_with(&[
        (0, lo >> 2),         // entry0: A=OFF, its addr is entry1's TOR base
        (R | A_TOR, hi >> 2), // entry1: TOR [lo, hi), R only
    ]);
    // S-mode load fully inside → ok.
    assert!(
        p.check(hi - 8, 8, PmpAccess::Read, Priv::S),
        "load at last dword ok"
    );
    // 8-byte load straddling the end (last 4 in, next 4 out) → fail.
    assert!(
        !p.check(hi - 4, 8, PmpAccess::Read, Priv::S),
        "straddle fails"
    );
    // Store anywhere in range → fail (no W).
    assert!(
        !p.check(lo + 0x10, 8, PmpAccess::Write, Priv::S),
        "no W → store fails"
    );
    // M-mode store succeeds (entry unlocked → M bypasses).
    assert!(
        p.check(lo + 0x10, 8, PmpAccess::Write, Priv::M),
        "M store ok (unlocked)"
    );
}

#[test]
fn locking_applies_to_m_and_freezes_the_entry() {
    let lo = 0x8000_0000u64;
    let hi = 0x8000_1000u64;
    let mut c = Csrs::at_reset();
    c.access(PMPADDR0, CsrOp::Write, lo >> 2, false, false, 0)
        .unwrap();
    c.access(PMPADDR0 + 1, CsrOp::Write, hi >> 2, false, false, 0)
        .unwrap();
    // entry1: TOR R-only, LOCKED.
    let cfg = (u64::from(R | A_TOR | L)) << 8;
    c.access(PMPCFG0, CsrOp::Write, cfg, false, false, 0)
        .unwrap();
    // Locked → applies to M too: an M-mode store now faults.
    assert!(
        !c.pmp.check(lo + 0x10, 8, PmpAccess::Write, Priv::M),
        "locked entry restricts M"
    );
    assert!(
        c.pmp.check(lo + 0x10, 8, PmpAccess::Read, Priv::M),
        "R still allowed for M"
    );
    // The cfg field and pmpaddr1 are frozen: writes read back unchanged.
    c.access(PMPCFG0, CsrOp::Write, 0, false, false, 0).unwrap(); // try to clear
    assert_eq!(
        c.pmp.read_cfg(0) >> 8 & 0xFF,
        u64::from(R | A_TOR | L),
        "cfg frozen by lock"
    );
    c.access(PMPADDR0 + 1, CsrOp::Write, 0, false, false, 0)
        .unwrap();
    assert_eq!(c.pmp.read_addr(1), hi >> 2, "pmpaddr1 frozen by lock");
    // TOR-neighbor quirk: locking entry1 (TOR) also freezes pmpaddr0 (its base).
    c.access(PMPADDR0, CsrOp::Write, 0, false, false, 0)
        .unwrap();
    assert_eq!(
        c.pmp.read_addr(0),
        lo >> 2,
        "pmpaddr0 frozen by the locked TOR neighbor"
    );
}

#[test]
fn na4_protects_exactly_four_bytes() {
    let base = 0x8000_0040u64;
    let p = pmp_with(&[(R | W | X | A_NA4, base >> 2)]);
    assert!(
        p.check(base, 4, PmpAccess::Read, Priv::S),
        "the 4 bytes are covered"
    );
    // At +4: not matched by this entry → no other entry → S fails (default).
    assert!(
        !p.check(base + 4, 4, PmpAccess::Read, Priv::S),
        "+4 is outside → default deny for S"
    );
    // A single byte at +2 is inside.
    assert!(
        p.check(base + 2, 1, PmpAccess::Read, Priv::S),
        "byte inside"
    );
}

#[test]
fn lowest_numbered_matching_entry_wins() {
    let base = 0x8000_0000u64;
    // entry0 NAPOT denies (no perms), entry1 NAPOT grants — same region. Entry 0 wins → deny.
    let deny = pmp_with(&[
        (A_NAPOT, napot(base, 0x1000)), // entry0: matched, no R/W/X
        (R | W | X | A_NAPOT, napot(base, 0x1000)),
    ]);
    assert!(
        !deny.check(base, 4, PmpAccess::Read, Priv::S),
        "entry0 (deny) wins"
    );
    // Swapped: entry0 grants → permit.
    let permit = pmp_with(&[
        (R | W | X | A_NAPOT, napot(base, 0x1000)),
        (A_NAPOT, napot(base, 0x1000)),
    ]);
    assert!(
        permit.check(base, 4, PmpAccess::Read, Priv::S),
        "entry0 (grant) wins"
    );
}

// ── CSR WARL ─────────────────────────────────────────────────────────────────────

#[test]
fn odd_pmpcfg_is_illegal_and_pmpaddr_high_bits_read_zero() {
    let mut c = Csrs::at_reset();
    // pmpcfg1 (0x3A1) / pmpcfg3 (0x3A3) do not exist in RV64 → illegal instruction.
    assert!(
        c.access(0x3A1, CsrOp::Set, 0, true, false, 0).is_err(),
        "pmpcfg1 illegal"
    );
    assert!(
        c.access(0x3A3, CsrOp::Set, 0, true, false, 0).is_err(),
        "pmpcfg3 illegal"
    );
    // pmpaddr bits [63:54] read back zero (only address[55:2] = 54 bits).
    c.access(PMPADDR0, CsrOp::Write, u64::MAX, false, false, 0)
        .unwrap();
    assert_eq!(
        c.access(PMPADDR0, CsrOp::Set, 0, true, false, 0).unwrap(),
        (1u64 << 54) - 1,
        "pmpaddr [63:54] read 0"
    );
}

#[test]
fn reserved_r0_w1_cfg_is_legalized_to_w0() {
    // R=0,W=1 is reserved (§3.7.1): Spike legalizes it by clearing W, so the region is neither
    // readable nor writable. Ours must too — otherwise a store to it would be wrongly allowed.
    let base = 0x8000_0000u64;
    let p = pmp_with(&[(W | A_NA4, base >> 2)]); // cfg byte 0x12: R=0,W=1,NA4
    // Readback via a CSR probe: W cleared → the stored cfg byte is just A=NA4 (0x10).
    let mut c = Csrs::at_reset();
    c.access(PMPADDR0, CsrOp::Write, base >> 2, false, false, 0)
        .unwrap();
    c.access(PMPCFG0, CsrOp::Write, u64::from(W | A_NA4), false, false, 0)
        .unwrap();
    assert_eq!(
        c.access(PMPCFG0, CsrOp::Set, 0, true, false, 0).unwrap() & 0xFF,
        u64::from(A_NA4),
        "R=0,W=1 legalized: W cleared, only A=NA4 remains"
    );
    // Semantic: an S-mode store to the region is DENIED (no W after legalization).
    assert!(
        !p.check(base, 4, PmpAccess::Write, Priv::S),
        "store to a legalized R0W1 region faults (W was cleared)"
    );
    assert!(
        !p.check(base, 4, PmpAccess::Read, Priv::S),
        "and it's not readable either"
    );
}

// ── end-to-end: U-mode fetch faults without a grant ──────────────────────────────

#[test]
fn u_mode_fetch_without_grant_raises_instruction_access_fault() {
    const HANDLER: u64 = DRAM_BASE + 0x8000;
    let mut m = Machine::new(1024 * 1024);
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap(); // nop the guest never gets to run
    m.hart_mut().csr.mode = Priv::U;
    m.hart_mut().regs.pc = CODE;
    // No PMP grant → the U-mode fetch faults cause 1 with mepc = the fetch pc.
    match m.step() {
        Err(t) => {
            assert_eq!(t.cause as u64, 1, "instruction access fault");
            assert_eq!(t.tval, CODE, "tval = the fetch pc");
        }
        Ok(()) => panic!("U-mode fetch without a PMP grant must fault"),
    }
    // With an all-RAM grant it runs.
    m.hart_mut().csr.pmp.allow_all();
    m.hart_mut().regs.pc = CODE;
    m.step().expect("granted U-mode fetch retires");
}

#[test]
fn mprv_applies_pmp_as_mpp_for_loads_but_not_fetches() {
    // MPRV=1, MPP=S in M-mode: a LOAD is checked as S (faults with no grant) while the FETCH
    // stays M (no fault). Unit-check the effective-mode helper drives the right verdict.
    let mut c = Csrs::at_reset();
    // No PMP grant. mstatus.MPRV=1, MPP=S(0b01).
    c.access(
        MSTATUS,
        CsrOp::Set,
        (1 << 17) | (0b01 << 11),
        false,
        false,
        0,
    )
    .unwrap();
    assert_eq!(c.data_priv(), Priv::S, "MPRV=1 → data access uses MPP=S");
    // The unit itself, asked as S, denies (no grant); as M, allows.
    assert!(
        !c.pmp_ok(DRAM_BASE, 8, PmpAccess::Read, c.data_priv()),
        "MPRV load checked as S → deny"
    );
    assert!(
        c.pmp_ok(DRAM_BASE, 8, PmpAccess::Exec, Priv::M),
        "fetch stays M → allow"
    );
}

#[test]
fn mprv_does_not_affect_fetch_end_to_end() {
    // Drive a real step(): in M-mode with MPRV=1/MPP=S and NO PMP grant, a `lw` at CODE must
    // FETCH successfully (fetch uses the TRUE mode M → M bypasses) but its LOAD is checked as S
    // → LoadAccessFault (cause 5), NOT an instruction-access fault (cause 1). A fetch that
    // wrongly used the MPRV effective mode (S) would fault cause 1 here.
    let mut m = Machine::new(1024 * 1024);
    // lw x1, 0(x2): opcode LOAD(0x03), funct3=010, rs1=x2, rd=x1.
    let lw = (2u32 << 15) | (0b010 << 12) | (1 << 7) | 0x03;
    m.bus_mut().store32(CODE, lw).unwrap();
    m.hart_mut().regs.write(2, DRAM_BASE + 0x100); // load address (also ungranted)
    // mstatus.MPRV=1, MPP=S; mode stays M.
    set_csr(&mut m, MSTATUS, CsrOp::Set, (1 << 17) | (0b01 << 11));
    m.hart_mut().regs.pc = CODE;
    match m.step() {
        Err(t) => assert_eq!(
            t.cause as u64, 5,
            "fetch (M) passed; the load (MPRV→S) faulted cause 5 — not cause 1"
        ),
        Ok(()) => panic!("the MPRV=S load should fault without a grant"),
    }
}

fn set_csr(m: &mut Machine, addr: u16, op: CsrOp, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, op, v, false, false, 0)
        .unwrap();
}
