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
//! - **Set-associative, deterministic replacement**: a fixed [`TLB_SETS`] x [`TLB_WAYS`] array,
//!   with per-set round-robin victim selection. No HashMap — no hashing or iteration-order
//!   nondeterminism, so replacement is bit-identical native vs wasm32 (T22).
//! - The **level tag** records the leaf level (0/1/2 → 4 KiB/2 MiB/1 GiB) so a superpage entry
//!   serves its whole range. A level-`l` entry is indexed by its OWN page number (`vpn >> 9*l`),
//!   so superpages spread over every set. (They used to be indexed by the superpage-aligned VPN,
//!   whose low bits are all zero, so every 2 MiB / 1 GiB entry landed in set 0 and a kernel's
//!   linear-map superpages thrashed 4 ways: ~26 walks per 1k instructions booting Alpine.) The
//!   **G (global) bit** is honored by SFENCE.VMA scoping: global entries survive ASID-targeted
//!   fences.
//! - **Probe cost**: a lookup probes level 0 up (unchanged order), but skips every page size that
//!   holds no valid entry (per-level live counts) and compares one packed key per way. A
//!   VA-targeted SFENCE.VMA scans only the sets that VA can occupy (one per live level); only the
//!   ASID-wide and global forms scan the whole array.
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
/// Architectural TLB sets (a power of two). Geometry is microarchitectural: it changes only which
/// entries are resident (walk counts, and what a guest that skips SFENCE.VMA may still see), never
/// a correctly-fenced translation. Public so tests can build same-set conflict patterns.
pub const TLB_SETS: usize = 256;
/// Architectural TLB ways per set.
pub const TLB_WAYS: usize = 4;
const NSETS: usize = TLB_SETS;
const WAYS: usize = TLB_WAYS;
/// Page sizes any supported scheme has (Sv57: level 0..=4).
const LEVEL_COUNT: usize = 5;

/// One architectural entry. Every exact-match field of a lookup is packed into `key` (see
/// [`probe_key`]); an invalid slot's key is 0, which no probe key equals.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Slot {
    /// `probe_key(vpn, level, mode)`: the level-aligned VPN (masked to [`VPN_MASK`]), the leaf
    /// level (0 → 4 KiB, 1 → 2 MiB, 2 → 1 GiB, 3 → 512 GiB, 4 → 256 TiB), the satp MODE the entry
    /// was walked under (8 = Sv39, 9 = Sv48, 10 = Sv57 — a lookup requires a mode match, so a mode
    /// switch without SFENCE.VMA (T18) never serves a cross-mode stale hit) and a valid bit.
    key: u64,
    asid: u64,
    /// The leaf PTE the walk validated (permission + PPN + A/D/G bits).
    pte: u64,
    global: bool,
}

/// Packed probe key: level-aligned VPN in bits 0-44, level in 45-47, MODE in 48-51, valid in 63.
const fn probe_key(aligned_vpn: u64, level: u8, mode: u8) -> u64 {
    aligned_vpn | (level as u64) << 45 | (mode as u64 & 0xF) << 48 | 1 << 63
}

impl Slot {
    const EMPTY: Slot = Slot {
        key: 0,
        asid: 0,
        pte: 0,
        global: false,
    };
    const fn valid(&self) -> bool {
        self.key != 0
    }
    const fn vpn(&self) -> u64 {
        self.key & VPN_MASK
    }
    const fn level(&self) -> u8 {
        ((self.key >> 45) & 0x7) as u8
    }
}

/// A cached leaf translation returned by [`Tlb::lookup`] — the walker's memory result, which
/// the caller re-validates (permission + Svade) against live CSR state before use.
#[derive(Clone, Copy)]
pub struct Hit {
    pub pte: u64,
    pub level: u8,
    /// The architectural slot (`set * WAYS + way`) that served the hit — the fast TLB's stamp key.
    pub(crate) slot: u16,
}

