//! E1-T17: the software TLB (ASID-tagged, set-associative) in front of the Sv39 walker, and
//! SFENCE.VMA's four invalidation scopes. The unit tests drive [`mmu::translate_cached`] directly
//! (isolating the walk-count hook from instruction fetches) and assert the exact surviving set of
//! cached entries after each fence form via the walk counter; the end-to-end tests drive real
//! SFENCE.VMA instructions through the hart to prove decode, the privilege traps, and the flush
//! wiring. Real CSR file, default build only.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, Csrs, MSTATUS, Priv, SATP};
use wasm_vm_core::hart::Exception;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::mmu::{self, Access};
use wasm_vm_core::ram::Ram;
use wasm_vm_core::tlb::Tlb;

const V: u64 = 1;
const R: u64 = 1 << 1;
const W: u64 = 1 << 2;
const X: u64 = 1 << 3;
const G: u64 = 1 << 5;
const A: u64 = 1 << 6;
const D: u64 = 1 << 7;

fn pte(pa: u64, perms: u64) -> u64 {
    ((pa >> 12) << 10) | perms
}

/// A bump-allocating Sv39 page-table builder over any bus. Distinct pointer tables per subtree,
/// so mapping many VAs never aliases; `map4k`/`map2m` install leaves at level 0 / level 1.
struct Pt {
    root: u64,
    next: u64,
}
impl Pt {
    fn new() -> Self {
        let root = DRAM_BASE + 0x20_0000;
        Pt {
            root,
            next: root + 0x1000,
        }
    }
    fn alloc(&mut self) -> u64 {
        let t = self.next;
        self.next += 0x1000;
        t
    }
    /// Walk/create the pointer chain down to `leaf_level`, returning the physical address of the
    /// leaf PTE slot.
    fn leaf_slot(&mut self, bus: &mut impl Bus, va: u64, leaf_level: usize) -> u64 {
        let mut table = self.root;
        for level in ((leaf_level + 1)..=2usize).rev() {
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
    fn map4k(&mut self, bus: &mut impl Bus, va: u64, pa: u64, perms: u64) {
        let slot = self.leaf_slot(bus, va, 0);
        bus.store64(slot, pte(pa, perms)).unwrap();
    }
    fn map2m(&mut self, bus: &mut impl Bus, va: u64, pa: u64, perms: u64) {
        let slot = self.leaf_slot(bus, va, 1);
        bus.store64(slot, pte(pa, perms)).unwrap();
    }
    fn satp(&self, asid: u64) -> u64 {
        (8u64 << 60) | (asid << 44) | (self.root >> 12)
    }
}

fn ram() -> SystemBus {
    SystemBus::new(Ram::new(16 * 1024 * 1024).unwrap())
}
fn csrs(satp: u64) -> Csrs {
    let mut c = Csrs::at_reset();
    c.pmp.allow_all();
    c.access(SATP, CsrOp::Write, satp, false, false, 0).unwrap();
    c.mode = Priv::S;
    c
}
fn set_satp(c: &mut Csrs, satp: u64) {
    c.access(SATP, CsrOp::Write, satp, false, false, 0).unwrap();
}
/// Translate a load in S-mode through the TLB, expecting success → the physical address.
fn xl(c: &Csrs, tlb: &mut Tlb, bus: &mut impl Bus, va: u64) -> Result<u64, Exception> {
    mmu::translate_cached(c, tlb, bus, va, Access::Load, Priv::S).map_err(|t| t.cause)
}

// ── AC 1: caching proven by staleness, and SFENCE.VMA re-walks ─────────────────────────────

#[test]
fn caches_translation_stale_until_addr_fence() {
    let mut bus = ram();
    let mut pt = Pt::new();
    let va = 0x2000_0000u64;
    let pa1 = DRAM_BASE + 0x40_0000;
    let pa2 = DRAM_BASE + 0x50_0000;
    pt.map4k(&mut bus, va, pa1, V | R | W | A | D);
    let c = csrs(pt.satp(1));
    let mut tlb = Tlb::new();

    assert_eq!(xl(&c, &mut tlb, &mut bus, va), Ok(pa1));
    assert_eq!(tlb.walks(), 1, "first access walks");
    assert_eq!(xl(&c, &mut tlb, &mut bus, va), Ok(pa1));
    assert_eq!(tlb.walks(), 1, "second access is a TLB hit — no walk");

    // Re-point the PTE in memory WITHOUT a fence: the stale TLB entry must still be used.
    pt.map4k(&mut bus, va, pa2, V | R | W | A | D);
    assert_eq!(
        xl(&c, &mut tlb, &mut bus, va),
        Ok(pa1),
        "stale entry survives the un-fenced PTE change"
    );
    assert_eq!(tlb.walks(), 1, "still a hit");

    // Now fence that VA (all ASIDs): the next access re-walks and sees the new mapping.
    tlb.sfence(Some(va), None);
    assert_eq!(
        xl(&c, &mut tlb, &mut bus, va),
        Ok(pa2),
        "re-walk after SFENCE.VMA observes the new PTE"
    );
    assert_eq!(tlb.walks(), 2, "re-walked exactly once");
}

// ── AC 2: ASID-targeted flush spares global entries AND other ASIDs ─────────────────────────

#[test]
fn asid_flush_spares_global_and_other_asid() {
    let mut bus = ram();
    let mut pt = Pt::new();
    let va_ng = 0x2000_0000u64; // non-global page
    let va_g = 0x2040_0000u64; // global page (distinct L1 subtree)
    pt.map4k(&mut bus, va_ng, DRAM_BASE + 0x40_0000, V | R | A | D);
    pt.map4k(&mut bus, va_g, DRAM_BASE + 0x41_0000, V | R | G | A | D);
    let mut c = csrs(pt.satp(1));
    let mut tlb = Tlb::new();

    // Fill under ASID 1: the non-global and the global page.
    xl(&c, &mut tlb, &mut bus, va_ng).unwrap();
    xl(&c, &mut tlb, &mut bus, va_g).unwrap();
    // Fill the SAME non-global VA under ASID 2 (a distinct tag → a distinct entry).
    set_satp(&mut c, pt.satp(2));
    xl(&c, &mut tlb, &mut bus, va_ng).unwrap();
    assert_eq!(tlb.walks(), 3, "three distinct entries filled");

    // Flush ASID 1 only (no VA): global entries and ASID-2 entries must survive.
    tlb.sfence(None, Some(1));

    // Global page under ASID 1 → still cached (global is exempt from ASID flushes).
    set_satp(&mut c, pt.satp(1));
    xl(&c, &mut tlb, &mut bus, va_g).unwrap();
    assert_eq!(tlb.walks(), 3, "global entry survived the ASID-1 flush");
    // Non-global ASID-1 page → flushed → re-walks.
    xl(&c, &mut tlb, &mut bus, va_ng).unwrap();
    assert_eq!(tlb.walks(), 4, "non-global ASID-1 entry was flushed");
    // ASID-2 page → survived.
    set_satp(&mut c, pt.satp(2));
    xl(&c, &mut tlb, &mut bus, va_ng).unwrap();
    assert_eq!(tlb.walks(), 4, "ASID-2 entry survived the ASID-1 flush");
}

// ── AC 3: the full-flush form empties everything, including global entries ──────────────────

#[test]
fn full_flush_empties_including_global() {
    let mut bus = ram();
    let mut pt = Pt::new();
    let va_ng = 0x2000_0000u64;
    let va_g = 0x2040_0000u64;
    pt.map4k(&mut bus, va_ng, DRAM_BASE + 0x40_0000, V | R | A | D);
    pt.map4k(&mut bus, va_g, DRAM_BASE + 0x41_0000, V | R | G | A | D);
    let c = csrs(pt.satp(1));
    let mut tlb = Tlb::new();
    xl(&c, &mut tlb, &mut bus, va_ng).unwrap();
    xl(&c, &mut tlb, &mut bus, va_g).unwrap();
    assert_eq!(tlb.walks(), 2);

    tlb.sfence(None, None); // flush everything

    xl(&c, &mut tlb, &mut bus, va_ng).unwrap();
    xl(&c, &mut tlb, &mut bus, va_g).unwrap();
    assert_eq!(tlb.walks(), 4, "both entries (incl. global) were flushed");
}

// ── AC 4: a 2 MiB superpage entry serves its whole range from one walk (level tag) ─────────

#[test]
fn superpage_entry_serves_whole_2mib_range() {
    let mut bus = ram();
    let mut pt = Pt::new();
    let base = 0x2000_0000u64; // 2 MiB-aligned VA
    let pbase = DRAM_BASE + 0x20_0000; // 2 MiB-aligned PA
    pt.map2m(&mut bus, base, pbase, V | R | W | A | D);
    let c = csrs(pt.satp(1));
    let mut tlb = Tlb::new();

    assert_eq!(xl(&c, &mut tlb, &mut bus, base), Ok(pbase));
    assert_eq!(tlb.walks(), 1);
    // A different 4 KiB offset within the same 2 MiB superpage → served by the SAME entry.
    let hi = base + 0x1F_F000;
    assert_eq!(
        xl(&c, &mut tlb, &mut bus, hi),
        Ok(pbase + 0x1F_F000),
        "superpage passes the offset through"
    );
    assert_eq!(tlb.walks(), 1, "whole 2 MiB range served without a re-walk");
}

// ── AC 5: a faulting translation is never cached (no negative caching) ──────────────────────

#[test]
fn faulting_va_is_never_cached() {
    let mut bus = ram();
    let pt = Pt::new(); // empty tables → nothing mapped
    let c = csrs(pt.satp(1));
    let mut tlb = Tlb::new();
    let va = 0x3000_0000u64;
    assert_eq!(
        xl(&c, &mut tlb, &mut bus, va),
        Err(Exception::LoadPageFault)
    );
    assert_eq!(
        xl(&c, &mut tlb, &mut bus, va),
        Err(Exception::LoadPageFault)
    );
    assert_eq!(tlb.walks(), 2, "each unmapped access performs its own walk");
    assert_eq!(tlb.hits(), 0, "a fault is never a hit");
}

// ── Svade: a store is never served by a load-filled clean (D=0) entry ──────────────────────

#[test]
fn store_not_served_by_load_filled_clean_page() {
    let mut bus = ram();
    let mut pt = Pt::new();
    let va = 0x2000_0000u64;
    let pa = DRAM_BASE + 0x40_0000;
    pt.map4k(&mut bus, va, pa, V | R | W | A); // D=0: clean, writable
    let c = csrs(pt.satp(1));
    let mut tlb = Tlb::new();

    // A load fills the entry (loads don't require D).
    assert_eq!(xl(&c, &mut tlb, &mut bus, va), Ok(pa));
    assert_eq!(tlb.walks(), 1);
    // A store to the same page is a TLB HIT but must still fault on D=0 (re-derived live).
    assert_eq!(
        mmu::translate_cached(&c, &mut tlb, &mut bus, va, Access::Store, Priv::S)
            .map_err(|t| t.cause),
        Err(Exception::StorePageFault),
        "store served from the load-filled clean entry must fault on D=0"
    );
    assert_eq!(
        tlb.walks(),
        1,
        "the store faulted from the cached entry, no re-walk"
    );
}

// ── Live re-check: a privilege change is honored without any flush ──────────────────────────

#[test]
fn permission_recheck_is_live_no_flush_needed() {
    let mut bus = ram();
    let mut pt = Pt::new();
    let va = 0x2000_0000u64;
    let pa = DRAM_BASE + 0x40_0000;
    pt.map4k(&mut bus, va, pa, V | R | W | A | D); // supervisor page (U=0)
    let c = csrs(pt.satp(1));
    let mut tlb = Tlb::new();

    // Fill under S-mode.
    assert_eq!(
        mmu::translate_cached(&c, &mut tlb, &mut bus, va, Access::Load, Priv::S)
            .map_err(|t| t.cause),
        Ok(pa)
    );
    assert_eq!(tlb.walks(), 1);
    // Same cached entry, but effective U-mode: a supervisor page is inaccessible → page fault,
    // decided live in finish_leaf against the cached PTE (no flush required).
    assert_eq!(
        mmu::translate_cached(&c, &mut tlb, &mut bus, va, Access::Load, Priv::U)
            .map_err(|t| t.cause),
        Err(Exception::LoadPageFault),
        "U-mode access to the cached supervisor page faults without a flush"
    );
    assert_eq!(tlb.walks(), 1, "still a hit — permission re-derived live");
}

// ── Aliasing: two VAs → one PA; a VA-targeted fence spares the alias ────────────────────────

#[test]
fn va_targeted_fence_spares_the_alias() {
    let mut bus = ram();
    let mut pt = Pt::new();
    let va_a = 0x2000_0000u64;
    let va_b = 0x2040_0000u64; // distinct VA, same PA
    let pa = DRAM_BASE + 0x40_0000;
    pt.map4k(&mut bus, va_a, pa, V | R | A | D);
    pt.map4k(&mut bus, va_b, pa, V | R | A | D);
    let c = csrs(pt.satp(1));
    let mut tlb = Tlb::new();
    xl(&c, &mut tlb, &mut bus, va_a).unwrap();
    xl(&c, &mut tlb, &mut bus, va_b).unwrap();
    assert_eq!(tlb.walks(), 2);

    // Fence only VA_a (all ASIDs, incl. any global): VA_b's entry must survive.
    tlb.sfence(Some(va_a), None);
    xl(&c, &mut tlb, &mut bus, va_b).unwrap();
    assert_eq!(tlb.walks(), 2, "the alias VA_b survived the VA_a fence");
    xl(&c, &mut tlb, &mut bus, va_a).unwrap();
    assert_eq!(tlb.walks(), 3, "VA_a was flushed and re-walked");
}

// ── The VA-form fence flushes ALL ASIDs including global (form 2) ───────────────────────────

#[test]
fn va_fence_flushes_a_global_entry() {
    // Form 2 (rs1≠x0, rs2=x0): a VA-targeted fence removes an entry regardless of its global
    // bit — unlike an ASID-targeted fence, which spares global entries.
    let mut bus = ram();
    let mut pt = Pt::new();
    let va = 0x2000_0000u64;
    pt.map4k(&mut bus, va, DRAM_BASE + 0x40_0000, V | R | G | A | D); // global
    let mut c = csrs(pt.satp(1));
    let mut tlb = Tlb::new();
    xl(&c, &mut tlb, &mut bus, va).unwrap(); // ASID 1 fills a global entry
    assert_eq!(tlb.walks(), 1);
    // A global entry serves every ASID, so ASID 2 hits it (no second walk).
    set_satp(&mut c, pt.satp(2));
    xl(&c, &mut tlb, &mut bus, va).unwrap();
    assert_eq!(tlb.walks(), 1, "global entry serves ASID 2 too");

    tlb.sfence(Some(va), None); // VA form: removes the global entry

    xl(&c, &mut tlb, &mut bus, va).unwrap();
    assert_eq!(
        tlb.walks(),
        2,
        "the VA fence flushed the global entry → re-walk"
    );
}

// ── The disabled TLB (differential oracle) walks every access ───────────────────────────────

#[test]
fn disabled_tlb_walks_every_access() {
    let mut bus = ram();
    let mut pt = Pt::new();
    let va = 0x2000_0000u64;
    let pa = DRAM_BASE + 0x40_0000;
    pt.map4k(&mut bus, va, pa, V | R | W | A | D);
    let c = csrs(pt.satp(1));
    let mut tlb = Tlb::disabled();
    for _ in 0..5 {
        assert_eq!(xl(&c, &mut tlb, &mut bus, va), Ok(pa));
    }
    assert_eq!(tlb.walks(), 5, "hard-disabled TLB re-walks every access");
    assert_eq!(tlb.hits(), 0, "and never hits");
}

// ── Determinism: capacity-thrash replacement is reproducible ────────────────────────────────

#[test]
fn replacement_is_deterministic() {
    // Map more distinct pages than a single set holds (WAYS=4) that all collide on set index 0,
    // then translate them in a fixed order twice from fresh TLBs — the resulting hit/miss pattern
    // (a proxy for the eviction order) must be identical, as required for native == wasm32 (T22).
    let mut bus = ram();
    let mut pt = Pt::new();
    // VPNs congruent mod NSETS(16): step by 16 pages = 0x10000 bytes so index() collides.
    let vas: [u64; 6] = [
        0x2000_0000,
        0x2001_0000,
        0x2002_0000,
        0x2003_0000,
        0x2004_0000,
        0x2005_0000,
    ];
    for (i, &va) in vas.iter().enumerate() {
        pt.map4k(
            &mut bus,
            va,
            DRAM_BASE + 0x40_0000 + (i as u64) * 0x1000,
            V | R | A | D,
        );
    }
    let c = csrs(pt.satp(1));

    let run = |bus: &mut SystemBus| -> Vec<u64> {
        let mut tlb = Tlb::new();
        let mut walks = Vec::new();
        // A thrashing sequence exceeding the 4-way set: touch all 6, then re-touch the first 3.
        for &va in vas.iter().chain(vas[..3].iter()) {
            xl(&c, &mut tlb, bus, va).unwrap();
            walks.push(tlb.walks());
        }
        walks
    };
    let a = run(&mut bus);
    let b = run(&mut bus);
    assert_eq!(a, b, "replacement pattern is deterministic across runs");
    // Sanity: the re-touch of the earliest-evicted pages must cost extra walks (real thrashing).
    assert!(
        *a.last().unwrap() > 6,
        "capacity thrash forces re-walks (got {a:?})"
    );
}

// ── End-to-end: SFENCE.VMA privilege traps and flush wiring through the hart ────────────────

use wasm_vm_core::hart::Hart;

/// A hart (Bare satp → identity fetch) with an all-RAM PMP grant so S/U fetches are allowed.
fn hart_bus() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.csr.pmp.allow_all();
    (hart, SystemBus::new(Ram::new(64 * 1024 * 1024).unwrap()))
}
fn wr(c: &mut Csrs, addr: u16, v: u64) {
    c.access(addr, CsrOp::Write, v, false, false, 0).unwrap();
}
const SFENCE_VMA_X0_X0: u32 = 0x1200_0073; // sfence.vma x0, x0

#[test]
fn sfence_vma_illegal_in_u_mode() {
    let (mut hart, mut bus) = hart_bus();
    bus.store32(DRAM_BASE, SFENCE_VMA_X0_X0).unwrap();
    hart.csr.mode = Priv::U;
    hart.regs.pc = DRAM_BASE;
    assert_eq!(
        hart.step(&mut bus).unwrap_err().cause,
        Exception::IllegalInstruction,
        "SFENCE.VMA in U-mode is illegal"
    );
}

#[test]
fn sfence_vma_illegal_in_s_when_tvm_set() {
    let (mut hart, mut bus) = hart_bus();
    bus.store32(DRAM_BASE, SFENCE_VMA_X0_X0).unwrap();
    wr(&mut hart.csr, MSTATUS, 1 << 20); // mstatus.TVM (written while still in M-mode)
    hart.csr.mode = Priv::S;
    hart.regs.pc = DRAM_BASE;
    assert_eq!(
        hart.step(&mut bus).unwrap_err().cause,
        Exception::IllegalInstruction,
        "SFENCE.VMA in S with TVM=1 traps illegal (hypervisor intercept)"
    );
}

#[test]
fn sfence_vma_retires_in_s_without_tvm() {
    let (mut hart, mut bus) = hart_bus();
    bus.store32(DRAM_BASE, SFENCE_VMA_X0_X0).unwrap();
    hart.csr.mode = Priv::S;
    hart.regs.pc = DRAM_BASE;
    hart.step(&mut bus).unwrap();
    assert_eq!(
        hart.regs.pc,
        DRAM_BASE + 4,
        "SFENCE.VMA retires as a NOP in S"
    );
}

#[test]
fn executed_sfence_vma_flushes_only_the_targeted_va() {
    // Prove the execute arm passes the right (VA, all-ASID) scope to the TLB: a load fills the
    // data-page entry, an `sfence.vma x7, x0` (x7 = data VA) flushes exactly it, and the next
    // load re-walks while instruction fetches (a different, un-fenced page) stay cached.
    let (mut hart, mut bus) = hart_bus();
    let mut pt = Pt::new();
    let vcode = 0x1000_0000u64;
    let vdata = 0x2000_0000u64;
    let pcode = DRAM_BASE + 0x30_0000;
    let pdata = DRAM_BASE + 0x31_0000;
    pt.map4k(&mut bus, vcode, pcode, V | R | X | A);
    pt.map4k(&mut bus, vdata, pdata, V | R | W | A | D);
    // ld x5,0(x6); sfence.vma x7,x0; ld x5,0(x6)
    let ld = 0x0003_3283u32; // ld x5, 0(x6)
    let sfence_x7 = (0b000_1001u32 << 25) | (7 << 15) | 0x73; // sfence.vma x7, x0
    bus.store32(pcode, ld).unwrap();
    bus.store32(pcode + 4, sfence_x7).unwrap();
    bus.store32(pcode + 8, ld).unwrap();
    wr(&mut hart.csr, SATP, pt.satp(1));
    hart.csr.mode = Priv::S;
    hart.regs.write(6, vdata); // load base
    hart.regs.write(7, vdata); // fence target
    hart.regs.pc = vcode;

    hart.step(&mut bus).unwrap(); // ld: fetch code (walk) + load data (walk)
    let after_ld1 = hart.tlb.walks();
    assert_eq!(after_ld1, 2, "code + data pages each walked once");

    hart.step(&mut bus).unwrap(); // sfence.vma x7,x0: fetch code (hit), flush vdata
    assert_eq!(
        hart.tlb.walks(),
        2,
        "fetch was a hit; the fence adds no walk"
    );
    assert_eq!(hart.tlb.flush_count(), 1, "one SFENCE.VMA executed");

    hart.step(&mut bus).unwrap(); // ld: fetch code (hit), load data (re-walk after flush)
    assert_eq!(
        hart.tlb.walks(),
        3,
        "the flushed data page re-walked; the un-fenced code page stayed cached"
    );
    assert_eq!(hart.regs.pc, vcode + 12, "all three instructions retired");
}
