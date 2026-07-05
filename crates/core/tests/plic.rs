//! E1-T13: the PLIC — priorities, per-context enables/thresholds, the claim/complete gateway,
//! and MEIP/SEIP routing into mip. Real CSR file + run loop, so default-build native only.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::{DRAM_BASE, PLIC_BASE};
use wasm_vm_core::csr::{CsrOp, MIDELEG, MIE, MIP, MSTATUS, MTVEC, STVEC};

const CODE: u64 = DRAM_BASE;
const HANDLER: u64 = DRAM_BASE + 0x8000;
const MEIP: u64 = 1 << 11;
const SEIP: u64 = 1 << 9;
const MEIE: u64 = 1 << 11;
const SEIE: u64 = 1 << 9;
const MIE_GLOBAL: u64 = 1 << 3;
const INT_MEI: u64 = (1u64 << 63) | 11;
const INT_SEI: u64 = (1u64 << 63) | 9;

// PLIC register addresses.
fn priority(i: u64) -> u64 {
    PLIC_BASE + 4 * i
}
const PENDING: u64 = PLIC_BASE + 0x1000;
fn enable(ctx: u64) -> u64 {
    PLIC_BASE + 0x2000 + 0x80 * ctx
}
fn threshold(ctx: u64) -> u64 {
    PLIC_BASE + 0x0020_0000 + 0x1000 * ctx
}
fn claim(ctx: u64) -> u64 {
    threshold(ctx) + 4
}

fn set_csr(m: &mut Machine, addr: u16, op: CsrOp, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, op, v, false, false, 0)
        .unwrap();
}
fn rd_csr(m: &mut Machine, addr: u16) -> u64 {
    m.hart_mut().csr.read(addr)
}
/// Read a PLIC register over the bus.
fn plic_rd(m: &mut Machine, addr: u64) -> u32 {
    m.bus_mut().load32(addr).unwrap()
}
/// Write a PLIC register over the bus.
fn plic_wr(m: &mut Machine, addr: u64, v: u32) {
    m.bus_mut().store32(addr, v).unwrap();
}

// ── EIP routing + threshold + claim ──────────────────────────────────────────────

#[test]
fn source_enabled_in_s_context_routes_seip_not_meip_and_claim_clears() {
    // Source 5, priority 3, enabled in context 1 (S) only, threshold 0 → SEIP set, MEIP clear;
    // claim from context 1 returns 5 and drops SEIP.
    let mut m = Machine::new(1024 * 1024);
    let plic = m.enable_plic();
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    plic_wr(&mut m, priority(5), 3);
    plic_wr(&mut m, enable(1), 1 << 5); // S context enables source 5
    plic_wr(&mut m, threshold(1), 0);
    plic.borrow_mut().set_level(5, true); // device asserts source 5
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap(); // nop
    m.hart_mut().regs.pc = CODE;
    m.run(1); // one sample mirrors the EIP levels into mip

    assert_ne!(
        rd_csr(&mut m, MIP) & SEIP,
        0,
        "SEIP set (S context enabled)"
    );
    assert_eq!(
        rd_csr(&mut m, MIP) & MEIP,
        0,
        "MEIP clear (M context not enabled)"
    );
    assert_eq!(
        plic_rd(&mut m, PENDING) & (1 << 5),
        1 << 5,
        "source 5 pending"
    );

    // Claim from context 1 returns 5 and clears its pending.
    assert_eq!(plic_rd(&mut m, claim(1)), 5, "claim returns source 5");
    assert_eq!(
        plic_rd(&mut m, PENDING) & (1 << 5),
        0,
        "claim cleared pending"
    );
    m.run(1); // re-sample: SEIP drops now that nothing is pending
    assert_eq!(rd_csr(&mut m, MIP) & SEIP, 0, "SEIP dropped after claim");
}

#[test]
fn threshold_masks_all_sources_at_or_below_it() {
    // threshold = 7 and every priority ≤ 7 → no EIP for that context.
    let mut m = Machine::new(64 * 1024);
    let plic = m.enable_plic();
    plic_wr(&mut m, priority(2), 7);
    plic_wr(&mut m, priority(6), 5);
    plic_wr(&mut m, enable(0), (1 << 2) | (1 << 6));
    plic_wr(&mut m, threshold(0), 7);
    plic.borrow_mut().set_level(2, true);
    plic.borrow_mut().set_level(6, true);
    assert!(!plic.borrow().eip(0), "priority <= threshold → no EIP");
    // Lower the threshold to 6 → priority-7 source 2 now shows.
    plic_wr(&mut m, threshold(0), 6);
    assert!(plic.borrow().eip(0), "priority 7 > threshold 6 → EIP");
    assert_eq!(plic_rd(&mut m, claim(0)), 2, "claim the priority-7 source");
}

