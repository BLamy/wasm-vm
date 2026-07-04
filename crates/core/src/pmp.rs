//! Physical Memory Protection (E1-T15, Priv §3.7): 16 entries with OFF/TOR/NA4/NAPOT matching,
//! R/W/X permissions, and the L lock bit, checked on every physical access (fetch/load/store/
//! AMO, and the E1-T16 page-table walker).
//!
//! Matching rule: the LOWEST-numbered entry that matches ANY byte of the access wins,
//! irrespective of other entries. If that entry matches ALL bytes, the access is allowed/denied
//! by its L/R/W/X bits; if it matches only SOME bytes (a straddle), the access FAILS. If no entry
//! matches: an M-mode access succeeds, but an S/U access FAILS (because ≥1 entry is implemented).
//! An unlocked entry (L=0) never restricts M-mode — M bypasses it — while a locked entry (L=1)
//! applies to M too.

use crate::csr::Priv;

/// The kind of access being checked, selecting which permission bit governs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PmpAccess {
    Read,
    Write,
    Exec,
}

// pmpcfg byte layout (Priv §3.7.1).
const CFG_R: u8 = 1 << 0;
const CFG_W: u8 = 1 << 1;
const CFG_X: u8 = 1 << 2;
const CFG_A: u8 = 0b11 << 3;
const CFG_L: u8 = 1 << 7;
// A-field encodings.
const A_OFF: u8 = 0;
const A_TOR: u8 = 1;
const A_NA4: u8 = 2;
const A_NAPOT: u8 = 3;
/// Software-legal cfg bits: R/W/X/A/L (bits 5–6 are reserved WPRI, read 0).
const CFG_WMASK: u8 = CFG_R | CFG_W | CFG_X | CFG_A | CFG_L;
/// pmpaddr holds physical address[55:2] — 54 bits; [63:54] read 0.
const ADDR_MASK: u64 = (1 << 54) - 1;
/// Number of PMP entries.
pub const NUM_ENTRIES: usize = 64;

/// The 16-entry PMP unit. `cfg[i]` is entry i's configuration byte; `addr[i]` is its raw pmpaddr
/// value (address[55:2]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pmp {
    cfg: [u8; NUM_ENTRIES],
    addr: [u64; NUM_ENTRIES],
}

impl Default for Pmp {
    /// Reset: every entry A=OFF, L=0 (Priv §3.7 recommendation).
    fn default() -> Self {
        Self {
            cfg: [0; NUM_ENTRIES],
            addr: [0; NUM_ENTRIES],
        }
    }
}

impl Pmp {
    /// True if any entry is armed (A != OFF) — the fast-path gate for the hot memory path.
    pub fn any_armed(&self) -> bool {
        self.cfg.iter().any(|c| c & CFG_A != 0)
    }

    // ── CSR views ─────────────────────────────────────────────────────────────────
    /// Read an even pmpcfg CSR (`pmpcfg{0,2,4,…,14}` on RV64 — odd CSRs are illegal). `bank` is
    /// the CSR index, so bank `2b` maps to entries `[8b, 8b+8)`: eight cfg bytes packed
    /// little-endian into the 64-bit CSR. (64 entries → 8 even banks, 0..=14.)
    pub fn read_cfg(&self, bank: usize) -> u64 {
        let base = bank * 4; // bank 0→0, 2→8, 4→16, …, 14→56
        let mut v = 0u64;
        for k in 0..8 {
            v |= u64::from(self.cfg[base + k]) << (k * 8);
        }
        v
    }
    /// Write a pmpcfg bank. Each byte is WARL-legalized (reserved bits cleared) and skipped if
    /// its entry is LOCKED (L=1) — a locked cfg/addr can't change until reset.
    pub fn write_cfg(&mut self, bank: usize, v: u64) {
        let base = bank * 4;
        for k in 0..8 {
            let i = base + k;
            if self.cfg[i] & CFG_L != 0 {
                continue; // locked
            }
            let mut c = ((v >> (k * 8)) as u8) & CFG_WMASK;
            // R=0,W=1 is a RESERVED encoding (§3.7.1); Spike legalizes it by clearing W (so the
            // region is neither readable nor writable). Match that — otherwise a store to such a
            // region would be wrongly ALLOWED.
            if c & CFG_W != 0 && c & CFG_R == 0 {
                c &= !CFG_W;
            }
            self.cfg[i] = c;
        }
    }
    /// Read `pmpaddr[i]` (address[55:2]; [63:54] read 0).
    pub fn read_addr(&self, i: usize) -> u64 {
        self.addr[i] & ADDR_MASK
    }
    /// Write `pmpaddr[i]`, honoring locks: ignored if entry i is locked, OR if entry i+1 is a
    /// LOCKED TOR entry (whose base is `pmpaddr[i]`) — the TOR-neighbor lock quirk (§3.7.1).
    pub fn write_addr(&mut self, i: usize, v: u64) {
        if self.cfg[i] & CFG_L != 0 {
            return;
        }
        if i + 1 < NUM_ENTRIES {
            let hi = self.cfg[i + 1];
            if hi & CFG_L != 0 && (hi & CFG_A) >> 3 == A_TOR {
                return;
            }
        }
        self.addr[i] = v & ADDR_MASK;
    }

