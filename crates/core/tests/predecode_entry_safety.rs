//! E4-T30 adversarial entry-hit safety. These cases specifically reach the physical-PC cache hit
//! added by E4-T30, then mutate a permission or execution alias that the cached bytes must not hide.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::RunOutcome;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MEPC, MSTATUS, PMPCFG0, Priv, SATP};
use wasm_vm_core::hart::{Exception, Trap};

const V: u64 = 1;
const R: u64 = 1 << 1;
const X: u64 = 1 << 3;
const A: u64 = 1 << 6;

const PMP_R: u64 = 1;
const PMP_W: u64 = 2;
const PMP_NAPOT: u64 = 3 << 3;
const PMP_TOR: u64 = 1 << 3;

const JAL_X0_0: u32 = 0x0000_006f;

fn pte(pa: u64, perms: u64) -> u64 {
    ((pa >> 12) << 10) | perms
}

struct Pt {
    root: u64,
    next: u64,
}

impl Pt {
    fn new(root: u64) -> Self {
        Self {
            root,
            next: root + 0x1000,
        }
    }

    fn map(&mut self, m: &mut Machine, va: u64, pa: u64, perms: u64) {
        let mut table = self.root;
        for level in (1..=2usize).rev() {
            let vpn = (va >> (12 + level * 9)) & 0x1ff;
            let entry = m.bus_mut().load64(table + vpn * 8).unwrap();
            table = if entry & V != 0 {
                (entry >> 10) << 12
            } else {
                let child = self.next;
                self.next += 0x1000;
                m.bus_mut().store64(table + vpn * 8, pte(child, V)).unwrap();
                child
            };
        }
        let vpn0 = (va >> 12) & 0x1ff;
        m.bus_mut()
            .store64(table + vpn0 * 8, pte(pa, perms))
            .unwrap();
    }

    fn satp(&self) -> u64 {
        (8u64 << 60) | (self.root >> 12)
    }
}

fn trapped(outcome: RunOutcome) -> Trap {
    match outcome {
        RunOutcome::Trapped(trap) => trap,
        other => panic!("expected a trap, got {other:?}"),
    }
}

#[test]
fn cached_entry_rechecks_revoked_pmp_execute_permission() {
    let mut m = Machine::new(8 * 1024 * 1024);
    m.bus_mut().store32(DRAM_BASE, JAL_X0_0).unwrap();
    m.hart_mut().csr.pmp.allow_all();
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_block_cache(true);

    assert_eq!(m.run(2), RunOutcome::MaxInstrs);
    assert_eq!(m.block_cache_entry_stats(), (1, 1));

    // Keep the all-address NAPOT entry armed but revoke X. The decoded block remains cached; its
    // next physical entry lookup must still perform a fresh PMP execute check.
    m.hart_mut().csr.mode = Priv::M;
    m.hart_mut()
        .csr
        .access(
            PMPCFG0,
            CsrOp::Write,
            PMP_R | PMP_W | PMP_NAPOT,
            false,
            false,
            0,
        )
        .unwrap();
    m.hart_mut().csr.mode = Priv::S;
    let trap = trapped(m.run(1));
    assert_eq!(trap.cause, Exception::InstrAccessFault);
    assert_eq!(trap.tval, DRAM_BASE);
    assert_eq!(m.block_cache_entry_stats(), (1, 1));
}