#[test]
fn priority_tie_breaks_to_lowest_source_id() {
    // Sources 3 and 9 pending with equal priority → claim returns 3 first, then 9.
    let mut m = Machine::new(64 * 1024);
    let plic = m.enable_plic();
    plic_wr(&mut m, priority(3), 4);
    plic_wr(&mut m, priority(9), 4);
    plic_wr(&mut m, enable(0), (1 << 3) | (1 << 9));
    plic_wr(&mut m, threshold(0), 0);
    plic.borrow_mut().set_level(3, true);
    plic.borrow_mut().set_level(9, true);
    assert_eq!(plic_rd(&mut m, claim(0)), 3, "tie → lowest id (3) first");
    // Source 3 is claimed (gateway closed); the next claim returns 9.
    assert_eq!(plic_rd(&mut m, claim(0)), 9, "then 9");
    // Both claimed now → nothing left.
    assert_eq!(plic_rd(&mut m, claim(0)), 0, "both claimed → 0");
}

#[test]
fn claim_with_nothing_pending_returns_zero_and_changes_no_state() {
    let mut m = Machine::new(64 * 1024);
    let plic = m.enable_plic();
    plic_wr(&mut m, priority(4), 2);
    plic_wr(&mut m, enable(0), 1 << 4);
    plic_wr(&mut m, threshold(0), 0);
    // No source asserted.
    let before = plic.borrow().clone();
    assert_eq!(
        plic_rd(&mut m, claim(0)),
        0,
        "claim with nothing pending → 0"
    );
    assert_eq!(
        format!("{:?}", plic.borrow()),
        format!("{before:?}"),
        "claim of nothing changed no state"
    );
}

// ── gateway semantics ────────────────────────────────────────────────────────────

#[test]
fn level_reassertion_while_claimed_does_not_repend_until_complete() {
    let mut m = Machine::new(64 * 1024);
    let plic = m.enable_plic();
    plic_wr(&mut m, priority(7), 1);
    plic_wr(&mut m, enable(0), 1 << 7);
    plic_wr(&mut m, threshold(0), 0);
    plic.borrow_mut().set_level(7, true);
    assert_eq!(plic_rd(&mut m, claim(0)), 7);
    assert_eq!(
        plic_rd(&mut m, PENDING) & (1 << 7),
        0,
        "claimed → not pending"
    );

    // Toggle the level while claimed — must NOT re-pend.
    plic.borrow_mut().set_level(7, false);
    plic.borrow_mut().set_level(7, true);
    assert_eq!(
        plic_rd(&mut m, PENDING) & (1 << 7),
        0,
        "re-assertion while claimed does not re-pend"
    );
    // COMPLETE re-opens the gateway; the still-high level re-pends.
    plic_wr(&mut m, claim(0), 7); // complete source 7 for context 0
    assert_eq!(
        plic_rd(&mut m, PENDING) & (1 << 7),
        1 << 7,
        "after complete, the held level re-pends (level-triggered)"
    );
}

#[test]
fn complete_from_wrong_context_or_stale_id_is_ignored() {
    let mut m = Machine::new(64 * 1024);
    let plic = m.enable_plic();
    plic_wr(&mut m, priority(8), 2);
    plic_wr(&mut m, enable(0), 1 << 8); // enabled for context 0 only
    plic_wr(&mut m, threshold(0), 0);
    plic.borrow_mut().set_level(8, true);
    assert_eq!(plic_rd(&mut m, claim(0)), 8, "context 0 claims source 8");

    // Complete from context 1 (which never claimed it) must NOT reopen context 0's gateway.
    plic_wr(&mut m, claim(1), 8);
    assert_eq!(
        plic_rd(&mut m, PENDING) & (1 << 8),
        0,
        "wrong-context complete left the gateway closed"
    );
    // Complete of a never-claimed id (3) and an out-of-range id (99) are both ignored — they
    // must not reopen source 8's gateway.
    plic_wr(&mut m, claim(0), 3);
    plic_wr(&mut m, claim(0), 99);
    assert_eq!(
        plic_rd(&mut m, PENDING) & (1 << 8),
        0,
        "unrelated / out-of-range completes did not reopen source 8"
    );
    // Now the correct complete reopens it.
    plic_wr(&mut m, claim(0), 8);
    assert_eq!(
        plic_rd(&mut m, PENDING) & (1 << 8),
        1 << 8,
        "correct-context complete reopened the gateway"
    );
}

// ── end-to-end delivery through the interrupt machinery ───────────────────────────

