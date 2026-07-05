//! E1-T16: the Sv39 page-table walker — three-level translation, every PTE permission bit
//! (V/R/W/X/U/G/A/D), superpages, SUM/MXR, the Svade A/D trap policy, non-canonical VAs, and
//! precise page-fault cause/stval. Real CSR file, default build only.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{Csrs, Priv};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::mmu::{self, Access};
use wasm_vm_core::ram::Ram;

// PTE bit values.
const V: u64 = 1;
const R: u64 = 1 << 1;
const W: u64 = 1 << 2;
const X: u64 = 1 << 3;
const U: u64 = 1 << 4;
const A: u64 = 1 << 6;
const D: u64 = 1 << 7;

// Page-table pages (physical, in RAM). One L2/L1/L0 chain is enough for a single VA.
const L2: u64 = DRAM_BASE + 0x10_0000;
const L1: u64 = DRAM_BASE + 0x10_1000;
const L0: u64 = DRAM_BASE + 0x10_2000;

fn satp_for(root: u64) -> u64 {
    (8u64 << 60) | (root >> 12) // MODE=Sv39, PPN = root >> 12
}
fn pte(ppn_pa: u64, perms: u64) -> u64 {
    ((ppn_pa >> 12) << 10) | perms
}

/// A fresh S-mode CSR file with Sv39 satp rooted at L2 and an all-RAM PMP grant (so the walk's
/// PTE reads and the final access aren't PMP-denied — we're testing translation, not PMP).
fn s_mode_csrs() -> Csrs {
    let mut c = Csrs::at_reset();
    c.pmp.allow_all();
    c.access(
        0x180,
        wasm_vm_core::csr::CsrOp::Write,
        satp_for(L2),
        false,
        false,
        0,
    )
    .unwrap();
    c.mode = Priv::S;
    c
}
fn ram() -> SystemBus {
    SystemBus::new(Ram::new(4 * 1024 * 1024).unwrap())
}

/// Install a 4 KiB leaf mapping VA→PA with `perms`, building the L2→L1→L0 chain.
fn map_4k(bus: &mut SystemBus, va: u64, pa: u64, perms: u64) {
    let (vpn2, vpn1, vpn0) = ((va >> 30) & 0x1FF, (va >> 21) & 0x1FF, (va >> 12) & 0x1FF);
    bus.store64(L2 + vpn2 * 8, pte(L1, V)).unwrap(); // pointer → L1
    bus.store64(L1 + vpn1 * 8, pte(L0, V)).unwrap(); // pointer → L0
    bus.store64(L0 + vpn0 * 8, pte(pa, perms)).unwrap(); // leaf
}

// ── happy paths ──────────────────────────────────────────────────────────────────

#[test]
fn identity_4k_translation_and_offset() {
    let mut bus = ram();
    let c = s_mode_csrs();
    let va = 0x1234_5000u64;
    let pa = DRAM_BASE + 0x8000;
    map_4k(&mut bus, va, pa, V | R | W | X | A | D);
    // Offset within the page passes through.
    assert_eq!(
        mmu::translate(&c, &mut bus, va + 0x678, Access::Load, Priv::S).unwrap(),
        pa + 0x678,
        "VA offset preserved"
    );
    assert_eq!(
        mmu::translate(&c, &mut bus, va, Access::Store, Priv::S).unwrap(),
        pa
    );
    assert_eq!(
        mmu::translate(&c, &mut bus, va, Access::Fetch, Priv::S).unwrap(),
        pa
    );
}

#[test]
fn bare_and_m_mode_are_identity() {
    let mut bus = ram();
    let mut c = Csrs::at_reset(); // satp Bare
    c.pmp.allow_all();
    assert_eq!(
        mmu::translate(&c, &mut bus, 0xDEAD_B000, Access::Load, Priv::S).unwrap(),
        0xDEAD_B000,
        "Bare satp → identity"
    );
    // Sv39 satp but M-mode effective → still identity (no translation for M).
    c.access(
        0x180,
        wasm_vm_core::csr::CsrOp::Write,
        satp_for(L2),
        false,
        false,
        0,
    )
    .unwrap();
    assert_eq!(
        mmu::translate(&c, &mut bus, 0xDEAD_B000, Access::Load, Priv::M).unwrap(),
        0xDEAD_B000,
        "M-mode effective → identity even under Sv39"
    );
}