#[test]
fn pmp_change_invalidates_cached_interior_permission() {
    // Two ALU ops followed by jal x0,-8. PMP entry 0 covers through the first op; entry 1 covers
    // the rest of the page. The entry remains executable when X is revoked only from the interior.
    const ADDI_X5_ONE: u32 = (1 << 20) | (5 << 7) | 0x13;
    const ADDI_X6_ONE: u32 = (1 << 20) | (6 << 7) | 0x13;
    const JAL_BACK_8: u32 = 0xff9f_f06f;
    let mut m = Machine::new(8 * 1024 * 1024);
    m.bus_mut().store32(DRAM_BASE, ADDI_X5_ONE).unwrap();
    m.bus_mut().store32(DRAM_BASE + 4, ADDI_X6_ONE).unwrap();
    m.bus_mut().store32(DRAM_BASE + 8, JAL_BACK_8).unwrap();

    // entry0: [0, DRAM+4) RX; entry1: [DRAM+4, DRAM+page) RX.
    m.hart_mut().csr.pmp.write_addr(0, (DRAM_BASE + 4) >> 2);
    m.hart_mut()
        .csr
        .pmp
        .write_addr(1, (DRAM_BASE + 0x1000) >> 2);
    let entry_rx = PMP_R | 4 | PMP_TOR;
    m.hart_mut()
        .csr
        .access(
            PMPCFG0,
            CsrOp::Write,
            entry_rx | (entry_rx << 8),
            false,
            false,
            0,
        )
        .unwrap();
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_block_cache(true);
    assert_eq!(m.run(3), RunOutcome::MaxInstrs);
    assert_eq!(m.block_cache_entry_stats(), (0, 1));

    // Preserve RX for the first region but revoke X from the interior region only.
    m.hart_mut().csr.mode = Priv::M;
    let interior_r = PMP_R | PMP_TOR;
    m.hart_mut()
        .csr
        .access(
            PMPCFG0,
            CsrOp::Write,
            entry_rx | (interior_r << 8),
            false,
            false,
            0,
        )
        .unwrap();
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = DRAM_BASE;
    m.hart_mut().regs.write(5, 0);
    m.hart_mut().regs.write(6, 0);

    let trap = trapped(m.run(2));
    assert_eq!(m.hart().regs.read(5), 1, "executable entry retired");
    assert_eq!(
        m.hart().regs.read(6),
        0,
        "denied cached interior did not run"
    );
    assert_eq!(trap.cause, Exception::InstrAccessFault);
    assert_eq!(trap.tval, DRAM_BASE + 4);
}

#[test]
fn privilege_change_invalidates_cached_interior_permission() {
    // An unlocked PMP entry is bypassed in M-mode but enforced in S-mode. Build a three-op block
    // in M with execute denied only for the interior region, then change ONLY privilege. A cache
    // keyed solely by PMP-register revision would replay the denied second op in S-mode.
    const ADDI_X5_ONE: u32 = (1 << 20) | (5 << 7) | 0x13;
    const ADDI_X6_ONE: u32 = (1 << 20) | (6 << 7) | 0x13;
    const JAL_BACK_8: u32 = 0xff9f_f06f;

    for cache_on in [false, true] {
        let mut m = Machine::new(8 * 1024 * 1024);
        m.bus_mut().store32(DRAM_BASE, ADDI_X5_ONE).unwrap();
        m.bus_mut().store32(DRAM_BASE + 4, ADDI_X6_ONE).unwrap();
        m.bus_mut().store32(DRAM_BASE + 8, JAL_BACK_8).unwrap();

        // entry0: [0, DRAM+4) RX; entry1: [DRAM+4, DRAM+page) R-only. Both are unlocked,
        // therefore M-mode may execute the whole block while S-mode may execute only its entry.
        m.hart_mut().csr.pmp.write_addr(0, (DRAM_BASE + 4) >> 2);
        m.hart_mut()
            .csr
            .pmp
            .write_addr(1, (DRAM_BASE + 0x1000) >> 2);
        let entry_rx = PMP_R | 4 | PMP_TOR;
        let interior_r = PMP_R | PMP_TOR;
        m.hart_mut()
            .csr
            .access(
                PMPCFG0,
                CsrOp::Write,
                entry_rx | (interior_r << 8),
                false,
                false,
                0,
            )
            .unwrap();
        m.hart_mut().csr.mode = Priv::M;
        m.hart_mut().regs.pc = DRAM_BASE;
        m.set_block_cache(cache_on);
        assert_eq!(m.run(3), RunOutcome::MaxInstrs);

        // Do not touch PMP state: privilege alone changes the unlocked entries' effect.
        m.hart_mut().csr.mode = Priv::S;
        m.hart_mut().regs.pc = DRAM_BASE;
        m.hart_mut().regs.write(5, 0);
        m.hart_mut().regs.write(6, 0);

        let trap = trapped(m.run(2));
        assert_eq!(m.hart().regs.read(5), 1, "entry retired; cache={cache_on}");
        assert_eq!(
            m.hart().regs.read(6),
            0,
            "denied interior did not retire; cache={cache_on}"
        );
        assert_eq!(trap.cause, Exception::InstrAccessFault);
        assert_eq!(trap.tval, DRAM_BASE + 4);
    }
}

