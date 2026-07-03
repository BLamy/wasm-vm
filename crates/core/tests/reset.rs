//! E1-T01: spec-correct machine reset and initial architectural state (native side; the
//! same assertions run under wasm32 in crates/wasm/tests/reset.rs).

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{MISA_RV64GC_SU, Priv};
use wasm_vm_core::hart::Hart;
use wasm_vm_core::{Machine, RunOutcome};

/// The documented reset state (Privileged Spec §3.4 / §3.1.1).
fn assert_reset_state(h: &Hart, pc: u64) {
    assert_eq!(h.regs.pc, pc, "pc = reset_vector");
    for r in 0..32 {
        assert_eq!(h.regs.read(r), 0, "x{r} zero at reset");
    }
    assert_eq!(h.csr.mode, Priv::M, "privilege = M");
    assert_eq!(h.csr.mstatus, 0, "mstatus = 0");
    assert!(!h.csr.mie(), "mstatus.MIE = 0");
    assert!(!h.csr.mprv(), "mstatus.MPRV = 0");
    assert_eq!(h.csr.mcause, 0, "mcause = 0");
    assert_eq!(
        h.csr.misa(),
        0x8000_0000_0014_112D,
        "misa MXL=2, A C D F I M S U"
    );
    assert_eq!(h.csr.misa(), MISA_RV64GC_SU);
    assert_eq!(h.csr.mhartid(), 0, "mhartid = 0");
    assert_eq!(h.csr.mvendorid(), 0);
    assert_eq!(h.csr.marchid(), 0);
    assert_eq!(h.csr.mimpid(), 0);
}

#[test]
fn fresh_hart_is_in_reset_state() {
    // Default constructor resets to the virt/Spike vector.
    assert_reset_state(&Hart::new(), DRAM_BASE);
    // reset() to an explicit vector.
    let mut h = Hart::new();
    h.reset(0x8000_1234);
    assert_reset_state(&h, 0x8000_1234);
}

#[test]
fn writing_x0_leaves_it_zero() {
    let mut h = Hart::new();
    // add x0, x1, x2 semantics: any write to x0 is discarded.
    h.regs.write(1, 0xDEAD_BEEF);
    h.regs.write(2, 0x1234);
    h.regs.write(0, h.regs.read(1).wrapping_add(h.regs.read(2)));
    assert_eq!(h.regs.read(0), 0, "x0 stays hardwired zero after a write");
}

#[test]
fn reset_is_bit_identical_from_any_prior_state() {
    // Dirty EVERY resettable field, then reset, and compare the whole hart to a fresh one.
    let mut h = Hart::new();
    for r in 1..32 {
        h.regs.write(r, 0xA5A5_5A5A_u64.wrapping_mul(r as u64 + 1));
    }
    h.regs.pc = 0xDEAD_0000;
    h.csr.mode = Priv::U;
    h.csr.mstatus = u64::MAX; // FS dirty, MIE, MPRV, everything set
    h.csr.mcause = 0x1F;

    h.reset(DRAM_BASE);
    assert_eq!(
        h,
        Hart::new(),
        "reset must clear every dirtied field, bit for bit"
    );
    assert_reset_state(&h, DRAM_BASE);
}

#[test]
fn reset_after_10k_instructions_matches_fresh() {
    // Run a real program that dirties the register file, then churn 10k arbitrary decoded
    // words through the machine bus (most trap illegal — trap purity means no state change;
    // valid ones retire and dirty registers), then reset the hart and compare to a fresh
    // reset — proving no execution state leaks past reset().
    const LOOPS: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");
    let mut m = Machine::new(1024 * 1024);
    m.load_elf(LOOPS).unwrap();
    assert_eq!(m.run(1_000_000), RunOutcome::Exited(0));

    let mut x: u32 = 0x1357_9BDF;
    for _ in 0..10_000 {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        m.bus_mut().store32(DRAM_BASE, x).ok();
        m.hart_mut().regs.pc = DRAM_BASE;
        let _ = m.step_traced(&mut wasm_vm_core::trace::NullSink); // steps one via the real bus
    }

    m.hart_mut().reset(DRAM_BASE);
    assert_eq!(
        *m.hart(),
        Hart::new(),
        "no execution state survives reset()"
    );
}
