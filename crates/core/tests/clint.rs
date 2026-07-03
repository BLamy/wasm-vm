//! E1-T12: the CLINT — machine timer (mtime/mtimecmp → mip.MTIP) and software interrupt
//! (msip → mip.MSIP), plus the deterministic retire-count clock. Real CSR file + run loop, so
//! default-build native only.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::{CLINT_BASE, DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, MIE, MIP, MSTATUS, MTVEC};

const CODE: u64 = DRAM_BASE;
const HANDLER: u64 = DRAM_BASE + 0x8000;
const MTIP: u64 = 1 << 7;
const MSIP_BIT: u64 = 1 << 3;
const MTIE: u64 = 1 << 7;
const MIE_GLOBAL: u64 = 1 << 3;
const INT_MTI: u64 = (1u64 << 63) | 7;

// CLINT register offsets.
const O_MSIP: u64 = 0x0;
const O_MTIMECMP: u64 = 0x4000;
const O_MTIME: u64 = 0xBFF8;

fn set_csr(m: &mut Machine, addr: u16, op: CsrOp, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, op, v, false, false, 0)
        .unwrap();
}
fn rd_csr(m: &mut Machine, addr: u16) -> u64 {
    m.hart_mut().csr.read(addr)
}

// ── the machine timer fires ──────────────────────────────────────────────────────

#[test]
fn timer_fires_at_the_expected_retire_boundary() {
    // clock_div = 1: mtime advances one tick per retired instruction. With mtimecmp = N and a
    // self-looping jal, MTIP goes pending once mtime reaches N; with MTIE+MIE it vectors to
    // mtvec with mcause = 0x8000…0007. Count retirements to the trap and check it is exactly N.
    const N: u64 = 1000;
    let mut m = Machine::new(1024 * 1024);
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = N;
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MIE, CsrOp::Write, MTIE);
    set_csr(&mut m, MSTATUS, CsrOp::Set, MIE_GLOBAL);
    m.bus_mut().store32(CODE, 0x0000_006F).unwrap(); // jal x0, 0 (self-loop)
    m.hart_mut().regs.pc = CODE;

    let mut retired = 0u64;
    let mut fired_at = None;
    for i in 0..(N + 100) {
        m.run(1);
        if m.hart().regs.pc == HANDLER {
            fired_at = Some(i);
            break;
        }
        retired += 1;
    }
    assert_eq!(fired_at, Some(N), "timer fired after exactly N retirements");
    assert_eq!(retired, N, "N instructions retired before the trap");
    assert_eq!(
        rd_csr(&mut m, 0x342),
        INT_MTI,
        "mcause = machine timer interrupt"
    );
    assert_eq!(
        rd_csr(&mut m, 0x341),
        CODE,
        "mepc = the interrupted (self-looping) instruction"
    );
}

#[test]
fn raising_mtimecmp_clears_mtip_without_csr_access() {
    // MTIP is a LEVEL: set mtimecmp in the past → MTIP pending; then raise mtimecmp above mtime
    // → MTIP drops on the next sample, with no CSR write (a sticky-bit impl would fail this).
    let mut m = Machine::new(64 * 1024);
    let clint = m.enable_clint(1_000_000); // slow clock so mtime stays ~0
    clint.borrow_mut().mtime = 50;
    clint.borrow_mut().mtimecmp = 10; // mtime(50) >= 10 → pending
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap(); // nop
    m.hart_mut().regs.pc = CODE;
    m.run(1); // one sample sets MTIP
    assert_ne!(
        rd_csr(&mut m, MIP) & MTIP,
        0,
        "MTIP pending when mtime >= mtimecmp"
    );

    clint.borrow_mut().mtimecmp = 100; // now above mtime
    m.run(1); // next sample re-evaluates the level
    assert_eq!(
        rd_csr(&mut m, MIP) & MTIP,
        0,
        "raising mtimecmp cleared MTIP (level, not sticky)"
    );
}

// ── the software interrupt ───────────────────────────────────────────────────────

