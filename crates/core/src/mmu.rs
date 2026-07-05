//! Sv39 virtual-memory translation (E1-T16, Priv §4.3–4.4): a satp-rooted three-level
//! page-table walk turning a 39-bit virtual address into a physical address, enforcing every PTE
//! permission bit and raising precise page faults.
//!
//! Applies to fetch/load/store/AMO in S/U mode (and MPRV-modified M data accesses) when
//! `satp.MODE == Sv39`; a Bare satp or an M-mode (effective) access is the identity. Every PTE
//! read is a physical access routed through PMP (E1-T15): a PMP denial during the walk is an
//! ACCESS fault (cause 1/5/7), not a page fault.
//!
//! A/D policy: the **Svade trap scheme** — an access to a leaf with A=0, or a store to a leaf with
//! D=0, raises a page fault so software sets the bits. We never hardware-update A/D. This is the
//! simplest precise, spec-sanctioned, Linux-compatible choice; reference simulators must be
//! configured to match when diffing (Spike: it hardware-updates by default, so diffs restrict to
//! A=1/D=1 rows or use `--misaligned`-style Svade config / the Sail model for the trap rows).

use crate::bus::Bus;
use crate::csr::{Csrs, Priv};
use crate::hart::{Exception, Trap};
use crate::pmp::PmpAccess;

/// The access class being translated — selects the required PTE permission bit, the PMP access
/// kind, and the page-fault / access-fault cause codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Fetch,
    Load,
    Store,
}

impl Access {
    const fn page_fault(self) -> Exception {
        match self {
            Access::Fetch => Exception::InstrPageFault,
            Access::Load => Exception::LoadPageFault,
            Access::Store => Exception::StorePageFault,
        }
    }
    const fn access_fault(self) -> Exception {
        match self {
            Access::Fetch => Exception::InstrAccessFault,
            Access::Load => Exception::LoadAccessFault,
            Access::Store => Exception::StoreAccessFault,
        }
    }
}

/// satp.MODE for Sv39 (§4.1.11). (Bare = 0; Sv48 = 9 arrives in E1-T18.)
const MODE_SV39: u64 = 8;
const PTE_V: u64 = 1 << 0;
const PTE_R: u64 = 1 << 1;
const PTE_W: u64 = 1 << 2;
const PTE_X: u64 = 1 << 3;
const PTE_U: u64 = 1 << 4;
const PTE_A: u64 = 1 << 6;
const PTE_D: u64 = 1 << 7;

/// Translate `va` for `access` at effective privilege `eff` (the caller resolves MPRV/MPP for
/// data; fetches always pass the true mode). Returns the physical address, or a `Trap` (page
/// fault on a translation-rule violation with `stval = va`; access fault if a PTE read is
/// PMP-denied). `len` is only used by the caller's subsequent PMP check on the final PA.
pub fn translate(
    csr: &Csrs,
    bus: &mut impl Bus,
    va: u64,
    access: Access,
    eff: Priv,
) -> Result<u64, Trap> {
    let satp = csr.satp();
    // Bare, or any M-mode (effective) access → no translation (identity).
    if satp >> 60 != MODE_SV39 || matches!(eff, Priv::M) {
        return Ok(va);
    }
    let fault = |e: Exception| Trap { cause: e, tval: va };

    // Sv39 VA is 39 bits: bits [63:39] must all equal bit 38 (canonical) or it's a page fault.
    let sext = ((va as i64) << (63 - 38)) >> (63 - 38);
    if sext as u64 != va {
        return Err(fault(access.page_fault()));
    }

    // Walk levels 2 → 1 → 0. `table` is the current page-table base physical address.
    let mut table = (satp & ((1 << 44) - 1)) << 12;
    for level in (0..3usize).rev() {
        let vpn = (va >> (12 + level * 9)) & 0x1FF;
        let pte_addr = table + vpn * 8;
        // The PTE read is a physical access → PMP; a denial is an ACCESS fault (original kind).
        if !csr.pmp_ok(pte_addr, 8, PmpAccess::Read, eff) {
            return Err(fault(access.access_fault()));
        }
        let pte = bus
            .load64(pte_addr)
            .map_err(|_| fault(access.access_fault()))?;

        // V=0, or R=0&W=1 (reserved) → page fault.
        if pte & PTE_V == 0 || (pte & PTE_R == 0 && pte & PTE_W != 0) {
            return Err(fault(access.page_fault()));
        }

        let ppn = (pte >> 10) & ((1 << 44) - 1);
        if pte & (PTE_R | PTE_X) != 0 {
            // ── Leaf PTE ──
            // Superpage: at level > 0 the low ppn fields must be zero (misaligned superpage).
            if level > 0 {
                let low = (1u64 << (9 * level)) - 1;
                if ppn & low != 0 {
                    return Err(fault(access.page_fault()));
                }
            }
            // Permission check (U/SUM/MXR and the required R/W/X bit).
            if !perm_ok(csr, pte, access, eff) {
                return Err(fault(access.page_fault()));
            }
            // Svade A/D: A=0 always faults; a store needs D=1.
            if pte & PTE_A == 0 || (access == Access::Store && pte & PTE_D == 0) {
                return Err(fault(access.page_fault()));
            }
            // Compose the PA: a superpage passes the low VA bits through the ppn.
            let phys_ppn = if level == 0 {
                ppn
            } else {
                let low = (1u64 << (9 * level)) - 1;
                (ppn & !low) | ((va >> 12) & low)
            };
            return Ok((phys_ppn << 12) | (va & 0xFFF));
        }

        // ── Pointer PTE (R=0, X=0) ──: a pointer with A/D/U set is reserved → fault; a pointer
        // at the last level (no more tables) → fault. Otherwise descend.
        if pte & (PTE_A | PTE_D | PTE_U) != 0 || level == 0 {
            return Err(fault(access.page_fault()));
        }
        table = ppn << 12;
    }
    unreachable!("the level-0 pointer case returns a fault above");
}

/// Do the leaf PTE's permission bits allow `access` at effective privilege `eff`?
/// (Priv §4.3.1 + the SUM/MXR mstatus modifiers.)
fn perm_ok(csr: &Csrs, pte: u64, access: Access, eff: Priv) -> bool {
    let user_page = pte & PTE_U != 0;
    // Privilege gate on the U bit.
    match eff {
        Priv::U if !user_page => return false, // U-mode may only touch U pages
        // S-mode FETCH from a U page always faults; an S-mode data access to a U page needs SUM.
        Priv::S if user_page && (access == Access::Fetch || !csr.sum()) => return false,
        _ => {}
    }
    // The required R/W/X permission bit.
    match access {
        Access::Fetch => pte & PTE_X != 0,
        // A load is permitted by R, or by X when mstatus.MXR makes execute-only pages readable.
        Access::Load => pte & PTE_R != 0 || (csr.mxr() && pte & PTE_X != 0),
        Access::Store => pte & PTE_W != 0,
    }
}