#[test]
fn mode_change_with_full_grant_retains_cached_code() {
    // A full-address R/W/X grant has identical execute permission in M and S mode. The cache
    // should retain its physically keyed block across that mode transition instead of paying a
    // whole-generation flush on every Linux privilege boundary.
    const ADDI_X5_ONE: u32 = (1 << 20) | (5 << 7) | 0x13;
    const ADDI_X6_ONE: u32 = (1 << 20) | (6 << 7) | 0x13;
    const JAL_BACK_8: u32 = 0xff9f_f06f;

    let mut m = Machine::new(8 * 1024 * 1024);
    m.bus_mut().store32(DRAM_BASE, ADDI_X5_ONE).unwrap();
    m.bus_mut().store32(DRAM_BASE + 4, ADDI_X6_ONE).unwrap();
    m.bus_mut().store32(DRAM_BASE + 8, JAL_BACK_8).unwrap();
    m.hart_mut().csr.pmp.allow_all();
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_block_cache(true);

    assert_eq!(m.run(3), RunOutcome::MaxInstrs);
    let before = m.block_cache_entry_stats();
    let flushes = m.discovery_stats().cache_flushes;

    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = DRAM_BASE;
    assert_eq!(m.run(3), RunOutcome::MaxInstrs);
    assert_eq!(
        m.block_cache_entry_stats().1,
        before.1,
        "mode change rebuilt code"
    );
    assert!(
        m.block_cache_entry_stats().0 > before.0,
        "mode change did not reuse the cached entry"
    );
    assert_eq!(m.discovery_stats().cache_flushes, flushes);
}

#[test]
fn guest_mret_invalidates_cached_interior_permission_before_successor() {
    // Novel verifier attack: unlike a host mutation between run chunks, MRET changes privilege
    // *inside* one run. Because xRET is a block terminator, the successor boundary must observe the
    // new S-mode before re-entering code that was decoded under M-mode's unlocked-PMP bypass.
    const MRET: u32 = 0x3020_0073;
    const ADDI_X5_ONE: u32 = (1 << 20) | (5 << 7) | 0x13;
    const ADDI_X6_ONE: u32 = (1 << 20) | (6 << 7) | 0x13;
    const JAL_BACK_8: u32 = 0xff9f_f06f;
    const TARGET: u64 = DRAM_BASE + 0x100;
    const MPP_S: u64 = 1 << 11;

    let mut m = Machine::new(8 * 1024 * 1024);
    m.bus_mut().store32(DRAM_BASE, MRET).unwrap();
    m.bus_mut().store32(TARGET, ADDI_X5_ONE).unwrap();
    m.bus_mut().store32(TARGET + 4, ADDI_X6_ONE).unwrap();
    m.bus_mut().store32(TARGET + 8, JAL_BACK_8).unwrap();

    // [0, TARGET+4) is RX; [TARGET+4, end-of-page) is R-only. Unlocked entries are bypassed
    // while prewarming in M-mode, then enforced immediately after MRET selects S-mode.
    m.hart_mut().csr.pmp.write_addr(0, (TARGET + 4) >> 2);
    m.hart_mut()
        .csr
        .pmp
        .write_addr(1, (DRAM_BASE + 0x1000) >> 2);
    let entry_rx = PMP_R | 4 | PMP_TOR;
    let interior_r = PMP_R | PMP_TOR;
    m.hart_mut()
        .csr
        .access(
            PMPCFG0,
            CsrOp::Write,
            entry_rx | (interior_r << 8),
            false,
            false,
            0,
        )
        .unwrap();
    m.hart_mut().csr.mode = Priv::M;
    m.hart_mut().regs.pc = TARGET;
    m.set_block_cache(true);
    assert_eq!(m.run(3), RunOutcome::MaxInstrs, "prewarm as M-mode");

    m.hart_mut().regs.write(5, 0);
    m.hart_mut().regs.write(6, 0);
    m.hart_mut().regs.pc = DRAM_BASE;
    m.hart_mut()
        .csr
        .access(MEPC, CsrOp::Write, TARGET, false, false, 0)
        .unwrap();
    m.hart_mut()
        .csr
        .access(MSTATUS, CsrOp::Write, MPP_S, false, false, 0)
        .unwrap();

    let trap = trapped(m.run(3));
    assert_eq!(m.hart().csr.mode, Priv::S, "MRET selected S-mode");
    assert_eq!(m.hart().regs.read(5), 1, "S-mode entry retired");
    assert_eq!(
        m.hart().regs.read(6),
        0,
        "denied cached interior did not retire"
    );
    assert_eq!(trap.cause, Exception::InstrAccessFault);
    assert_eq!(trap.tval, TARGET + 4);
}

