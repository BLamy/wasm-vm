//! E3-T03: a memory-bounded block cache between the guest and the chunk source. Fetched chunks live
//! here under a byte budget; when an insert would exceed it, the CLOCK (second-chance) policy evicts.
//!
//! **Why CLOCK** (not full LRU/ARC): it approximates LRU with a single per-entry reference bit and no
//! timestamps — which matters here because `crates/storage` is `no_std` and on the determinism gate
//! (no clock, no rand, no HashMap). A referenced entry survives one hand pass, an unreferenced one is
//! evicted; that is enough to keep the boot working set warm without gold-plating.
//!
//! **Pinning**: a chunk with an in-flight guest read (a parked virtio-blk completion, E3-T02) must
//! never be evicted mid-flight, or the guest would read freed/replaced bytes. `pin`/`unpin` count
//! outstanding holds; a pinned entry is skipped by the evictor. If EVERY resident entry is pinned the
//! cache is allowed to exceed budget rather than corrupt an in-flight read — a bounded, documented
//! overshoot (there can only be as many pins as concurrently-awaited chunks).

use crate::ChunkSource;
use alloc::collections::BTreeMap;
use alloc::vec::Vec;
use core::cell::Cell;

/// Cache counters exposed for the E3-T03 metrics (over the wasm boundary). `hits`/`misses` are
/// per-`get`; `evictions`/`inserts` are structural; `bytes_resident` is the live total.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheMetrics {
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
    pub inserts: u64,
    pub bytes_resident: u64,
}

struct Entry {
    bytes: Vec<u8>,
    /// CLOCK reference bit — set on every `get`, cleared when the hand passes (second chance).
    referenced: Cell<bool>,
    /// Outstanding pins (in-flight guest reads). Non-zero ⇒ never evicted.
    pins: u32,
}

/// A byte-budgeted CLOCK cache of chunk bytes. `get` is `&self` (interior-mutable ref bit + hit/miss
/// counters) so it satisfies [`ChunkSource`]; `insert`/`pin`/`unpin`/`set_budget` are `&mut self`.
pub struct BlockCache {
    budget_bytes: u64,
    resident_bytes: u64,
    entries: BTreeMap<usize, Entry>,
    /// CLOCK ring of resident chunk keys, in insertion order; `hand` sweeps it.
    ring: Vec<usize>,
    hand: usize,
    hits: Cell<u64>,
    misses: Cell<u64>,
    evictions: u64,
    inserts: u64,
}

impl BlockCache {
    /// A cache holding at most ~`budget_bytes` of chunk data (a single chunk larger than the budget is
    /// still admitted — the cache must be able to serve any one chunk — so residency can transiently
    /// exceed the budget by at most one oversized chunk, or by the pinned set).
    pub fn new(budget_bytes: u64) -> BlockCache {
        BlockCache {
            budget_bytes,
            resident_bytes: 0,
            entries: BTreeMap::new(),
            ring: Vec::new(),
            hand: 0,
            hits: Cell::new(0),
            misses: Cell::new(0),
            evictions: 0,
            inserts: 0,
        }
    }

    /// Look up `chunk`, marking it referenced (CLOCK second chance) and counting a hit/miss.
    pub fn lookup(&self, chunk: usize) -> Option<&[u8]> {
        match self.entries.get(&chunk) {
            Some(e) => {
                e.referenced.set(true);
                self.hits.set(self.hits.get() + 1);
                Some(&e.bytes)
            }
            None => {
                self.misses.set(self.misses.get() + 1);
                None
            }
        }
    }

