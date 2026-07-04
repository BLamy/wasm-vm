//! Software TLB (E1-T17): an ASID-tagged, set-associative cache in front of the Sv39 walker
//! (E1-T16) that makes translation amortized-O(1) across the Linux context-switch hot path,
//! plus the invalidation scopes SFENCE.VMA drives.
//!
//! Design choices (documented per the task charter, Priv §4.2.1):
//! - **Unified I/D**: one array serves fetches, loads, and stores. We cache the WALK (the
//!   page-table memory reads), never the permission decision: on a hit the caller re-derives
//!   the permission (U/SUM/MXR + R/W/X) and the Svade A/D policy from the CACHED leaf PTE
//!   against live CSR state ([`crate::mmu::finish_leaf`]). So a store served from a
//!   load-filled clean page still faults on D=0, and SUM/MXR/privilege changes need no flush.
//! - **Fill on success only**: [`Tlb::fill`] is called only after a translation fully succeeds
//!   (valid leaf, A=1, permitted). Faults are never cached — no negative caching, so a faulting
//!   VA re-walks every time — which also guarantees the "an entry can only exist for A=1"
//!   invariant (Svade faults any A=0 access before the fill).
//! - **Set-associative, deterministic replacement**: a fixed `[NSETS][WAYS]` array indexed by
//!   the low VPN bits, with per-set round-robin victim selection. No HashMap — no hashing or
//!   iteration-order nondeterminism, so replacement is bit-identical native vs wasm32 (T22).
//! - The **level tag** records the leaf level (0/1/2 → 4 KiB/2 MiB/1 GiB) so a superpage entry
//!   serves its whole range. The **G (global) bit** is honored by SFENCE.VMA scoping: global
//!   entries survive ASID-targeted fences.
//!
//! satp writes do NOT flush the TLB (spec): a stale entry for the old address space may linger
//! until software issues SFENCE.VMA. OS context-switch code relies on this — it fences (or
//! switches to a fresh ASID) precisely because the hardware does not.

/// The VPN page tag is masked to the widest scheme (Sv48 VPN = 36 bits, VA[47:12]); an Sv39 VA's
/// upper VPN bits are its sign extension (all equal to bit 38 when canonical), so the mask never
/// conflates two distinct canonical Sv39 pages, and the `mode` tag separates the two schemes.
const VPN_MASK: u64 = (1 << 36) - 1;
const NSETS: usize = 16;
const WAYS: usize = 4;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Slot {
    valid: bool,
    /// The VPN (page number) this entry maps, masked to [`VPN_MASK`].
    vpn: u64,
    asid: u64,
    /// The leaf PTE the walk validated (permission + PPN + A/D/G bits).
    pte: u64,
    /// Leaf level: 0 → 4 KiB, 1 → 2 MiB, 2 → 1 GiB, 3 → 512 GiB (Sv48).
    level: u8,
    global: bool,
    /// The satp MODE the entry was walked under (8 = Sv39, 9 = Sv48). A lookup requires a mode
    /// match, so a mode switch without SFENCE.VMA (T18) never serves a cross-mode stale hit.
    mode: u8,
}

impl Slot {
    const EMPTY: Slot = Slot {
        valid: false,
        vpn: 0,
        asid: 0,
        pte: 0,
        level: 0,
        global: false,
        mode: 0,
    };
}

/// A cached leaf translation returned by [`Tlb::lookup`] — the walker's memory result, which
/// the caller re-validates (permission + Svade) against live CSR state before use.
#[derive(Clone, Copy)]
pub struct Hit {
    pub pte: u64,
    pub level: u8,
}

/// The software TLB. Microarchitectural state — NOT part of the architectural snapshot
/// (E0-T17 reads only PC/xregs). Deterministic, so two identical runs leave identical TLBs.
#[derive(Clone, PartialEq, Eq)]
pub struct Tlb {
    sets: [[Slot; WAYS]; NSETS],
    /// Per-set round-robin next-victim index (deterministic replacement).
    victim: [u8; NSETS],
    /// When false the TLB never caches — every lookup misses, every fill is dropped, so the
    /// walker runs on every access. The "TLB hard-disabled" oracle for the adversarial diff.
    enabled: bool,
    hits: u64,
    misses: u64,
    flushes: u64,
}

impl Default for Tlb {
    fn default() -> Self {
        Self::new()
    }
}

impl Tlb {
    pub const fn new() -> Self {
        Tlb {
            sets: [[Slot::EMPTY; WAYS]; NSETS],
            victim: [0; NSETS],
            enabled: true,
            hits: 0,
            misses: 0,
            flushes: 0,
        }
    }

    /// A TLB that never caches (walk every access) — the differential oracle (T17 charter).
    pub const fn disabled() -> Self {
        let mut t = Self::new();
        t.enabled = false;
        t
    }