// ── invalid / reserved PTEs → page fault, cause matches access, stval = VA ──────────

fn faults(c: &Csrs, bus: &mut SystemBus, va: u64, access: Access, cause: u64) {
    match mmu::translate(c, bus, va, access, Priv::S) {
        Err(t) => {
            assert_eq!(t.cause as u64, cause, "cause for {access:?}");
            assert_eq!(t.tval, va, "stval = VA for {access:?}");
        }
        Ok(pa) => panic!("expected page fault for {access:?}, got PA {pa:#x}"),
    }
}

#[test]
fn invalid_and_reserved_ptes_fault_per_access() {
    let va = 0x2000_0000u64;
    // V=0.
    {
        let mut bus = ram();
        let c = s_mode_csrs();
        map_4k(&mut bus, va, DRAM_BASE, 0); // leaf V=0
        faults(&c, &mut bus, va, Access::Load, 13);
        faults(&c, &mut bus, va, Access::Store, 15);
        faults(&c, &mut bus, va, Access::Fetch, 12);
    }
    // R=0, W=1 (reserved).
    {
        let mut bus = ram();
        let c = s_mode_csrs();
        map_4k(&mut bus, va, DRAM_BASE, V | W | A); // R0 W1
        faults(&c, &mut bus, va, Access::Load, 13);
    }
    // Pointer PTE at level 0 (leaf slot holds R=X=0 pointer) → fault.
    {
        let mut bus = ram();
        let c = s_mode_csrs();
        map_4k(&mut bus, va, DRAM_BASE, V); // L0 entry is a pointer (R=W=X=0)
        faults(&c, &mut bus, va, Access::Load, 13);
    }
    // Pointer PTE (non-leaf) with U set is reserved → fault.
    {
        let mut bus = ram();
        let c = s_mode_csrs();
        bus.store64(L2 + ((va >> 30) & 0x1FF) * 8, pte(L1, V | U))
            .unwrap(); // pointer with U
        faults(&c, &mut bus, va, Access::Load, 13);
    }
}

#[test]
fn misaligned_superpage_faults() {
    // A level-1 (2 MiB) leaf whose ppn low 9 bits are nonzero is a misaligned superpage → fault.
    let va = 0x4000_0000u64;
    let mut bus = ram();
    let c = s_mode_csrs();
    bus.store64(L2 + ((va >> 30) & 0x1FF) * 8, pte(L1, V))
        .unwrap();
    // L1 leaf with a misaligned ppn (set bit 10 of the PTE = ppn bit 0).
    let bad = pte(DRAM_BASE + 0x1000, V | R | A); // pa not 2 MiB-aligned
    bus.store64(L1 + ((va >> 21) & 0x1FF) * 8, bad).unwrap();
    faults(&c, &mut bus, va, Access::Load, 13);
}

// ── non-canonical VA ───────────────────────────────────────────────────────────────

#[test]
fn non_canonical_va_faults() {
    let mut bus = ram();
    let c = s_mode_csrs();
    // Bit 38 = 0 but bit 63 = 1 → bits [63:39] != bit 38 → page fault (no walk).
    let va = 1u64 << 63;
    faults(&c, &mut bus, va, Access::Load, 13);
    faults(&c, &mut bus, va, Access::Fetch, 12);
    // The high-half canonical form (all upper bits 1, matching bit 38=1) is fine to WALK
    // (it will fault later for lack of a mapping, but not the canonical check): bit 38 set.
    let hv = 0xFFFF_FFC0_0000_0000; // bit 38 set, sign-extended → canonical
    // No mapping installed → page fault, but tval = hv (walk happened).
    faults(&c, &mut bus, hv, Access::Load, 13);
}

// ── Svade A/D policy ───────────────────────────────────────────────────────────────