    /// Insert (or replace) `chunk`'s bytes, evicting unpinned entries first so residency stays within
    /// budget where possible. A freshly inserted chunk starts referenced (recently used).
    pub fn insert(&mut self, chunk: usize, bytes: Vec<u8>) {
        if self.entries.contains_key(&chunk) {
            // Replace in place; keep its ring position and pins, refresh bytes + reference bit.
            let (old, new) = {
                let e = self.entries.get_mut(&chunk).expect("just checked contains");
                let old = e.bytes.len() as u64;
                let new = bytes.len() as u64;
                e.bytes = bytes;
                e.referenced.set(true);
                (old, new)
            };
            self.resident_bytes = self.resident_bytes - old + new;
            // A GROWING replace must still honour the budget (critic F1) — evict other entries to fit,
            // pinning the just-written chunk across the sweep so it can't self-evict. A same-size
            // replace (the norm: fixed-size chunks, byte-identical re-fetch) skips this entirely.
            if new > old {
                self.pin(chunk);
                while self.resident_bytes > self.budget_bytes {
                    if self.evict_one().is_none() {
                        break;
                    }
                }
                self.unpin(chunk);
            }
            return;
        }
        let need = bytes.len() as u64;
        while self.resident_bytes + need > self.budget_bytes {
            // Stop if nothing evictable remains (all pinned, or empty) — bounded documented overshoot.
            if self.evict_one().is_none() {
                break;
            }
        }
        self.ring.push(chunk);
        self.resident_bytes += need;
        self.inserts += 1;
        self.entries.insert(
            chunk,
            Entry {
                bytes,
                referenced: Cell::new(true),
                pins: 0,
            },
        );
    }

    /// Evict one unpinned entry via CLOCK, returning its key. `None` if every resident entry is pinned
    /// (or the cache is empty). Referenced entries get one reprieve (bit cleared); the sweep is bounded
    /// to two full passes, so after clearing every ref bit a second pass is guaranteed to find a victim
    /// (unless all are pinned) — no infinite loop.
    fn evict_one(&mut self) -> Option<usize> {
        if self.ring.is_empty() {
            return None;
        }
        let cap = self.ring.len() * 2 + 1;
        let mut steps = 0;
        loop {
            if steps > cap {
                return None; // every remaining entry is pinned
            }
            steps += 1;
            if self.hand >= self.ring.len() {
                self.hand = 0;
            }
            let key = self.ring[self.hand];
            let e = self
                .entries
                .get(&key)
                .expect("ring and entries stay consistent");
            if e.pins > 0 {
                self.hand += 1;
                continue;
            }
            if e.referenced.get() {
                e.referenced.set(false);
                self.hand += 1;
                continue;
            }
            // Victim: drop it. `ring.remove` shifts the tail left, so `hand` already points at the
            // next entry (or past the end, wrapped next iteration).
            let freed = e.bytes.len() as u64;
            self.entries.remove(&key);
            self.ring.remove(self.hand);
            self.resident_bytes -= freed;
            self.evictions += 1;
            return Some(key);
        }
    }

    /// Pin `chunk` against eviction (an in-flight guest read). No-op if not resident. Balance every
    /// `pin` with an `unpin` once the read completes.
    pub fn pin(&mut self, chunk: usize) {
        if let Some(e) = self.entries.get_mut(&chunk) {
            e.pins = e.pins.saturating_add(1);
        }
    }

    /// Release one pin on `chunk` (saturating at 0). No-op if not resident.
    pub fn unpin(&mut self, chunk: usize) {
        if let Some(e) = self.entries.get_mut(&chunk) {
            e.pins = e.pins.saturating_sub(1);
        }
    }

    /// Change the byte budget, immediately evicting unpinned entries down to it where possible.
    pub fn set_budget(&mut self, budget_bytes: u64) {
        self.budget_bytes = budget_bytes;
        while self.resident_bytes > self.budget_bytes {
            if self.evict_one().is_none() {
                break;
            }
        }
    }

    /// Whether `chunk` is resident.
    pub fn contains(&self, chunk: usize) -> bool {
        self.entries.contains_key(&chunk)
    }

    /// Live resident byte total.
    pub fn resident_bytes(&self) -> u64 {
        self.resident_bytes
    }

    /// The configured byte budget.
    pub fn budget_bytes(&self) -> u64 {
        self.budget_bytes
    }

    /// A snapshot of the counters.
    pub fn metrics(&self) -> CacheMetrics {
        CacheMetrics {
            hits: self.hits.get(),
            misses: self.misses.get(),
            evictions: self.evictions,
            inserts: self.inserts,
            bytes_resident: self.resident_bytes,
        }
    }
}

impl ChunkSource for BlockCache {
    fn get(&self, chunk: usize) -> Option<&[u8]> {
        self.lookup(chunk)
    }
}

#[cfg(test)]
mod tests;