#[test]
fn two_virtual_aliases_reuse_one_physical_entry() {
    const VA_A: u64 = 0x1000_0000;
    const VA_B: u64 = 0x2000_0000;
    const PA: u64 = DRAM_BASE + 0x30_0000;

    let mut m = Machine::new(64 * 1024 * 1024);
    let mut pt = Pt::new(DRAM_BASE + 0x20_0000);
    pt.map(&mut m, VA_A, PA, V | R | X | A);
    pt.map(&mut m, VA_B, PA, V | R | X | A);
    m.bus_mut().store32(PA, JAL_X0_0).unwrap();
    m.hart_mut().csr.pmp.allow_all();
    m.hart_mut()
        .csr
        .access(SATP, CsrOp::Write, pt.satp(), false, false, 0)
        .unwrap();
    m.hart_mut().csr.mode = Priv::S;
    m.set_block_cache(true);

    m.hart_mut().regs.pc = VA_A;
    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
    assert_eq!(m.block_cache_entry_stats(), (0, 1));

    m.hart_mut().regs.pc = VA_B;
    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
    assert_eq!(
        m.block_cache_entry_stats(),
        (1, 1),
        "the alias must hit the block keyed by its shared physical PC"
    );
    assert_eq!(m.hart().regs.pc, VA_B, "cached JAL remains VA-relative");
}

#[test]
fn dma_write_between_run_chunks_invalidates_before_next_entry() {
    // addi x5,x0,1 ; addi x6,x0,1 ; jal x0,-8
    const ADDI_ONE: u32 = (1 << 20) | (5 << 7) | 0x13;
    const ADDI_X6_ONE: u32 = (1 << 20) | (6 << 7) | 0x13;
    const ADDI_X6_TWO: u32 = (2 << 20) | (6 << 7) | 0x13;
    const JAL_BACK_8: u32 = 0xff9f_f06f;

    let mut m = Machine::new(8 * 1024 * 1024);
    m.bus_mut().store32(DRAM_BASE, ADDI_ONE).unwrap();
    m.bus_mut().store32(DRAM_BASE + 4, ADDI_X6_ONE).unwrap();
    m.bus_mut().store32(DRAM_BASE + 8, JAL_BACK_8).unwrap();
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_block_cache(true);

    // Execute only the first op, deliberately yielding with a live cursor aimed at the second.
    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
    assert_eq!(m.hart().regs.read(5), 1);
    assert_eq!(m.hart().regs.pc, DRAM_BASE + 4);

    // Model a device/DMA write while the host is between run chunks. It must invalidate even the
    // saved MID-BLOCK cursor before the next instruction, rather than one retirement afterward.
    m.bus_mut().store32(DRAM_BASE + 4, ADDI_X6_TWO).unwrap();
    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
    assert_eq!(m.hart().regs.read(6), 2);
    assert_eq!(m.block_cache_entry_stats().1, 2, "patched tail rebuilt");
}
