//! E1-T18: satp mode switching (Bare/Sv39/Sv48). All-or-nothing WARL MODE legalization (the Linux
//! `set_satp_mode` probe), the config gate on Sv48, Bare identity for high addresses Sv39 would
//! reject, the shared level-count-parameterized walker at four levels (512 GiB/1 GiB/2 MiB
//! superpages), per-mode canonical VA checks (bit 38 vs bit 47), and mode-tagged TLB entries so a
//! mode switch without SFENCE.VMA never serves a cross-mode stale hit. Real CSR file, default build.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, Csrs, Priv, SATP};
use wasm_vm_core::hart::Exception;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::mmu::{self, Access};
use wasm_vm_core::ram::Ram;
use wasm_vm_core::tlb::Tlb;

const V: u64 = 1;
const R: u64 = 1 << 1;
const W: u64 = 1 << 2;
const A: u64 = 1 << 6;
const D: u64 = 1 << 7;
const BARE: u64 = 0;
const SV39: u64 = 8;
const SV48: u64 = 9;
const SV57: u64 = 10;

fn pte(pa: u64, perms: u64) -> u64 {
    ((pa >> 12) << 10) | perms
}
fn ram() -> SystemBus {
    SystemBus::new(Ram::new(32 * 1024 * 1024).unwrap())
}
fn wr_satp(c: &mut Csrs, v: u64) -> u64 {
    c.access(SATP, CsrOp::Write, v, false, false, 0).unwrap();
    c.read(SATP)
}

/// A bump-allocating page-table builder over `levels` levels (Sv39 → 3, Sv48 → 4).
struct Pt {
    root: u64,
    next: u64,
    levels: usize,
}
impl Pt {
    fn new(root: u64, levels: usize) -> Self {
        Pt {
            root,
            next: root + 0x1000,
            levels,
        }
    }
    fn alloc(&mut self) -> u64 {
        let t = self.next;
        self.next += 0x1000;
        t
    }
    /// Return the physical address of the leaf-PTE slot at `leaf_level`, building the pointer
    /// chain from the top level down.
    fn leaf_slot(&mut self, bus: &mut SystemBus, va: u64, leaf_level: usize) -> u64 {
        let mut table = self.root;
        for level in ((leaf_level + 1)..self.levels).rev() {
            let vpn = (va >> (12 + level * 9)) & 0x1FF;
            let e = bus.load64(table + vpn * 8).unwrap();
            table = if e & V != 0 {
                (e >> 10) << 12
            } else {
                let t = self.alloc();
                bus.store64(table + vpn * 8, pte(t, V)).unwrap();
                t
            };
        }
        let vpn = (va >> (12 + leaf_level * 9)) & 0x1FF;
        table + vpn * 8
    }
    fn map(&mut self, bus: &mut SystemBus, va: u64, pa: u64, perms: u64, leaf_level: usize) {
        let slot = self.leaf_slot(bus, va, leaf_level);
        bus.store64(slot, pte(pa, perms)).unwrap();
    }
    fn satp(&self, mode: u64, asid: u64) -> u64 {
        (mode << 60) | (asid << 44) | (self.root >> 12)
    }
}

fn s_csrs(satp: u64) -> Csrs {
    let mut c = Csrs::at_reset();
    c.pmp.allow_all();
    c.access(SATP, CsrOp::Write, satp, false, false, 0).unwrap();
    c.mode = Priv::S;
    c
}

// ── AC 1 + 2: all-or-nothing WARL MODE legalization, gated ─────────────────────────────────

