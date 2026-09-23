//! Software TLB (E1-T17): an ASID-tagged, set-associative cache in front of the Sv39/Sv48/Sv57
//! walker (E1-T16) that makes translation amortized-O(1) across the Linux context-switch hot path,
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
//!
//! ## Softmmu fast path (perf overhaul)
//!
//! In front of the architectural TLB sits a QEMU-style **fast TLB**: one direct-mapped array per
//! access kind (fetch / load / store), indexed by virtual page number mixed with a small
//! *context* (effective privilege, plus mstatus.SUM for data and mstatus.MXR for loads). An entry
//! caches the COMPLETE outcome of a successful slow-path access for one 4 KiB page — the
//! translation (`pa - va`), the permission decision [`crate::mmu`]'s `finish_leaf` made for that
//! context, and the facts that the whole physical page is RAM and whole-page PMP-permitted — so a
//! hit skips mode decoding, the canonical check, the set-associative probe, `finish_leaf`, and the
//! PMP scan.
//!
//! The fast TLB is a strict cache OF the architectural TLB, never a second source of truth:
//! - Every translated fast entry records the architectural slot it was derived from and that
//!   slot's **stamp**. Any write to a slot (fill, eviction, SFENCE.VMA removal) re-stamps it, which
//!   invalidates every fast entry derived from the old contents. A fast entry therefore hits only
//!   while the architectural entry it mirrors is still resident, so walk counts, replacement,
//!   stale-translation behaviour and the Svade A/D faults are exactly those of the slow path.
//! - Identity translations (Bare satp, M-mode) use a dedicated stamp slot and never count as
//!   architectural hits, exactly like the slow path, which never consults the TLB for them.
//! - Context the entry does not encode is guarded separately: satp writes (and any host-side hart
//!   mutation) call [`Tlb::fast_flush`]; the PMP revision is compared on every hit; debug triggers
//!   bypass the fast path entirely.
//! - It is microarchitectural and never serialized: a fresh or restored hart starts empty.

/// The VPN page tag is masked to the widest scheme (Sv57 VPN = 45 bits, VA[56:12]); a narrower
/// scheme's upper VPN bits are its sign extension (all equal to the top canonical bit), so the
/// mask never conflates two distinct canonical pages, and the `mode` tag separates the schemes.
/// (Was `1<<36` for Sv48 — too narrow for Sv57, which aliased VAs differing only in VA[56:48].)
const VPN_MASK: u64 = (1 << 45) - 1;
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
    /// Leaf level: 0 → 4 KiB, 1 → 2 MiB, 2 → 1 GiB, 3 → 512 GiB, 4 → 256 TiB (Sv57).
    level: u8,
    global: bool,
    /// The satp MODE the entry was walked under (8 = Sv39, 9 = Sv48, 10 = Sv57). A lookup requires a mode
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
    /// The architectural slot (`set * WAYS + way`) that served the hit — the fast TLB's stamp key.
    pub(crate) slot: u8,
}

/// Number of architectural slots (`NSETS * WAYS`).
const ARCH_SLOTS: usize = NSETS * WAYS;
/// Stamp key for identity translations (Bare satp or an M-mode effective access): no
/// architectural entry backs them, so only [`Tlb::fast_flush`] re-stamps this slot.
pub(crate) const IDENTITY_SLOT: u8 = ARCH_SLOTS as u8;
/// "No slot": the architectural TLB did not retain the translation (the disabled oracle), so no
/// fast entry may be derived from it.
pub(crate) const NO_SLOT: u8 = u8::MAX;
/// Stamp table size: the architectural slots plus [`IDENTITY_SLOT`], rounded up to a power of two
/// so a masked index needs no bounds check.
const STAMP_SLOTS: usize = 128;
const STAMP_SLOT_MASK: u64 = STAMP_SLOTS as u64 - 1;
const STAMP_SHIFT: u32 = STAMP_SLOTS.trailing_zeros();

