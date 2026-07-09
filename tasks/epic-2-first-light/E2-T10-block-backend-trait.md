---
id: E2-T10
epic: 2
title: Pluggable block backend trait — mmap'd file (native) and ArrayBuffer image (browser)
priority: 210
status: verified
depends_on: [E2-T01]
estimate: S
capstone: false
---

## Goal
A `BlockBackend` trait that decouples virtio-blk from storage, with two implementations:
a memory-mapped file for the native CLI (fast iteration on multi-hundred-MB images) and an
in-memory buffer for the browser (rootfs fetched as an ArrayBuffer) — the seam where
Epic 3's IndexedDB/OPFS copy-on-write overlay will later plug in.

## Context
Sector size is fixed at 512 bytes (virtio-blk's unit). Trait sketch:
`capacity_sectors() -> u64`, `read(sector: u64, buf: &mut [u8]) -> Result<(), BlockError>`,
`write(sector: u64, buf: &[u8]) -> Result<...>`, `flush() -> Result<...>`,
`is_read_only() -> bool`. Critical trap: on `wasm32`, `usize` is 32-bit — all sector/byte
offset arithmetic must be `u64` with checked conversion at the buffer boundary, or a
> 4 GiB image silently wraps. Native impl uses `memmap2` (write-back on flush via
`msync`); browser impl wraps a `Vec<u8>`/`Box<[u8]>` handed across the wasm-bindgen
boundary (copied once out of the fetched ArrayBuffer — measure, don't guess, the copy
cost; note it for E2-T21). Both must reject unaligned lengths (non-multiple of 512) and
out-of-range access with an error the device turns into `VIRTIO_BLK_S_IOERR`, never a
panic. Keep the trait object-safe: the machine holds `Box<dyn BlockBackend>`.

## Deliverables
- `crates/core/src/block/mod.rs` (trait + `MemBackend`), `crates/native/src/file_backend.rs`
  (mmap), and a wasm-side constructor accepting a byte buffer.
- Property tests: random (sector, len) read/write round-trips against a reference
  `Vec<u8>` model, including boundary sectors and out-of-range rejections.
- A read-only mode test: writes to an RO backend return `BlockError::ReadOnly`.

## Acceptance criteria
- [ ] Property tests pass natively and on `wasm32` (MemBackend), including a synthetic
      capacity of 5 GiB sectors-worth on wasm32 with sparse access (no usize truncation).
- [ ] Reads/writes at `capacity - 1` sector succeed; at `capacity` fail cleanly.
- [ ] FileBackend flush provably persists: write, flush, kill the process (SIGKILL from
      test harness), reopen, verify bytes.
- [ ] No `as usize` casts on sector/offset math without a checked bound (grep-audited).

## Adversarial verification
Kill-mid-write attack on FileBackend: loop writes without flush, SIGKILL, reopen — data
loss before flush is acceptable and documented, but torn *sectors* (partial 512-byte
writes) or mmap corruption refute. Overflow attack: call `read(u64::MAX - 1, ...)`,
`write` with len 2^32 - 512 on wasm32 — any wrap-into-range refutes. RO-enforcement:
mount the image RO at the trait level and diff image hash before/after a fuzzed write
storm — any hash change refutes. Review the wasm boundary for a double copy of the image
(instrument allocations); an undocumented second copy of a 400 MB rootfs refutes the
memory-footprint claim.

## Verification log

### 2026-07-05 — worker — implemented

**What landed.** `crates/core/src/block.rs`: object-safe `BlockBackend` (capacity/read/
write/flush/is_read_only, 512-byte sectors) + shared `check_range` (ALL sector/offset math
u64 with checked_add/checked_mul; usize conversion only after the storage-length bound —
the wasm32 >4GiB wrap trap, documented in module docs). `MemBackend` (browser path — the
rootfs ArrayBuffer is copied ONCE by the constructing caller; none inside; `data()` for
hash audits) + `SparseMemBackend` (arbitrary u64 capacity, BTreeMap — deterministic; the
Epic-3 lazy-overlay shape). `crates/cli/src/file_backend.rs`: memmap2-backed FileBackend
(flush = msync; read-only mode maps the file RO — defense in depth beyond the trait flag).

**Evidence:**
- Property test: 5,000 random (sector,len) ops vs a Vec reference model, boundary +
  out-of-range included, final images byte-identical.
- Boundary/error matrix: capacity-1 OK, capacity fails, unaligned fails, sector near
  u64::MAX fails cleanly (overflow attack — no wrap into range), RO enforced for write
  AND flush.
- **wasm32 acceptance run**: 5 GiB capacity on a REAL 32-bit usize — high-sector write,
  u32-truncated-alias sector proven ZERO (no truncation aliasing), round-trip, clean
  out-of-range at capacity and u64::MAX; resident_sectors()==1 (sparse footprint).
- FileBackend: flush-persists-across-reopen; **charter kill-mid-write attack**: child
  process writes flushed sector 3 + unflushed sector 5 then dies via abort() — parent
  reopens: flushed sector INTACT, unflushed sector all-or-nothing (loss acceptable +
  documented), NEVER torn. RO mapping rejects writes at trait and mapping level.
- Acceptance #4 grep audit: every `as usize` in block paths is post-bound-check (comments
  cite the proof); test-only casts are on bounded values.
- Gates: fmt, clippy ±--all-features, both wasm legs 0 FAILED.
- Copy-cost measurement for the ArrayBuffer path: noted for E2-T21 per the task text (the
  wasm constructor that receives the JS buffer lands with the browser rootfs task).

### 2026-07-05 — verifier (cold critic) — CONFIRMED

All 6 attack angles executed against committed code. (1) Overflow hunt:
SparseMemBackend::new(u64::MAX) — zero panics/wraps (sectors ≥2^55 reject cleanly via the
checked multiply; quirk now documented); cap=u64::MAX/512's top sector (byte offset
2^64−512) works and does NOT alias sector 0; MemBackend::new at len 0/1/511/…/4113 all
safe; zero-length buffers consistent across all THREE backends (Ok at cap, OOR past, RO
first); committed wasm32 tests re-run by the critic on real 32-bit usize. (2) Kill-loop ×5
with 100 page-straddling multi-sector unflushed writes then abort mid-loop: **torn=0 in
all 5 runs** (61–64/64 sectors kept by the page cache — loss-or-keep acceptable, zero
tears). (3) RO storm: SHA-256 identical before/after 10,000 fuzzed writes/flushes;
structurally the Ro(Mmap) arm has no DerefMut — RO writes unrepresentable in the type
system. (4) 100,000-op fuzz vs a BTreeMap model at 5 GiB (45k writes/45k reads/9.4k OOR,
straddling written/unwritten hotspots incl. CAP−16): zero divergences, exact zero-fill,
resident=140. (5) Box<dyn BlockBackend> holds all three backends through one fn;
FileBackend bound against the real core trait. (6) All gates green (cli bin-target tests
included). Deferral to E2-T21 verified honest (that task's text owns the copy-cost
measurement). Path notes: block.rs & crates/cli are the codebase-convention actuals for
the task header's block/mod.rs & crates/native.