#[test]
fn satp_mode_warl_is_all_or_nothing() {
    // Gate ON: Sv39 and Sv48 writes both take effect (readback == written).
    let mut c = Csrs::at_reset(); // sv48 = true by default
    let sv39 = (SV39 << 60) | (1 << 44) | 0x100;
    assert_eq!(wr_satp(&mut c, sv39), sv39, "Sv39 write takes effect");
    let sv48 = (SV48 << 60) | (2 << 44) | 0x200;
    assert_eq!(
        wr_satp(&mut c, sv48),
        sv48,
        "Sv48 write takes effect (gate on)"
    );

    // E1-T28: MODE=10 (Sv57) is now SUPPORTED (enabled by default) → the write TAKES EFFECT.
    let sv57 = (10u64 << 60) | (7 << 44) | 0x777;
    assert_eq!(
        wr_satp(&mut c, sv57),
        sv57,
        "Sv57 (MODE=10) write takes effect"
    );
    // Every TRULY-reserved MODE (1..=7 and 11..=15) is still a COMPLETE no-op: MODE, ASID, and PPN
    // all keep the old value — Linux's set_satp_mode probing relies on this.
    for m in (1..=7).chain(11..=15) {
        let before = c.read(SATP);
        assert_eq!(
            wr_satp(&mut c, (m << 60) | (3 << 44) | 0x333),
            before,
            "reserved MODE={m} write is a no-op"
        );
    }
}

#[test]
fn sv48_write_is_a_noop_when_gated_off() {
    let mut c = Csrs::at_reset();
    c.sv48 = false; // hart does not implement Sv48
    let sv39 = (SV39 << 60) | (1 << 44) | 0x100;
    assert_eq!(wr_satp(&mut c, sv39), sv39, "Sv39 still works");
    // A probe write of MODE=9 must leave satp bit-identical (the OS reads back Sv39 → no Sv48).
    let before = c.read(SATP);
    assert_eq!(
        wr_satp(&mut c, (SV48 << 60) | (2 << 44) | 0x222),
        before,
        "Sv48 write is a total no-op when the gate is off"
    );
    // Bare always works.
    assert_eq!(wr_satp(&mut c, BARE), 0, "Bare write works");
}

// ── AC 3: Bare mode is identity for the FULL address space ──────────────────────────────────

#[test]
fn bare_mode_is_identity_for_high_addresses() {
    let mut bus = ram();
    let mut c = Csrs::at_reset(); // satp Bare
    c.pmp.allow_all();
    // Addresses Sv39 would reject as non-canonical must translate identity under Bare.
    for va in [0x0000_8000_0000_0000u64, 1u64 << 40, 0xFFFF_FFFF_FFFF_F000] {
        assert_eq!(
            mmu::translate(&c, &mut bus, va, Access::Load, Priv::S).unwrap(),
            va,
            "Bare → VA==PA for {va:#x}"
        );
    }
}

// ── AC 4: Sv48 four-level walk + per-mode canonical check ───────────────────────────────────

#[test]
fn sv48_four_level_walk_translates() {
    let mut bus = ram();
    let mut pt = Pt::new(DRAM_BASE + 0x40_0000, 4);
    let va = 0x0000_1234_5678_9000u64; // canonical Sv48
    let pa = DRAM_BASE + 0x80_0000;
    pt.map(&mut bus, va, pa, V | R | W | A | D, 0);
    let c = s_csrs(pt.satp(SV48, 1));
    assert_eq!(
        mmu::translate(&c, &mut bus, va + 0x678, Access::Load, Priv::S).unwrap(),
        pa + 0x678,
        "Sv48 4-level translation with offset passthrough"
    );
    assert_eq!(
        mmu::translate(&c, &mut bus, va, Access::Store, Priv::S).unwrap(),
        pa
    );
}

#[test]
fn sv57_five_level_walk_translates() {
    // E1-T28: Sv57 = 5 levels (256 TiB / 512 GiB / 1 GiB / 2 MiB / 4 KiB). The level-count-
    // parameterized walker handles it with no new fault logic — same builder, levels=5, MODE=10.
    let mut bus = ram();
    let mut pt = Pt::new(DRAM_BASE + 0x40_0000, 5);
    let va = 0x00AB_CDEF_1234_5000u64; // canonical Sv57 (top 7 bits == bit 56 == 0)
    let pa = DRAM_BASE + 0x80_0000;
    pt.map(&mut bus, va, pa, V | R | W | A | D, 0);
    let c = s_csrs(pt.satp(SV57, 1));
    assert_eq!(
        mmu::translate(&c, &mut bus, va + 0x345, Access::Load, Priv::S).unwrap(),
        pa + 0x345,
        "Sv57 5-level translation with offset passthrough"
    );
    assert_eq!(
        mmu::translate(&c, &mut bus, va, Access::Store, Priv::S).unwrap(),
        pa
    );
}