    // ── the check ─────────────────────────────────────────────────────────────────
    /// The byte range `[lo, hi)` (byte addresses) that entry `i` covers, or `None` if OFF.
    fn region(&self, i: usize) -> Option<(u64, u64)> {
        let a = (self.cfg[i] & CFG_A) >> 3;
        match a {
            A_OFF => None,
            A_TOR => {
                let lo = if i == 0 { 0 } else { self.addr[i - 1] << 2 };
                let hi = self.addr[i] << 2;
                Some((lo, hi))
            }
            A_NA4 => {
                let lo = self.addr[i] << 2;
                Some((lo, lo + 4))
            }
            _ => {
                // NAPOT: the number of trailing ones `t` sets a 2^(t+3)-byte aligned region.
                let t = (!self.addr[i]).trailing_zeros();
                let base = (self.addr[i] & !((1u64 << (t + 1)) - 1)) << 2;
                Some((base, base + (1u64 << (t + 3))))
            }
        }
    }

    /// Is an access of `len` bytes at `addr` by `mode` permitted for `access`? (E1-T15.)
    pub fn check(&self, addr: u64, len: u64, access: PmpAccess, mode: Priv) -> bool {
        let end = addr.wrapping_add(len); // access covers [addr, end)
        for i in 0..NUM_ENTRIES {
            let Some((lo, hi)) = self.region(i) else {
                continue;
            };
            // Does this entry match ANY byte of the access?
            if addr < hi && lo < end {
                // The lowest-numbered matching entry wins. A straddle (not fully contained) fails.
                if addr < lo || end > hi {
                    return false;
                }
                let cfg = self.cfg[i];
                // An unlocked entry does not restrict M-mode; a locked one does.
                if matches!(mode, Priv::M) && cfg & CFG_L == 0 {
                    return true;
                }
                return match access {
                    PmpAccess::Read => cfg & CFG_R != 0,
                    PmpAccess::Write => cfg & CFG_W != 0,
                    PmpAccess::Exec => cfg & CFG_X != 0,
                };
            }
        }
        // No entry matched: M succeeds; S/U fail (≥1 entry implemented).
        matches!(mode, Priv::M)
    }

    // ── test/harness helper ─────────────────────────────────────────────────────────
    /// Open entry 0 as an all-address NAPOT region granting R/W/X to every mode — the "allow
    /// everything" grant OpenSBI/the riscv-tests p-env install (and bare-metal test harnesses
    /// need) so S/U can touch memory. pmpaddr0 = all-ones NAPOT covers the whole space.
    pub fn allow_all(&mut self) {
        self.cfg[0] = CFG_R | CFG_W | CFG_X | (A_NAPOT << 3);
        self.addr[0] = ADDR_MASK; // NAPOT with all trailing ones → entire address space
    }
}