#[test]
fn svade_a_and_d_trap_then_succeed() {
    let va = 0x3000_0000u64;
    let pa = DRAM_BASE + 0x4000;
    // A=0 → any access faults.
    {
        let mut bus = ram();
        let c = s_mode_csrs();
        map_4k(&mut bus, va, pa, V | R | W); // A=0, D=0
        faults(&c, &mut bus, va, Access::Load, 13);
    }
    // A=1, D=0: load OK, store faults; after setting D, store OK.
    {
        let mut bus = ram();
        let c = s_mode_csrs();
        map_4k(&mut bus, va, pa, V | R | W | A); // D=0
        assert!(
            mmu::translate(&c, &mut bus, va, Access::Load, Priv::S).is_ok(),
            "A=1 load ok"
        );
        faults(&c, &mut bus, va, Access::Store, 15);
        // Software sets D → store succeeds.
        map_4k(&mut bus, va, pa, V | R | W | A | D);
        assert_eq!(
            mmu::translate(&c, &mut bus, va, Access::Store, Priv::S).unwrap(),
            pa
        );
    }
}

// ── SUM / MXR / U-page privilege ───────────────────────────────────────────────────

#[test]
fn sum_mxr_and_u_page_privilege() {
    let va = 0x5000_0000u64;
    let pa = DRAM_BASE + 0x6000;

    // U page, S-mode: load faults with SUM=0, succeeds with SUM=1.
    {
        let mut bus = ram();
        let mut c = s_mode_csrs();
        map_4k(&mut bus, va, pa, V | R | U | A | D); // U page
        faults(&c, &mut bus, va, Access::Load, 13); // SUM=0
        c.access(
            0x100,
            wasm_vm_core::csr::CsrOp::Set,
            1 << 18,
            false,
            false,
            0,
        )
        .unwrap(); // sstatus.SUM=1
        assert!(
            mmu::translate(&c, &mut bus, va, Access::Load, Priv::S).is_ok(),
            "SUM=1 → S load from U page ok"
        );
        // S-mode FETCH from a U page always faults, even with SUM=1.
        faults(&c, &mut bus, va, Access::Fetch, 12);
    }

    // MXR: an execute-only page (X, R=0) is loadable only when MXR=1.
    {
        let mut bus = ram();
        let mut c = s_mode_csrs();
        map_4k(&mut bus, va, pa, V | X | A); // X-only
        faults(&c, &mut bus, va, Access::Load, 13); // MXR=0
        c.access(
            0x100,
            wasm_vm_core::csr::CsrOp::Set,
            1 << 19,
            false,
            false,
            0,
        )
        .unwrap(); // sstatus.MXR=1
        assert!(
            mmu::translate(&c, &mut bus, va, Access::Load, Priv::S).is_ok(),
            "MXR=1 → X-only page loadable"
        );
    }

    // U-mode may only touch U pages: S reads a non-U (kernel) page fine, but U faults on it.
    {
        let mut bus = ram();
        let c = s_mode_csrs();
        map_4k(&mut bus, va, pa, V | R | U | A); // U page: readable by both
        assert_eq!(
            mmu::translate(&c, &mut bus, va, Access::Load, Priv::U).unwrap(),
            pa,
            "U can read a U page"
        );
        // Now a NON-U page: U faults, S is fine.
        map_4k(&mut bus, va, pa, V | R | A); // U=0 (kernel)
        assert_eq!(
            mmu::translate(&c, &mut bus, va, Access::Load, Priv::S).unwrap(),
            pa,
            "S reads a non-U page"
        );
        match mmu::translate(&c, &mut bus, va, Access::Load, Priv::U) {
            Err(t) => assert_eq!(t.cause as u64, 13, "U load from non-U page → page fault"),
            Ok(_) => panic!("U must not read a non-U page"),
        }
    }
}

// ── superpages ─────────────────────────────────────────────────────────────────────