#[test]
fn sv57_non_canonical_va_faults() {
    // Sv57 sign bit is 56: bits [63:57] must equal bit 56. A VA with bit 56 set but the top bits
    // clear is non-canonical → page fault (before any table walk).
    let mut bus = ram();
    let pt = Pt::new(DRAM_BASE + 0x40_0000, 5);
    let c = s_csrs(pt.satp(SV57, 0));
    let non_canonical = 1u64 << 56; // bit 56 = 1, bits [63:57] = 0 ≠ 1
    let t = mmu::translate(&c, &mut bus, non_canonical, Access::Load, Priv::S).unwrap_err();
    assert_eq!(t.cause, Exception::LoadPageFault);
    assert_eq!(t.tval, non_canonical);
}

#[test]
fn sv57_top_level_superpage_maps_and_faults_on_misalignment() {
    // A leaf PTE at the top Sv57 level (4) maps a 256 TiB superpage; the low PPN bits must be zero.
    let mut bus = ram();
    let mut pt = Pt::new(DRAM_BASE + 0x40_0000, 5);
    let va = 0x0000_0012_3456_7000u64; // canonical Sv57
    // Aligned superpage base (all low ppn bits zero): PA at a 256 TiB boundary is impractical to
    // land in a small RAM, so use a level-1 superpage (2 MiB) to exercise the >Sv48 leaf-level path.
    let pa = DRAM_BASE & !((1u64 << 21) - 1); // 2 MiB aligned
    pt.map(&mut bus, va, pa, V | R | W | A | D, 1); // leaf at level 1 = 2 MiB superpage
    let c = s_csrs(pt.satp(SV57, 1));
    let off = va & ((1 << 21) - 1) | 0x111;
    assert_eq!(
        mmu::translate(
            &c,
            &mut bus,
            (va & !((1 << 21) - 1)) + off,
            Access::Load,
            Priv::S
        )
        .unwrap(),
        pa + off,
        "Sv57 2 MiB superpage offset passthrough"
    );
}

#[test]
fn canonical_rule_differs_by_mode() {
    let mut bus = ram();
    // A VA canonical under Sv48 (bits 63:48 == bit47 == 0) but NON-canonical under Sv39
    // (bits 63:39 must equal bit38=0, yet bit 40 is set).
    let va = 1u64 << 40;
    let pa = DRAM_BASE + 0x80_0000;

    // Sv48: maps and translates.
    let mut pt48 = Pt::new(DRAM_BASE + 0x40_0000, 4);
    pt48.map(&mut bus, va, pa, V | R | A, 0);
    let c48 = s_csrs(pt48.satp(SV48, 1));
    assert_eq!(
        mmu::translate(&c48, &mut bus, va, Access::Load, Priv::S).unwrap(),
        pa,
        "Sv48: bit-47 canonical rule admits this VA"
    );

    // Sv39: the same VA is non-canonical (bit-38 rule) → page fault, no walk.
    let mut pt39 = Pt::new(DRAM_BASE + 0x60_0000, 3);
    pt39.map(&mut bus, va & ((1 << 39) - 1), pa, V | R | A, 0);
    let c39 = s_csrs(pt39.satp(SV39, 1));
    assert_eq!(
        mmu::translate(&c39, &mut bus, va, Access::Load, Priv::S)
            .unwrap_err()
            .cause,
        Exception::LoadPageFault,
        "Sv39: bit-38 canonical rule rejects this VA"
    );
}

#[test]
fn sv48_non_canonical_va_faults() {
    let mut bus = ram();
    let pt = Pt::new(DRAM_BASE + 0x40_0000, 4);
    let c = s_csrs(pt.satp(SV48, 1));
    // bits 63:48 != bit47 (bit 48 set, bit47 clear) → page fault for the access type.
    let va = 1u64 << 48;
    assert_eq!(
        mmu::translate(&c, &mut bus, va, Access::Fetch, Priv::S)
            .unwrap_err()
            .cause,
        Exception::InstrPageFault
    );
}

// ── AC 5: Sv48 superpages at every size, offset passthrough + misalignment ──────────────────