/// Fast-TLB geometry: 1024 direct-mapped entries per access kind.
const FAST_BITS: u32 = 10;
const FAST_N: usize = 1 << FAST_BITS;
/// Access-kind rows of the fast arrays.
pub(crate) const FAST_FETCH: usize = 0;
pub(crate) const FAST_LOAD: usize = 1;
pub(crate) const FAST_STORE: usize = 2;
const FAST_KINDS: usize = 3;
/// The context (≤ 4 bits) sits above the 52-bit VA page number in a fast tag. Empty entries hold
/// `u64::MAX`, which no real tag (≤ 2^56 - 1) can equal.
const FAST_CTX_SHIFT: u32 = 52;
const FAST_EMPTY_TAG: u64 = u64::MAX;

/// One fast-TLB entry: a successful access outcome for one virtual 4 KiB page in one context.
#[derive(Clone, Copy, Debug)]
struct FastEntry {
    /// `(va >> 12) | ctx << 52` — the full VA page number, so a non-canonical VA (which never
    /// fills) can never alias a canonical one.
    tag: u64,
    /// `pa_page.wrapping_sub(va_page)`: the physical address is `va + addend`.
    addend: u64,
    /// `(generation << STAMP_SHIFT) | slot` of the architectural slot this entry mirrors.
    stamp: u64,
}

impl FastEntry {
    const EMPTY: FastEntry = FastEntry {
        tag: FAST_EMPTY_TAG,
        addend: 0,
        stamp: 0,
    };
}

/// The fast TLB's per-hart state. Boxed so the hart stays small and never builds the arrays on
/// the stack.
#[derive(Clone)]
struct FastTlb {
    entries: alloc::boxed::Box<[FastEntry; FAST_KINDS * FAST_N]>,
    /// Current stamp of every architectural slot (+ the identity slot). A fast entry is live only
    /// while its recorded stamp equals its slot's current stamp.
    slot_stamp: [u64; STAMP_SLOTS],
    /// Next stamp generation. 57 bits of generations never wrap in practice, so a stamp is never
    /// reused and a stale entry can never be resurrected.
    next_gen: u64,
    /// The PMP revision every live entry was validated under; a hit requires it to be current.
    pmp_rev: u64,
    /// The satp every live entry was filled under (fill-time resync + debug assertion that no satp
    /// write bypassed [`Tlb::fast_flush`]).
    satp: u64,
    /// False only for the differential oracle ([`Tlb::disable_fast_path`]): nothing is ever
    /// published, so every access takes the slow path.
    enabled: bool,
}

impl FastTlb {
    fn new() -> Self {
        let entries: alloc::boxed::Box<[FastEntry]> =
            alloc::vec![FastEntry::EMPTY; FAST_KINDS * FAST_N].into_boxed_slice();
        let Ok(entries) = entries.try_into() else {
            unreachable!("fast TLB allocation has the exact array length")
        };
        let mut slot_stamp = [0u64; STAMP_SLOTS];
        for (i, s) in slot_stamp.iter_mut().enumerate() {
            *s = i as u64; // generation 0
        }
        FastTlb {
            entries,
            slot_stamp,
            next_gen: 1,
            pmp_rev: 0,
            satp: 0,
            enabled: true,
        }
    }

    /// Re-stamp `slot`, killing every fast entry derived from its previous contents.
    #[inline(always)]
    fn restamp(&mut self, slot: usize) {
        self.slot_stamp[slot & (STAMP_SLOTS - 1)] = (self.next_gen << STAMP_SHIFT) | slot as u64;
        self.next_gen += 1;
    }

    /// Kill every fast entry (all architectural slots + the identity slot).
    fn restamp_all(&mut self) {
        for slot in 0..=ARCH_SLOTS {
            self.restamp(slot);
        }
    }

    #[inline(always)]
    const fn index(kind: usize, vpn: u64, ctx: u64) -> usize {
        kind * FAST_N + ((vpn ^ (ctx << (FAST_BITS - 4))) as usize & (FAST_N - 1))
    }
}