#[test]
fn msip_write_sets_and_clears_mip_msip() {
    // Writing 1 then 0 to msip (via the CLINT MMIO register) sets then clears mip.MSIP.
    let mut m = Machine::new(64 * 1024);
    let _clint = m.enable_clint(1_000_000);
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap(); // nop
    m.bus_mut().store32(CODE + 4, 0x0000_0013).unwrap(); // nop
    m.hart_mut().regs.pc = CODE;

    m.bus_mut().store32(CLINT_BASE + O_MSIP, 1).unwrap(); // msip = 1
    m.run(1);
    assert_ne!(rd_csr(&mut m, MIP) & MSIP_BIT, 0, "msip=1 → mip.MSIP set");

    m.bus_mut().store32(CLINT_BASE + O_MSIP, 0).unwrap(); // msip = 0
    m.run(1);
    assert_eq!(rd_csr(&mut m, MIP) & MSIP_BIT, 0, "msip=0 → mip.MSIP clear");
}

#[test]
fn msip_only_bit0_is_significant() {
    // Only bit 0 of msip is implemented (the rest is WPRI/0): writing 0xFFFF_FFFE (bit 0 clear)
    // leaves MSIP clear; 0xFFFF_FFFF (bit 0 set) sets it. (Kills the mutation that honors any
    // nonzero write.)
    let mut m = Machine::new(64 * 1024);
    let _clint = m.enable_clint(1_000_000);
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap(); // nop
    m.bus_mut().store32(CODE + 4, 0x0000_0013).unwrap();
    m.hart_mut().regs.pc = CODE;

    m.bus_mut()
        .store32(CLINT_BASE + O_MSIP, 0xFFFF_FFFE)
        .unwrap(); // bit 0 clear
    m.run(1);
    assert_eq!(
        rd_csr(&mut m, MIP) & MSIP_BIT,
        0,
        "msip with bit 0 clear does not raise MSIP"
    );
    m.bus_mut()
        .store32(CLINT_BASE + O_MSIP, 0xFFFF_FFFF)
        .unwrap(); // bit 0 set
    m.run(1);
    assert_ne!(rd_csr(&mut m, MIP) & MSIP_BIT, 0, "bit 0 set raises MSIP");
}

// ── the clock ticks only on a real retirement ────────────────────────────────────

#[test]
fn clock_does_not_tick_on_a_delivered_trap() {
    // A trapping instruction retires NOTHING, so the retire-count clock must not advance for
    // that iteration. (Kills the mutation that ticks unconditionally after a step.)
    let mut m = Machine::new(64 * 1024);
    let clint = m.enable_clint(1); // one tick per retirement
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    // An illegal instruction (reserved opcode 0x7F) → delivered to mtvec, no retirement.
    m.bus_mut().store32(CODE, 0x0000_007F).unwrap();
    m.hart_mut().regs.pc = CODE;
    assert_eq!(clint.borrow().mtime, 0, "clock starts at 0");
    m.run(1); // the illegal is taken (delivered), retiring nothing
    assert_eq!(m.hart().regs.pc, HANDLER, "trap was delivered");
    assert_eq!(
        clint.borrow().mtime,
        0,
        "a delivered trap does not advance the clock (no retirement)"
    );
    // A real retirement DOES tick: put a nop at the handler and step once.
    m.bus_mut().store32(HANDLER, 0x0000_0013).unwrap(); // nop
    m.run(1);
    assert_eq!(
        clint.borrow().mtime,
        1,
        "a retired instruction ticks the clock"
    );
}

#[test]
fn clock_does_not_tick_on_a_taken_interrupt() {
    // Taking an interrupt at the loop boundary retires nothing → no tick for that iteration.
    let mut m = Machine::new(64 * 1024);
    let clint = m.enable_clint(1);
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MIE, CsrOp::Write, MSIP_BIT); // MSIE
    set_csr(&mut m, MSTATUS, CsrOp::Set, MIE_GLOBAL);
    m.bus_mut().store32(CLINT_BASE + O_MSIP, 1).unwrap(); // raise a software interrupt
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap(); // nop (never reached this iteration)
    m.hart_mut().regs.pc = CODE;
    assert_eq!(clint.borrow().mtime, 0);
    m.run(1); // the interrupt fires at the top; the nop does not run
    assert_eq!(m.hart().regs.pc, HANDLER, "interrupt was taken");
    assert_eq!(
        clint.borrow().mtime,
        0,
        "a taken interrupt does not advance the clock (no retirement)"
    );
}