#[test]
fn superpage_2mib_and_1gib_pass_offset_bits() {
    // 2 MiB leaf at level 1: VA offset bits [20:0] pass through.
    {
        let mut bus = ram();
        let c = s_mode_csrs();
        let va = 0x4020_0000u64; // vpn2/vpn1 select; low 21 bits are the superpage offset
        let base_pa = 0x8000_0000u64; // 2 MiB-aligned
        bus.store64(L2 + ((va >> 30) & 0x1FF) * 8, pte(L1, V))
            .unwrap();
        bus.store64(
            L1 + ((va >> 21) & 0x1FF) * 8,
            pte(base_pa, V | R | W | A | D),
        )
        .unwrap();
        let off = 0x1_2345u64;
        assert_eq!(
            mmu::translate(&c, &mut bus, va + off, Access::Load, Priv::S).unwrap(),
            base_pa + off,
            "2 MiB superpage: 21-bit offset passthrough"
        );
    }
    // 1 GiB leaf at level 2: VA offset bits [29:0] pass through.
    {
        let mut bus = ram();
        let c = s_mode_csrs();
        let va = 0x8000_0000u64;
        let base_pa = 0x8000_0000u64; // 1 GiB-aligned
        bus.store64(
            L2 + ((va >> 30) & 0x1FF) * 8,
            pte(base_pa, V | R | W | A | D),
        )
        .unwrap();
        let off = 0x123_4567u64;
        assert_eq!(
            mmu::translate(&c, &mut bus, va + off, Access::Load, Priv::S).unwrap(),
            base_pa + off,
            "1 GiB superpage: 30-bit offset passthrough"
        );
    }
}

// ── PTW through PMP ────────────────────────────────────────────────────────────────

#[test]
fn ptw_pte_read_denied_by_pmp_is_access_fault_not_page_fault() {
    // A PTE read is a physical access through PMP; if the page-table region is not PMP-permitted,
    // the walk fails with an ACCESS fault (cause 5 for a load), not a page fault (13).
    let mut bus = ram();
    let mut c = Csrs::at_reset();
    // Grant PMP RWX only to a region that does NOT include the page tables (L2 at +0x10_0000).
    // NAPOT over [DRAM_BASE, DRAM_BASE+0x8_0000) (512 KiB) — tables are above it.
    let base = DRAM_BASE;
    let size = 0x8_0000u64;
    let napot = ((base >> 2) & !((size >> 3) - 1)) | ((size >> 3) - 1);
    c.access(
        0x3B0,
        wasm_vm_core::csr::CsrOp::Write,
        napot,
        false,
        false,
        0,
    )
    .unwrap(); // pmpaddr0
    c.access(
        0x3A0,
        wasm_vm_core::csr::CsrOp::Write,
        R | W | X | (3 << 3),
        false,
        false,
        0,
    )
    .unwrap(); // pmpcfg0 NAPOT RWX
    c.access(
        0x180,
        wasm_vm_core::csr::CsrOp::Write,
        satp_for(L2),
        false,
        false,
        0,
    )
    .unwrap();
    c.mode = Priv::S;
    let va = 0x1000_0000u64;
    map_4k(&mut bus, va, DRAM_BASE, V | R | A);
    // The load's PTE read (at L2, outside the PMP grant) is denied → LoadAccessFault (5).
    match mmu::translate(&c, &mut bus, va, Access::Load, Priv::S) {
        Err(t) => assert_eq!(
            t.cause as u64, 5,
            "PTW PMP denial → access fault, not page fault"
        ),
        Ok(pa) => panic!("expected access fault, got PA {pa:#x}"),
    }
}

// ── MPRV ─────────────────────────────────────────────────────────────────────────

#[test]
fn mprv_translates_loads_as_mpp_but_not_fetches() {
    // In M-mode with MPRV=1/MPP=U: a load translates+checks as U (faults on a non-U page), while
    // a fetch stays M (identity, no translation). The MMU takes the effective priv from the
    // caller; the hart passes data_priv() for data and true mode for fetch.
    let mut bus = ram();
    let c = s_mode_csrs(); // reuse the Sv39 satp + PMP grant
    let va = 0x6000_0000u64;
    let pa = DRAM_BASE + 0x7000;
    map_4k(&mut bus, va, pa, V | R | A); // U=0 (kernel page)
    // Effective U load → faults (non-U page). (The hart would pass data_priv()=U here.)
    match mmu::translate(&c, &mut bus, va, Access::Load, Priv::U) {
        Err(t) => assert_eq!(
            t.cause as u64, 13,
            "MPRV=U load from a kernel page → page fault"
        ),
        Ok(_) => panic!("MPRV=U load must fault on a non-U page"),
    }
    // Effective M fetch → identity (no translation), returns the VA unchanged.
    assert_eq!(
        mmu::translate(&c, &mut bus, va, Access::Fetch, Priv::M).unwrap(),
        va,
        "M-effective fetch is not translated"
    );
}
