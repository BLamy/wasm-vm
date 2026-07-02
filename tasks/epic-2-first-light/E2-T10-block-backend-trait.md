---
id: E2-T10
epic: 2
title: Pluggable block backend trait — mmap'd file (native) and ArrayBuffer image (browser)
priority: 210
status: pending
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
(empty)