// ── memory-mapped register semantics ─────────────────────────────────────────────

#[test]
fn mtime_and_mtimecmp_are_readable_writable_memory() {
    let mut m = Machine::new(64 * 1024);
    let _clint = m.enable_clint(1_000_000);
    // 64-bit write + readback.
    m.bus_mut()
        .store64(CLINT_BASE + O_MTIME, 0x0123_4567_89AB_CDEF)
        .unwrap();
    assert_eq!(
        m.bus_mut().load64(CLINT_BASE + O_MTIME).unwrap(),
        0x0123_4567_89AB_CDEF,
        "mtime is writable memory"
    );
    m.bus_mut()
        .store64(CLINT_BASE + O_MTIMECMP, 0xDEAD_BEEF_F00D_CAFE)
        .unwrap();
    assert_eq!(
        m.bus_mut().load64(CLINT_BASE + O_MTIMECMP).unwrap(),
        0xDEAD_BEEF_F00D_CAFE
    );
}

#[test]
fn thirty_two_bit_halves_compose_a_64_bit_register() {
    // The 32-bit-hart idiom for writing a 64-bit mtimecmp: high = all-ones, low, then real high
    // — the transient never dips mtimecmp below mtime, so no spurious MTIP. Here we just verify
    // the two halves compose and read back per QEMU-virt.
    let mut m = Machine::new(64 * 1024);
    let _clint = m.enable_clint(1_000_000);
    // Write the low half then the high half of mtimecmp.
    m.bus_mut()
        .store32(CLINT_BASE + O_MTIMECMP, 0x1122_3344)
        .unwrap();
    m.bus_mut()
        .store32(CLINT_BASE + O_MTIMECMP + 4, 0x5566_7788)
        .unwrap();
    assert_eq!(
        m.bus_mut().load64(CLINT_BASE + O_MTIMECMP).unwrap(),
        0x5566_7788_1122_3344,
        "two 32-bit halves compose little-endian"
    );
    // 32-bit reads of each half.
    assert_eq!(
        m.bus_mut().load32(CLINT_BASE + O_MTIMECMP).unwrap(),
        0x1122_3344,
        "low half"
    );
    assert_eq!(
        m.bus_mut().load32(CLINT_BASE + O_MTIMECMP + 4).unwrap(),
        0x5566_7788,
        "high half"
    );
}

#[test]
fn glitch_free_64bit_program_via_high_low_high_idiom() {
    // Program mtimecmp = 0x0000_0001_0000_0000 from a "32-bit" sequence while a small mtime is
    // running: set high=0xFFFFFFFF, low=0x00000000, high=0x00000001. At no sample does MTIP
    // spuriously fire, because mtimecmp stays huge until the final high write.
    let mut m = Machine::new(64 * 1024);
    let clint = m.enable_clint(1_000_000);
    clint.borrow_mut().mtime = 5;
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MIE, CsrOp::Write, MTIE);
    set_csr(&mut m, MSTATUS, CsrOp::Set, MIE_GLOBAL);
    // high = all-ones
    m.bus_mut()
        .store32(CLINT_BASE + O_MTIMECMP + 4, 0xFFFF_FFFF)
        .unwrap();
    m.bus_mut().store32(CLINT_BASE + O_MTIMECMP, 0).unwrap(); // low = 0
    // mtimecmp is now 0xFFFFFFFF_00000000 — way above mtime=5, so no MTIP.
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap(); // nop
    m.hart_mut().regs.pc = CODE;
    m.run(1);
    assert_eq!(
        rd_csr(&mut m, MIP) & MTIP,
        0,
        "no spurious MTIP during the high-low-high program"
    );
    // Final real high write.
    m.bus_mut()
        .store32(CLINT_BASE + O_MTIMECMP + 4, 0x0000_0001)
        .unwrap();
    assert_eq!(
        m.bus_mut().load64(CLINT_BASE + O_MTIMECMP).unwrap(),
        0x0000_0001_0000_0000
    );
}