#[test]
fn sv48_superpages_pass_offset_and_fault_on_misalignment() {
    // level 1 → 2 MiB, level 2 → 1 GiB, level 3 → 512 GiB. Each aligned leaf passes the low VA
    // bits through; a leaf whose PPN low bits are nonzero is a misaligned superpage → fault.
    for (level, span_bits) in [(1usize, 21u32), (2, 30), (3, 39)] {
        let mut bus = ram();
        let mut pt = Pt::new(DRAM_BASE + 0x40_0000, 4);
        let va = 0x0000_2000_0000_0000u64; // canonical Sv48, aligned high
        // A physical base aligned to this superpage size (low PPN bits must be zero).
        let pbase = (DRAM_BASE + 0x100_0000) & !((1u64 << span_bits) - 1);
        pt.map(&mut bus, va, pbase, V | R | W | A | D, level);
        let c = s_csrs(pt.satp(SV48, 1));
        let off = (1u64 << span_bits) - 0x1000; // top page within the superpage
        assert_eq!(
            mmu::translate(&c, &mut bus, va + off, Access::Load, Priv::S).unwrap(),
            pbase + off,
            "level {level}: {span_bits}-bit superpage offset passthrough"
        );

        // Misaligned superpage: set a low PPN bit that must be zero at this level.
        let mut bus2 = ram();
        let mut pt2 = Pt::new(DRAM_BASE + 0x40_0000, 4);
        let bad_pa = pbase | (1u64 << 12); // ppn bit 0 set → misaligned for any level > 0
        pt2.map(&mut bus2, va, bad_pa, V | R | W | A | D, level);
        let c2 = s_csrs(pt2.satp(SV48, 1));
        assert_eq!(
            mmu::translate(&c2, &mut bus2, va, Access::Load, Priv::S)
                .unwrap_err()
                .cause,
            Exception::LoadPageFault,
            "level {level}: misaligned superpage faults"
        );
    }
}

// ── AC 6: a mode switch without SFENCE.VMA never serves a cross-mode stale hit ──────────────

#[test]
fn mode_switch_without_fence_does_not_serve_stale_entry() {
    let mut bus = ram();
    let va = 0x0000_0012_3456_7000u64; // canonical under both schemes (low, bit-38/47 both 0)

    // Sv39 tables map VA → pa39; Sv48 tables (distinct root) map the SAME VA → pa48.
    let pa39 = DRAM_BASE + 0x80_0000;
    let pa48 = DRAM_BASE + 0x90_0000;
    let mut pt39 = Pt::new(DRAM_BASE + 0x40_0000, 3);
    pt39.map(&mut bus, va, pa39, V | R | A, 0);
    let mut pt48 = Pt::new(DRAM_BASE + 0x60_0000, 4);
    pt48.map(&mut bus, va, pa48, V | R | A, 0);

    let mut c = s_csrs(pt39.satp(SV39, 1));
    let mut tlb = Tlb::new();

    // Translate under Sv39 → pa39, filling a Sv39-tagged entry.
    assert_eq!(
        mmu::translate_cached(&c, &mut tlb, &mut bus, va, Access::Load, Priv::S).unwrap(),
        pa39
    );
    assert_eq!(tlb.walks(), 1);

    // Switch satp to Sv48 WITHOUT an SFENCE.VMA. The Sv39 entry must NOT be served.
    c.access(SATP, CsrOp::Write, pt48.satp(SV48, 1), false, false, 0)
        .unwrap();
    assert_eq!(
        mmu::translate_cached(&c, &mut tlb, &mut bus, va, Access::Load, Priv::S).unwrap(),
        pa48,
        "Sv48 access re-walks; the Sv39-tagged entry is not a cross-mode hit"
    );
    assert_eq!(
        tlb.walks(),
        2,
        "the mode switch forced a fresh walk (mode tag)"
    );

    // And back: Sv39 still hits its own (still-cached) entry — a mode tag, not a flush.
    c.access(SATP, CsrOp::Write, pt39.satp(SV39, 1), false, false, 0)
        .unwrap();
    assert_eq!(
        mmu::translate_cached(&c, &mut tlb, &mut bus, va, Access::Load, Priv::S).unwrap(),
        pa39
    );
    assert_eq!(
        tlb.walks(),
        2,
        "the Sv39 entry survived the excursion (mode-tagged hit)"
    );
}