/// Number of architectural slots (`NSETS * WAYS`).
const ARCH_SLOTS: usize = NSETS * WAYS;
/// Stamp key for identity translations (Bare satp or an M-mode effective access): no
/// architectural entry backs them, so only [`Tlb::fast_flush`] re-stamps this slot.
pub(crate) const IDENTITY_SLOT: u16 = ARCH_SLOTS as u16;
/// "No slot": the architectural TLB did not retain the translation (the disabled oracle), so no
/// fast entry may be derived from it.
pub(crate) const NO_SLOT: u16 = u16::MAX;
/// Stamp table size: the architectural slots plus [`IDENTITY_SLOT`], rounded up to a power of two
/// so a masked index needs no bounds check.
const STAMP_SLOTS: usize = (ARCH_SLOTS + 1).next_power_of_two();
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
    /// while its recorded stamp equals its slot's current stamp. Inline (16 KiB), so a hit reaches
    /// it at a fixed offset from the TLB without another pointer load.
    slot_stamp: [u64; STAMP_SLOTS],
    /// Next stamp generation. 53 bits of generations never wrap in practice, so a stamp is never
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
        let slot_stamp: [u64; STAMP_SLOTS] = core::array::from_fn(|i| i as u64); // generation 0
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
    /// Boxed: 32 KiB of entries would otherwise make every `Hart` move copy them.
    sets: alloc::boxed::Box<[[Slot; WAYS]; NSETS]>,
    /// Per-set round-robin next-victim index (deterministic replacement).
    victim: alloc::boxed::Box<[u8; NSETS]>,
    /// Valid entries per leaf level, so a lookup (or a VA-targeted fence) skips page sizes that
    /// hold nothing — on Sv39 Linux that is every level above the kernel's superpages. Derived
    /// from `sets`, kept in step by [`Tlb::write_slot`].
    level_live: [u16; LEVEL_COUNT],
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
        let sets: alloc::boxed::Box<[[Slot; WAYS]]> =
            alloc::vec![[Slot::EMPTY; WAYS]; NSETS].into_boxed_slice();
        let Ok(sets) = sets.try_into() else {
            unreachable!("TLB allocation has the exact set count")
        };
        let victim: alloc::boxed::Box<[u8]> = alloc::vec![0u8; NSETS].into_boxed_slice();
        let Ok(victim) = victim.try_into() else {
            unreachable!("TLB victim allocation has the exact set count")
        };
        Tlb {
            sets,
            victim,
            level_live: [0; LEVEL_COUNT],
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

    /// The set a level-`level` entry covering `vpn` lives in: the low bits of its own page number
    /// (`vpn >> 9*level`), so consecutive superpages of any size spread over every set.
    const fn index(vpn: u64, level: u8) -> usize {
        ((vpn >> (9 * level as u32)) as usize) & (NSETS - 1)
    }

    /// The most page sizes any supported scheme has (Sv57: level 0..=4). A narrower scheme never
    /// fills the top levels, so probing them there simply misses. (Was 4 for Sv48 — one short of
    /// Sv57's level-4 256 TiB superpage, so those leaves never served a hit and re-walked.)
    const LEVELS: u8 = LEVEL_COUNT as u8;

    /// The superpage-aligned page number: `vpn` with its low `9 * level` bits cleared. A leaf at
    /// `level` is tagged by this so ANY 4 KiB page inside the superpage finds it.
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
        // Level 0 up, way 0 up, first match wins. A level holding no valid entry cannot match, so
        // it is skipped.
        for level in 0..Self::LEVELS {
            if self.level_live[level as usize] == 0 {
                continue;
            }
            let want = probe_key(Self::align(vpn, level), level, mode);
            let set = Self::index(vpn, level);
            for (way, s) in self.sets[set].iter().enumerate() {
                if s.key == want && (s.global || s.asid == asid) {
                    self.hits += 1;
                    return Some(Hit {
                        pte: s.pte,
                        level,
                        slot: (set * WAYS + way) as u16,
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
    ) -> u16 {
        if !self.enabled {
            return NO_SLOT;
        }
        let vpn = vpn & VPN_MASK;
        let set = Self::index(vpn, level);
        let slot = Slot {
            key: probe_key(Self::align(vpn, level), level, mode),
            asid,
            pte,
            global,
        };
        for way in 0..WAYS {
            let s = self.sets[set][way];
            if s.key == slot.key && s.asid == asid && s.global == global {
                return self.write_slot(set, way, slot);
            }
        }
        for way in 0..WAYS {
            if !self.sets[set][way].valid() {
                return self.write_slot(set, way, slot);
            }
        }
        let v = self.victim[set] as usize;
        self.victim[set] = ((v + 1) % WAYS) as u8;
        self.write_slot(set, v, slot)
    }

    /// Write `slot` into `(set, way)`, keeping the per-level live counts in step, and re-stamp it
    /// so every fast entry mirroring the previous contents dies. Returns the slot number.
    #[inline(always)]
    fn write_slot(&mut self, set: usize, way: usize, slot: Slot) -> u16 {
        let old = self.sets[set][way];
        if old.valid() {
            self.level_live[old.level() as usize] -= 1;
        }
        if slot.valid() {
            self.level_live[slot.level() as usize] += 1;
        }
        self.sets[set][way] = slot;
        let n = set * WAYS + way;
        self.fast.restamp(n);
        n as u16
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
        match va {
            Some(va) => {
                // An entry covering `va` at level l can only live in `index(vpn, l)`, so scanning
                // those sets (one per live level) removes exactly what a whole-array scan would.
                let q = (va >> 12) & VPN_MASK;
                for level in 0..Self::LEVELS {
                    if self.level_live[level as usize] == 0 {
                        continue;
                    }
                    let set = Self::index(q, level);
                    for way in 0..WAYS {
                        self.sfence_slot(set, way, Some(q), asid);
                    }
                }
            }
            None => {
                for set in 0..NSETS {
                    for way in 0..WAYS {
                        self.sfence_slot(set, way, None, asid);
                    }
                }
            }
        }
    }

    /// Apply one SFENCE.VMA scope to one slot, removing it when both the VA and ASID scopes match.
    #[inline(always)]
    fn sfence_slot(&mut self, set: usize, way: usize, qvpn: Option<u64>, asid: Option<u64>) {
        let s = self.sets[set][way];
        if !s.valid() {
            return;
        }
        let va_match = qvpn.is_none_or(|q| Self::align(q, s.level()) == s.vpn());
        let asid_match = match asid {
            None => true,                        // all ASIDs, including global
            Some(a) => !s.global && s.asid == a, // targeted ASID; global exempt
        };
        if va_match && asid_match {
            // Fast entries mirroring the removed entry die with it (exactly those).
            self.write_slot(set, way, Slot::EMPTY);
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
        slot: u16,
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

#[cfg(test)]
mod probe_tests {
    use super::*;

    /// The unoptimized lookup: probe EVERY level 0..LEVELS and every way over the authoritative
    /// `sets` (no live-level skipping), first full-predicate match wins. Read-only.
    fn reference_lookup(t: &Tlb, vpn: u64, asid: u64, mode: u8) -> Option<(u64, u8, u16)> {
        let vpn = vpn & VPN_MASK;
        for level in 0..Tlb::LEVELS {
            let tag = Tlb::align(vpn, level);
            for (set, ways) in t.sets.iter().enumerate() {
                for (way, s) in ways.iter().enumerate() {
                    if s.valid()
                        && s.level() == level
                        && s.vpn() == tag
                        && ((s.key >> 48) & 0xF) as u8 == mode
                        && (s.global || s.asid == asid)
                    {
                        return Some((s.pte, level, (set * WAYS + way) as u16));
                    }
                }
            }
        }
        None
    }

    /// The unoptimized SFENCE.VMA: scan every slot of the array with the architectural predicate.
    fn reference_sfence(t: &mut Tlb, va: Option<u64>, asid: Option<u64>) {
        t.flushes += 1;
        let qvpn = va.map(|v| (v >> 12) & VPN_MASK);
        for set in 0..NSETS {
            for way in 0..WAYS {
                t.sfence_slot(set, way, qvpn, asid);
            }
        }
    }

    fn recount_levels(t: &Tlb) -> [u16; LEVEL_COUNT] {
        let mut n = [0u16; LEVEL_COUNT];
        for s in t.sets.iter().flatten().filter(|s| s.valid()) {
            n[s.level() as usize] += 1;
        }
        n
    }

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    /// A small VPN pool that collides heavily: a few superpage numbers congruent mod NSETS, 4 KiB
    /// pages inside and outside them, and sign-extended (kernel-half) VPNs.
    fn pool_vpn(r: &mut Rng) -> u64 {
        let set_stride = NSETS as u64;
        let base = match r.below(4) {
            0 => r.below(8) * set_stride,               // 4 KiB pages sharing set 0
            1 => (r.below(6) * set_stride) << 9,        // 2 MiB superpage numbers sharing a set
            2 => ((r.below(3) * set_stride) << 18) | 5, // 1 GiB region, odd offset
            _ => VPN_MASK - r.below(4096),              // kernel-half (sign-extended) pages
        };
        (base + r.below(3)) & VPN_MASK
    }

    /// The optimized lookup (live-level skip + per-level set index + packed key) and the
    /// VA-targeted SFENCE.VMA are exact: over a colliding random stream, lookups agree with the
    /// whole-array reference, targeted fences leave exactly the state a whole-array scan leaves,
    /// and the per-level live counts always equal a recount.
    #[test]
    fn optimized_probe_and_targeted_fence_match_whole_array_reference() {
        for seed in [1u64, 0x5eed, 0xdead_beef, 77] {
            let mut r = Rng(seed);
            let mut t = Tlb::new();
            let mut hits = 0u64;
            for step in 0..20_000 {
                match r.below(10) {
                    0..=3 => {
                        let vpn = pool_vpn(&mut r);
                        let level = [0u8, 0, 1, 1, 2, 3, 4][r.below(7) as usize];
                        let asid = r.below(3);
                        let mode = [8u8, 9, 10][r.below(3) as usize];
                        let global = r.below(4) == 0;
                        let pte = r.next();
                        t.fill(vpn, asid, pte, level, global, mode);
                    }
                    4..=7 => {
                        let vpn = pool_vpn(&mut r);
                        let asid = r.below(3);
                        let mode = [8u8, 9, 10][r.below(3) as usize];
                        let want = reference_lookup(&t, vpn, asid, mode);
                        let got = t.lookup(vpn, asid, mode).map(|h| (h.pte, h.level, h.slot));
                        assert_eq!(got, want, "seed {seed} step {step}: lookup {vpn:#x}");
                        hits += u64::from(got.is_some());
                    }
                    _ => {
                        let va = (r.below(2) == 0).then(|| pool_vpn(&mut r) << 12 | r.below(4096));
                        let asid = (r.below(2) == 0).then(|| r.below(3));
                        let mut reference = t.clone();
                        reference_sfence(&mut reference, va, asid);
                        t.sfence(va, asid);
                        assert!(t.sets == reference.sets, "seed {seed} step {step}: sfence");
                        assert_eq!(t.flushes, reference.flushes);
                    }
                }
                assert_eq!(t.level_live, recount_levels(&t), "seed {seed} step {step}");
            }
            assert!(hits > 500, "the stream must actually hit (got {hits})");
        }
    }

    /// Superpages of every level spread over the sets instead of all landing in one set.
    #[test]
    fn consecutive_superpages_use_distinct_sets() {
        for level in 1..Tlb::LEVELS {
            let sets: alloc::collections::BTreeSet<usize> = (0..NSETS as u64)
                .map(|n| Tlb::index(n << (9 * level as u32), level))
                .collect();
            assert_eq!(sets.len(), NSETS, "level {level}");
        }
    }
}