// ── rollover: the compare is UNSIGNED ────────────────────────────────────────────

#[test]
fn unsigned_compare_no_interrupt_before_wrap() {
    // mtime near u64::MAX, mtimecmp small: mtime >= mtimecmp is TRUE (unsigned), so MTIP IS
    // pending — the opposite corner. Verify the opposite too: mtime small, mtimecmp near max →
    // NOT pending. This proves the compare is unsigned, not signed.
    let mut m = Machine::new(64 * 1024);
    let clint = m.enable_clint(1_000_000);
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap();
    m.hart_mut().regs.pc = CODE;

    clint.borrow_mut().mtime = u64::MAX - 5;
    clint.borrow_mut().mtimecmp = 2;
    m.run(1);
    assert_ne!(
        rd_csr(&mut m, MIP) & MTIP,
        0,
        "unsigned: mtime(~MAX) >= mtimecmp(2) → pending"
    );

    clint.borrow_mut().mtime = 2;
    clint.borrow_mut().mtimecmp = u64::MAX - 5;
    m.run(1);
    assert_eq!(
        rd_csr(&mut m, MIP) & MTIP,
        0,
        "unsigned: mtime(2) < mtimecmp(~MAX) → not pending (a signed compare would fire)"
    );
}

// ── WFI wakes on the timer ───────────────────────────────────────────────────────

#[test]
fn wfi_wakes_when_timer_expires() {
    // WFI in a loop with MTIE+MIE and a timer a few ticks out: the loop must not hang — the
    // timer fires and vectors to the handler.
    let mut m = Machine::new(64 * 1024);
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = 5;
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MIE, CsrOp::Write, MTIE);
    set_csr(&mut m, MSTATUS, CsrOp::Set, MIE_GLOBAL);
    // wfi ; jal x0,0 (spin) — the wfi retires, the clock advances, the timer eventually fires.
    m.bus_mut().store32(CODE, 0x1050_0073).unwrap(); // wfi
    m.bus_mut().store32(CODE + 4, 0x0000_006F).unwrap(); // jal x0,0
    m.hart_mut().regs.pc = CODE;
    let mut fired = false;
    for _ in 0..100 {
        m.run(1);
        if m.hart().regs.pc == HANDLER {
            fired = true;
            break;
        }
    }
    assert!(fired, "WFI woke and the timer vectored to the handler");
    assert_eq!(rd_csr(&mut m, 0x342), INT_MTI);
}

// ── determinism of the retire-count clock ────────────────────────────────────────

#[test]
fn timer_trap_retire_index_is_deterministic() {
    // The clock is a pure function of retired instructions, so the trap lands at the same retire
    // index every run. Run the same program many times and require an identical index.
    fn trap_index() -> u64 {
        let mut m = Machine::new(256 * 1024);
        let clint = m.enable_clint(3); // one tick per 3 retirements
        clint.borrow_mut().mtimecmp = 40;
        set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
        set_csr(&mut m, MIE, CsrOp::Write, MTIE);
        set_csr(&mut m, MSTATUS, CsrOp::Set, MIE_GLOBAL);
        m.bus_mut().store32(CODE, 0x0000_006F).unwrap(); // jal x0,0
        m.hart_mut().regs.pc = CODE;
        let mut i = 0;
        loop {
            m.run(1);
            if m.hart().regs.pc == HANDLER {
                return i;
            }
            i += 1;
            if i > 10_000 {
                panic!("timer never fired");
            }
        }
    }
    let first = trap_index();
    for _ in 0..100 {
        assert_eq!(
            trap_index(),
            first,
            "retire index of the timer trap is deterministic"
        );
    }
    // div=3, mtimecmp=40 → mtime reaches 40 after 40*3 = 120 retirements.
    assert_eq!(
        first, 120,
        "one tick per 3 retirements → 120 retirements to mtime=40"
    );
}