/// The software TLB. Microarchitectural state — NOT part of the architectural snapshot
/// (E0-T17 reads only PC/xregs). Deterministic, so two identical runs leave identical TLBs.
#[derive(Clone)]
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
    /// The softmmu fast path (see the module docs): a derived cache of `sets`, excluded from
    /// equality because it holds no state of its own.
    fast: FastTlb,
}

/// Equality is over the architectural cache and its counters. The fast TLB is excluded: it is a
/// pure function of the architectural entries it mirrors (plus host-side flush timing), and every
/// hit it serves is already counted in `hits` exactly as a slow-path hit would be.
impl PartialEq for Tlb {
    fn eq(&self, other: &Self) -> bool {
        self.sets == other.sets
            && self.victim == other.victim
            && self.enabled == other.enabled
            && self.hits == other.hits
            && self.misses == other.misses
            && self.flushes == other.flushes
    }
}

impl Eq for Tlb {}

impl Default for Tlb {
    fn default() -> Self {
        Self::new()
    }
}

impl Tlb {
    pub fn new() -> Self {
        Tlb {
            sets: [[Slot::EMPTY; WAYS]; NSETS],
            victim: [0; NSETS],
            enabled: true,
            hits: 0,
            misses: 0,
            flushes: 0,
            fast: FastTlb::new(),
        }
    }

    /// A TLB that never caches (walk every access) — the differential oracle (T17 charter).
    pub fn disabled() -> Self {
        let mut t = Self::new();
        t.enabled = false;
        t
    }

    const fn index(vpn: u64) -> usize {
        (vpn as usize) & (NSETS - 1)
    }

    /// The most page sizes any supported scheme has (Sv57: level 0..=4). A narrower scheme never
    /// fills the top levels, so probing them there simply misses. (Was 4 for Sv48 — one short of
    /// Sv57's level-4 256 TiB superpage, so those leaves never served a hit and re-walked.)
    const LEVELS: u8 = 5;

    /// The superpage-aligned page number: `vpn` with its low `9 * level` bits cleared. A leaf at
    /// `level` is tagged and indexed by this so ANY 4 KiB page inside the superpage finds it.
    const fn align(vpn: u64, level: u8) -> u64 {
        let sh = 9 * level as u32;
        (vpn >> sh) << sh
    }