    const fn index(vpn: u64) -> usize {
        (vpn as usize) & (NSETS - 1)
    }

    /// The most page sizes any supported scheme has (Sv48: level 0..=3). Sv39 never fills level
    /// 3, so probing it there simply misses.
    const LEVELS: u8 = 4;

    /// The superpage-aligned page number: `vpn` with its low `9 * level` bits cleared. A leaf at
    /// `level` is tagged and indexed by this so ANY 4 KiB page inside the superpage finds it.
    const fn align(vpn: u64, level: u8) -> u64 {
        let sh = 9 * level as u32;
        (vpn >> sh) << sh
    }

    /// Look up a cached leaf for `vpn` under `asid` in translation `mode` (8 = Sv39, 9 = Sv48); a
    /// global entry matches any ASID. Probes each page size (a superpage entry serves its whole
    /// range) and requires a mode match. Counts a hit or a miss — a miss is exactly one page-table
    /// walk (see `walks`).
    pub fn lookup(&mut self, vpn: u64, asid: u64, mode: u8) -> Option<Hit> {
        if !self.enabled {
            self.misses += 1;
            return None;
        }
        let vpn = vpn & VPN_MASK;
        for level in 0..Self::LEVELS {
            let tag = Self::align(vpn, level);
            let set = Self::index(tag);
            for way in 0..WAYS {
                let s = self.sets[set][way];
                if s.valid
                    && s.mode == mode
                    && s.level == level
                    && s.vpn == tag
                    && (s.global || s.asid == asid)
                {
                    self.hits += 1;
                    return Some(Hit {
                        pte: s.pte,
                        level: s.level,
                    });
                }
            }
        }
        self.misses += 1;
        None
    }

    /// Insert a validated leaf walked in `mode`. A superpage is stored under its aligned page
    /// number so the whole range hits. Reuses a matching entry, then an invalid way, then evicts
    /// the round-robin victim — all deterministic. Called only after a translation fully succeeds.
    pub fn fill(&mut self, vpn: u64, asid: u64, pte: u64, level: u8, global: bool, mode: u8) {
        if !self.enabled {
            return;
        }
        let vpn = Self::align(vpn & VPN_MASK, level);
        let set = Self::index(vpn);
        let slot = Slot {
            valid: true,
            vpn,
            asid,
            pte,
            level,
            global,
            mode,
        };
        for way in 0..WAYS {
            let s = self.sets[set][way];
            if s.valid
                && s.mode == mode
                && s.level == level
                && s.vpn == vpn
                && s.asid == asid
                && s.global == global
            {
                self.sets[set][way] = slot;
                return;
            }
        }
        for way in 0..WAYS {
            if !self.sets[set][way].valid {
                self.sets[set][way] = slot;
                return;
            }
        }
        let v = self.victim[set] as usize;
        self.sets[set][v] = slot;
        self.victim[set] = ((v + 1) % WAYS) as u8;
    }

    /// SFENCE.VMA invalidation (Priv §4.2.1). The four operand forms map to `(va, asid)`:
    /// - `(None, None)` — flush everything (rs1=x0, rs2=x0).
    /// - `(Some, None)` — flush all entries mapping that VA page, ALL ASIDs incl. global.
    /// - `(None, Some)` — flush that ASID's entries EXCEPT global (global survive).
    /// - `(Some, Some)` — flush that VA+ASID except global.
    ///
    /// An ASID-targeted fence (asid = Some) never removes a global entry; a fence with no ASID
    /// removes global entries too. A VA matches an entry when it falls inside that entry's page
    /// (superpages included, via the level tag). Always counts one flush.
    pub fn sfence(&mut self, va: Option<u64>, asid: Option<u64>) {
        self.flushes += 1;
        let qvpn = va.map(|v| (v >> 12) & VPN_MASK);
        for set in self.sets.iter_mut() {
            for s in set.iter_mut() {
                if !s.valid {
                    continue;
                }
                let va_match = qvpn.is_none_or(|q| Self::align(q, s.level) == s.vpn);
                let asid_match = match asid {
                    None => true,                        // all ASIDs, including global
                    Some(a) => !s.global && s.asid == a, // targeted ASID; global exempt
                };
                if va_match && asid_match {
                    *s = Slot::EMPTY;
                }
            }
        }
    }

    /// Cache hits observed so far (debug interface, T23).
    pub const fn hits(&self) -> u64 {
        self.hits
    }
    /// Page-table walks performed (== misses) — the "walk-count hook" the T17 tests assert on.
    pub const fn walks(&self) -> u64 {
        self.misses
    }
    /// SFENCE.VMA invalidations performed.
    pub const fn flush_count(&self) -> u64 {
        self.flushes
    }
    /// Whether caching is active (false for the [`Tlb::disabled`] oracle).
    pub const fn enabled(&self) -> bool {
        self.enabled
    }
}