#[test]
fn meip_delivered_through_mtvec_then_claim_and_complete() {
    let mut m = Machine::new(1024 * 1024);
    let plic = m.enable_plic();
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MIE, CsrOp::Write, MEIE);
    set_csr(&mut m, MSTATUS, CsrOp::Set, MIE_GLOBAL);
    plic_wr(&mut m, priority(1), 5);
    plic_wr(&mut m, enable(0), 1 << 1); // M context
    plic_wr(&mut m, threshold(0), 0);
    plic.borrow_mut().set_level(1, true);
    m.bus_mut().store32(CODE, 0x0000_006F).unwrap(); // jal x0,0 (self-loop)
    m.hart_mut().regs.pc = CODE;
    m.run(1); // the external interrupt fires
    assert_eq!(
        rd_csr(&mut m, 0x342),
        INT_MEI,
        "mcause = machine external interrupt"
    );
    assert_eq!(m.hart().regs.pc, HANDLER, "vectored to mtvec");
    // The handler claims, handles, completes.
    assert_eq!(plic_rd(&mut m, claim(0)), 1, "handler claims source 1");
    plic.borrow_mut().set_level(1, false); // device deasserts after being serviced
    plic_wr(&mut m, claim(0), 1); // complete
    assert_eq!(plic_rd(&mut m, PENDING), 0, "no pending after service");
}

#[test]
fn seip_delivered_through_stvec_when_delegated() {
    // mideleg[9]=1 delegates SEI to S; in U-mode a PLIC S-context interrupt vectors to stvec
    // with scause = 0x8000_0000_0000_0009.
    use wasm_vm_core::csr::Priv;
    let mut m = Machine::new(1024 * 1024);
    let plic = m.enable_plic();
    set_csr(&mut m, STVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MIDELEG, CsrOp::Write, 1 << 9); // delegate SEI to S
    set_csr(&mut m, MIE, CsrOp::Write, SEIE);
    set_csr(&mut m, MSTATUS, CsrOp::Set, 1 << 1); // SIE
    plic_wr(&mut m, priority(4), 6);
    plic_wr(&mut m, enable(1), 1 << 4); // S context (1)
    plic_wr(&mut m, threshold(1), 0);
    plic.borrow_mut().set_level(4, true);
    m.hart_mut().csr.mode = Priv::U;
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap();
    m.hart_mut().regs.pc = CODE;
    m.run(1);
    assert_eq!(
        rd_csr(&mut m, 0x142),
        INT_SEI,
        "scause = supervisor external"
    );
    assert_eq!(m.hart().csr.mode, Priv::S, "delivered to S");
    assert_eq!(m.hart().regs.pc, HANDLER, "vectored to stvec");
}

// ── priority against the CLINT timer (MEI > MTI end-to-end) ───────────────────────

#[test]
fn external_interrupt_outranks_the_timer() {
    // MEI (external) and MTI (timer) both pending → MEI wins (higher priority in the chain).
    let mut m = Machine::new(1024 * 1024);
    let plic = m.enable_plic();
    let clint = m.enable_clint(1_000_000);
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MIE, CsrOp::Write, MEIE | (1 << 7)); // MEIE + MTIE
    set_csr(&mut m, MSTATUS, CsrOp::Set, MIE_GLOBAL);
    // Timer already expired.
    clint.borrow_mut().mtime = 100;
    clint.borrow_mut().mtimecmp = 10;
    // External source pending.
    plic_wr(&mut m, priority(2), 7);
    plic_wr(&mut m, enable(0), 1 << 2);
    plic_wr(&mut m, threshold(0), 0);
    plic.borrow_mut().set_level(2, true);
    m.bus_mut().store32(CODE, 0x0000_006F).unwrap(); // jal x0,0
    m.hart_mut().regs.pc = CODE;
    m.run(1);
    assert_eq!(
        rd_csr(&mut m, 0x342),
        INT_MEI,
        "MEI outranks MTI when both pending"
    );
}

// ── EIP recomputation: raising the threshold drops EIP with no claim ──────────────

#[test]
fn raising_threshold_drops_eip_without_a_claim() {
    let mut m = Machine::new(64 * 1024);
    let plic = m.enable_plic();
    plic_wr(&mut m, priority(3), 4);
    plic_wr(&mut m, enable(0), 1 << 3);
    plic_wr(&mut m, threshold(0), 0);
    plic.borrow_mut().set_level(3, true);
    assert!(plic.borrow().eip(0), "EIP asserted");
    // Raise the threshold above the source priority — EIP must drop with no claim.
    plic_wr(&mut m, threshold(0), 4);
    assert!(
        !plic.borrow().eip(0),
        "raising threshold masked the source, EIP dropped"
    );
    assert_eq!(
        plic_rd(&mut m, PENDING) & (1 << 3),
        1 << 3,
        "the source is still pending (only masked, not claimed)"
    );
}