    /// Look up a cached leaf for `vpn` under `asid` in translation `mode` (8 = Sv39, 9 = Sv48, 10 = Sv57); a
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
                        slot: (set * WAYS + way) as u8,
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
        self.fill_slot(vpn, asid, pte, level, global, mode);
    }

    /// [`Self::fill`], returning the architectural slot written (or [`NO_SLOT`] when disabled).
    /// The written slot is re-stamped, so fast entries mirroring whatever it held before (an
    /// evicted victim) die with it.
    pub(crate) fn fill_slot(
        &mut self,
        vpn: u64,
        asid: u64,
        pte: u64,
        level: u8,
        global: bool,
        mode: u8,
    ) -> u8 {
        if !self.enabled {
            return NO_SLOT;
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
                return self.restamped(set * WAYS + way);
            }
        }
        for way in 0..WAYS {
            if !self.sets[set][way].valid {
                self.sets[set][way] = slot;
                return self.restamped(set * WAYS + way);
            }
        }
        let v = self.victim[set] as usize;
        self.sets[set][v] = slot;
        self.victim[set] = ((v + 1) % WAYS) as u8;
        self.restamped(set * WAYS + v)
    }

    #[inline(always)]
    fn restamped(&mut self, slot: usize) -> u8 {
        self.fast.restamp(slot);
        slot as u8
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
        for (set_index, set) in self.sets.iter_mut().enumerate() {
            for (way, s) in set.iter_mut().enumerate() {
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
                    // Fast entries mirroring the removed entry die with it (exactly those).
                    self.fast.restamp(set_index * WAYS + way);
                }
            }
        }
    }

    // ── softmmu fast path ─────────────────────────────────────────────────────────────────

    /// Drop every fast-TLB entry (the architectural entries are untouched, so this is
    /// semantically invisible — the next access simply refills through the slow path). Required
    /// whenever context the fast tags do not encode changes: a satp write, a snapshot restore, or
    /// any host-side mutation of the hart.
    pub fn fast_flush(&mut self) {
        self.fast.restamp_all();
    }

    /// Turn the softmmu fast path off for good (the fast-path-disabled differential oracle, the
    /// counterpart of [`Tlb::disabled`] one layer up): no fast entry is ever published, so every
    /// access runs the full slow path. Behaviour must be indistinguishable from the default —
    /// the fast-path differential tests assert exactly that.
    pub fn disable_fast_path(&mut self) {
        self.fast.enabled = false;
        self.fast.restamp_all();
    }

    /// Whether the softmmu fast path may publish entries (false only after
    /// [`Self::disable_fast_path`]).
    pub fn fast_path_enabled(&self) -> bool {
        self.fast.enabled
    }

    /// Debug/test observation: how many fast entries are currently live (would hit for their tag
    /// and context under the PMP revision they were published with). Scans the arrays; never
    /// called on the hot path.
    pub fn fast_live_entries(&self) -> usize {
        self.fast
            .entries
            .iter()
            .filter(|e| {
                e.tag != FAST_EMPTY_TAG
                    && self.fast.slot_stamp[(e.stamp & STAMP_SLOT_MASK) as usize] == e.stamp
            })
            .count()
    }

    /// Fast-path probe: the physical address for `va` if a live fast entry of access `kind` in
    /// context `ctx` covers its page and the PMP revision it was validated under is current.
    /// A translated hit counts as an architectural TLB hit (it is one: the mirrored entry is
    /// resident); an identity hit counts nothing, like the slow path.
    #[inline(always)]
    pub(crate) fn fast_lookup(
        &mut self,
        kind: usize,
        va: u64,
        ctx: u64,
        pmp_rev: u64,
    ) -> Option<u64> {
        let vpn = va >> 12;
        let e = self.fast.entries[FastTlb::index(kind, vpn, ctx)];
        if e.tag == (vpn | (ctx << FAST_CTX_SHIFT))
            && self.fast.slot_stamp[(e.stamp & STAMP_SLOT_MASK) as usize] == e.stamp
            && self.fast.pmp_rev == pmp_rev
        {
            self.hits += u64::from((e.stamp & STAMP_SLOT_MASK) < ARCH_SLOTS as u64);
            Some(va.wrapping_add(e.addend))
        } else {
            None
        }
    }

    /// The satp every live fast entry was filled under (debug cross-check for the flush hooks).
    pub(crate) fn fast_satp(&self) -> u64 {
        self.fast.satp
    }

    /// Record a successful slow-path access outcome for `va`'s page. The caller guarantees that
    /// the whole physical page `pa & !0xfff` is RAM and PMP-permits `kind` in the context `ctx`
    /// denotes, and that `slot` is the architectural slot (or [`IDENTITY_SLOT`]) the translation
    /// came from. `satp` / `pmp_rev` are the live values; a mismatch with the values the existing
    /// entries were filled under first drops them all.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn fast_fill(
        &mut self,
        kind: usize,
        va: u64,
        pa: u64,
        ctx: u64,
        slot: u8,
        satp: u64,
        pmp_rev: u64,
    ) {
        if slot == NO_SLOT || !self.fast.enabled {
            return;
        }
        if self.fast.satp != satp || self.fast.pmp_rev != pmp_rev {
            self.fast.restamp_all();
            self.fast.satp = satp;
            self.fast.pmp_rev = pmp_rev;
        }
        let vpn = va >> 12;
        self.fast.entries[FastTlb::index(kind, vpn, ctx)] = FastEntry {
            tag: vpn | (ctx << FAST_CTX_SHIFT),
            addend: (pa & !0xFFF).wrapping_sub(va & !0xFFF),
            stamp: self.fast.slot_stamp[slot as usize & (STAMP_SLOTS - 1)],
        };
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
