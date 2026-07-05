//! Sv39 virtual-memory translation (E1-T16, Priv §4.3–4.4): a satp-rooted three-level
//! page-table walk turning a 39-bit virtual address into a physical address, enforcing every PTE
//! permission bit and raising precise page faults. E1-T17 adds a software TLB in front (see
//! [`translate_cached`] and [`crate::tlb`]).
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
//!
//! Translation is factored into three pieces so the TLB can cache exactly the expensive part:
//! [`walk_leaf`] does the memory-touching table walk and returns the leaf PTE + level;
//! [`finish_leaf`] is pure computation (permission + Svade + PA composition) re-run on every
//! access, including TLB hits; [`translate`] composes them (no TLB) and [`translate_cached`]
//! interposes the TLB. Because `finish_leaf` runs on every hit, cached entries stay correct
//! across SUM/MXR/privilege changes and a store can never be served by a load-filled D=0 entry.

use crate::bus::Bus;
use crate::csr::{Csrs, Priv};
use crate::hart::{Exception, Trap};
use crate::pmp::PmpAccess;
use crate::tlb::Tlb;

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

/// satp.MODE values (§4.1.11): Bare = 0, Sv39 = 8, Sv48 = 9 (E1-T18), Sv57 = 10 (E1-T28).
const MODE_SV39: u64 = 8;
const MODE_SV48: u64 = 9;
const MODE_SV57: u64 = 10;
const PTE_V: u64 = 1 << 0;
const PTE_R: u64 = 1 << 1;
const PTE_W: u64 = 1 << 2;
const PTE_X: u64 = 1 << 3;
const PTE_U: u64 = 1 << 4;
const PTE_G: u64 = 1 << 5;
const PTE_A: u64 = 1 << 6;
const PTE_D: u64 = 1 << 7;
/// PTE bits [63:54]: N (Svnapot, 63), PBMT (Svpbmt, 62:61), and the reserved field (60:54). We
/// implement neither Svnapot nor Svpbmt, so any set bit here is a reserved encoding → page fault.
const PTE_RESERVED_HI: u64 = 0xFFC0_0000_0000_0000;

/// True if `va` is canonical for a `sign_bit`-indexed scheme: bits [63:sign_bit+1] all equal
/// bit `sign_bit` (Sv39 → 38, Sv48 → 47).
const fn canonical(va: u64, sign_bit: u32) -> bool {
    let sext = ((va as i64) << (63 - sign_bit)) >> (63 - sign_bit);
    sext as u64 == va
}

/// Translation parameters for the active mode, or `None` when the access is the identity (a
/// Bare satp, an unsupported MODE, or an M-mode effective access). Returns
/// `(levels, sign_bit, mode_tag)`: Sv39 → (3, 38, 8), Sv48 → (4, 47, 9), Sv57 → (5, 56, 10).
/// `mode_tag` tags TLB entries so a mode switch without an SFENCE.VMA can never serve a
/// cross-mode stale hit. (satp MODE is WARL-gated in `csr.rs`, so only supported modes reach
/// here — an unsupported MODE never got written to satp and falls to Bare/identity.)
fn mode_params(csr: &Csrs, eff: Priv) -> Option<(usize, u32, u8)> {
    if matches!(eff, Priv::M) {
        return None;
    }
    match csr.satp() >> 60 {
        MODE_SV39 => Some((3, 38, MODE_SV39 as u8)),
        MODE_SV48 => Some((4, 47, MODE_SV48 as u8)),
        MODE_SV57 => Some((5, 56, MODE_SV57 as u8)),
        _ => None, // Bare (0) or any unsupported MODE → identity
    }
}

/// Translate `va` for `access` at effective privilege `eff` WITHOUT a TLB — the single-shot
/// pure walk (the direct-test entry point and the "TLB hard-disabled" differential oracle). See
/// [`translate_cached`] for the TLB-interposed path used by the running hart.
pub fn translate(
    csr: &Csrs,
    bus: &mut impl Bus,
    va: u64,
    access: Access,
    eff: Priv,
) -> Result<u64, Trap> {
    let Some((levels, sign_bit, _mode)) = mode_params(csr, eff) else {
        return Ok(va);
    };
    if !canonical(va, sign_bit) {
        return Err(Trap {
            cause: access.page_fault(),
            tval: va,
        });
    }
    let (pte, level) = walk_leaf(csr, bus, va, access, eff, levels)?;
    finish_leaf(csr, va, access, eff, pte, level)
}

/// Translate `va` through the software TLB (E1-T17). Identical to [`translate`] modulo legal
/// staleness: a hit skips the table walk but still runs [`finish_leaf`] (permission + Svade)
/// against live CSR state; a miss walks, and — only on full success — caches the leaf.
pub fn translate_cached(
    csr: &Csrs,
    tlb: &mut Tlb,
    bus: &mut impl Bus,
    va: u64,
    access: Access,
    eff: Priv,
) -> Result<u64, Trap> {
    let Some((levels, sign_bit, mode)) = mode_params(csr, eff) else {
        return Ok(va);
    };
    // Canonical check BEFORE the TLB so a non-canonical VA faults and can never alias a cached
    // page (the VPN tag would otherwise collide with a legitimately mapped page).
    if !canonical(va, sign_bit) {
        return Err(Trap {
            cause: access.page_fault(),
            tval: va,
        });
    }
    let satp = csr.satp();
    let asid = (satp >> 44) & 0xFFFF;
    let vpn = va >> 12;
    // The mode tag ensures a Sv39-tagged entry is never served after a switch to Sv48 (or back).
    if let Some(hit) = tlb.lookup(vpn, asid, mode) {
        return finish_leaf(csr, va, access, eff, hit.pte, hit.level as usize);
    }
    // Miss → a real walk. A walk fault is NOT cached (no negative caching → re-walks).
    let (pte, level) = walk_leaf(csr, bus, va, access, eff, levels)?;
    let pa = finish_leaf(csr, va, access, eff, pte, level)?;
    // Cache only on full success: guarantees A=1 and a permitted, well-formed leaf.
    tlb.fill(vpn, asid, pte, level as u8, pte & PTE_G != 0, mode);
    Ok(pa)
}

/// The memory-touching part of translation: walk `levels` levels (Sv39 → 3, Sv48 → 4) top-down
/// and return the leaf `(pte, level)`. Faults on the structural rules (V=0/R0W1, misaligned
/// superpage, reserved pointer, pointer at L0) and on a PMP-denied PTE read (access fault).
/// Precondition: `va` is canonical and the access is translated (not identity). The per-level
/// arithmetic (`9 * level` VPN slices, superpage low-bit masks, PA composition) generalizes
/// across both schemes — this is the shared, level-count-parameterized walk. It is the unit the
/// TLB caches.
fn walk_leaf(
    csr: &Csrs,
    bus: &mut impl Bus,
    va: u64,
    access: Access,
    eff: Priv,
    levels: usize,
) -> Result<(u64, usize), Trap> {
    let fault = |e: Exception| Trap { cause: e, tval: va };
    let satp = csr.satp();
    let mut table = (satp & ((1 << 44) - 1)) << 12;
    for level in (0..levels).rev() {
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

        // Reserved high bits [63:54] — N (63, Svnapot), PBMT (62:61, Svpbmt), and the reserved
        // field (60:54) — must be zero: we implement neither Svnapot nor Svpbmt, so a set bit is a
        // reserved encoding and raises a page fault (§4.4.1; RISCOF vm reserved-bit tests, E1-T20).
        if pte & PTE_RESERVED_HI != 0 {
            return Err(fault(access.page_fault()));
        }

        let ppn = (pte >> 10) & ((1 << 44) - 1);
        if pte & (PTE_R | PTE_X) != 0 {
            // ── Leaf PTE ── at level > 0 the low ppn fields must be zero (misaligned superpage).
            if level > 0 {
                let low = (1u64 << (9 * level)) - 1;
                if ppn & low != 0 {
                    return Err(fault(access.page_fault()));
                }
            }
            return Ok((pte, level));
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

/// The pure part of translation, re-run on every access (walk AND TLB hit): check the leaf's
/// permission (U/SUM/MXR + R/W/X) and the Svade A/D policy for `access` at `eff`, then compose
/// the physical address (superpages pass the low VA bits through). Faults with `tval = va`.
fn finish_leaf(
    csr: &Csrs,
    va: u64,
    access: Access,
    eff: Priv,
    pte: u64,
    level: usize,
) -> Result<u64, Trap> {
    let fault = |e: Exception| Trap { cause: e, tval: va };
    // Permission (U/SUM/MXR and the required R/W/X bit).
    if !perm_ok(csr, pte, access, eff) {
        return Err(fault(access.page_fault()));
    }
    // Svade A/D: A=0 always faults; a store needs D=1.
    if pte & PTE_A == 0 || (access == Access::Store && pte & PTE_D == 0) {
        return Err(fault(access.page_fault()));
    }
    let ppn = (pte >> 10) & ((1 << 44) - 1);
    let phys_ppn = if level == 0 {
        ppn
    } else {
        let low = (1u64 << (9 * level)) - 1;
        (ppn & !low) | ((va >> 12) & low)
    };
    Ok((phys_ppn << 12) | (va & 0xFFF))
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
