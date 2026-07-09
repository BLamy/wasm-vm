---
id: E3-T04
epic: 3
title: Copy-on-write overlay format and BlockBackend trait
priority: 304
status: verified
depends_on: [E3-T01]
estimate: M
capstone: false
---

## Goal
A copy-on-write block overlay: the streamed base image is immutable; all guest writes land
in a local write layer. Reads merge overlay-over-base at block granularity. The overlay's
on-storage format is specified in a design doc, and all persistence backends implement one
`BlockBackend` trait, with an in-memory reference implementation proven by property tests.

## Context
This is the heart of persistence and the seam the whole storage stack hangs on. Design
decisions to make and record: overlay block granularity — guest issues 4 KiB-ish sectors,
base chunks are 128 KiB; writing at fetch-chunk granularity forces read-modify-write of a
whole chunk per small write, writing at 4 KiB keeps writes cheap but multiplies index
entries. Recommend 4 KiB overlay blocks with a dirty index (hash map or two-level bitmap),
justify in the doc. Format needs: version header, base-image binding (manifest hash — an
overlay must refuse to attach to the wrong base), dirty-block index, and a commit/journal
story precise enough that T08 can map virtio-blk flush onto it. Trait shape (async where it
must be): `read_block`, `write_block`, `commit` (durability barrier), `len`, `base_binding`.

## Deliverables
- `docs/design/cow-overlay.md`: format layout, granularity rationale, base-binding rule,
  commit semantics contract (what `commit` guarantees on return), versioning policy.
- `BlockBackend` trait + `OverlayDisk` composition (overlay backend + base `ChunkSource`)
  in the core storage crate.
- `MemBackend` reference implementation.
- Proptest suite: random interleaved read/write/commit sequences against a flat `Vec<u8>`
  model — byte-identical reads required; unaligned and cross-block-boundary I/O covered.

## Acceptance criteria
- [ ] Proptest (≥10^4 cases) passes: `OverlayDisk` over `MemBackend` is observationally
      identical to the flat model, including writes spanning overlay-block boundaries.
- [ ] A read of a never-written block hits the base exactly; a read after a partial-block
      write returns merged content (explicit unit test with a 100-byte write at offset 4090).
- [ ] Attaching an overlay whose recorded base hash mismatches the manifest is a typed
      error before any I/O.
- [ ] Alpine boots read-write on `OverlayDisk` + `MemBackend` (native harness and browser),
      and `touch /root/x` then `ls` works — persistence not required yet.
- [ ] Design doc's commit-semantics section is explicit enough that T08's mapping from
      VIRTIO_BLK_T_FLUSH is a one-line citation, not a new design.

## Adversarial verification
Break the merge logic: fuzz with writes of length 1..3*block at every alignment around block
boundaries, then full-image readback vs. model. Write, read, write the same block 10^4 times
and check no stale base data reappears. Attempt to attach an overlay to a re-chunked (different
chunk size, same content) base — binding must be by manifest hash, so this must fail; if it
attaches, refute. Check the doc against the code: any commit guarantee stated but not
implemented (or vice versa) refutes. `cargo tree` — no browser deps in the core crate.

## Verification log

**2026-07-06 — CoW overlay core (pass 1), PR stacked on #90.**
`crates/storage/src/overlay.rs`: `OverlayBackend` trait (dirty-block read/write, commit barrier,
base_binding, image_len) + `MemOverlay` in-memory reference (sparse BTreeMap of 4 KiB blocks; no_std,
no HashMap) + `OverlayDisk<B>` (merge overlay-over-base per block; atomic read-modify-write of partial
blocks; `NeedChunk` when a base block isn't resident, composing with E3-T02 deferred completion;
`attach` refuses a mismatched base by manifest hash BEFORE any I/O). `ImageManifest::base_hash()` =
SHA-256 of the canonical manifest JSON (folds in chunk_size → a re-chunked base differs).
`docs/design/cow-overlay.md`: format, 4 KiB granularity rationale, base-binding rule, commit contract
(E3-T08 maps VIRTIO_BLK_T_FLUSH → commit in one line), versioning.

Cold-clone critic (fresh context) attacked merge-seam block math, RMW atomicity, the tail-block fast
path, base binding, NeedChunk propagation, range/overflow, and doc-vs-code — wrote 3 throwaway seam
tests the proptest's random distribution rarely hits (block-aligned reads, tail full-cover-then-
partial, blocked-write atomicity). **Verdict SHIP, no bugs**, all doc claims matched.

Acceptance met: [x] ≥10^4-case proptest (10,000) — OverlayDisk over a resident base byte-identical to
a flat Vec model (unaligned + cross-block-boundary + tail). [x] unwritten read hits base exactly; the
100-byte write at offset 4090 merges. [x] mismatched base hash → typed error before I/O (incl. a
re-chunked same-bytes base). [x] commit-semantics doc explicit for T08.

**2026-07-06 — OverlayDisk wired into virtio-blk (pass 2), PR stacked on #91. TASK COMPLETE.**
`ChunkedBackend` now holds `OverlayDisk<MemOverlay>` over the shared `BlockCache` base (replacing the
ad-hoc 512 B sector overlay): read → merge overlay-over-base (WouldBlock on absent base chunk); write
→ 4 KiB-block CoW (partial block read-modify-written; WouldBlock if the block's base chunk isn't
resident); flush → `commit`. `blk.rs` T_OUT arm parks writes on WouldBlock, symmetric to reads — safe
because `OverlayDisk::write` is atomic on NeedChunk (mutates nothing), so re-executing a parked write
never double-applies/tears. Synchronous backends (MemBackend/FileBackend) never WouldBlock → the
busybox/whole-disk boot paths are unchanged.

Cold-clone critic **SHIP, no bugs** — hand-traced parked-write across boundaries + wrote a throwaway
core test proving exactly-once apply+push (now a permanent regression test:
`lazy_write_parks_then_applies_exactly_once`). Verified: write atomicity (blocked write mutates
nothing), exactly-once apply+push, write-park→fetch→complete liveness (awaited chunk surfaced via
pending_blk_chunks), read-path + synchronous-backend non-regression, borrow safety, capacity/attach.

**ACCEPTANCE MET (browser, Playwright, 12.1 min, 1 passed):** unmodified Alpine boots READ-WRITE on
the CoW OverlayDisk IN THE BROWSER (base = lazily-fetched chunks; writes = 4 KiB overlay); a guest
write round-trips — `touch /root/cowfile && ls` shows it, `echo … > cowfile && cat` reads the written
bytes back through the overlay merge, no console errors.

Gates: core virtio_blk 11/0 (+ write-park regression), wasm ChunkedBackend 6/0, storage 37/0 (10^4
proptest), workspace clippy --all-features + fmt + determinism + wasm builds (default + zicsr-stub) +
node --check; `cargo tree -p wasm-vm-storage` has no browser deps. **E3-T04 DONE** — all acceptance
criteria met across PR #91 (core) + the pass-2 wiring PR. Follow-on: durable overlay persistence to
IndexedDB/OPFS (a later task implementing OverlayBackend); E3-T08 maps VIRTIO_BLK_T_FLUSH → commit.
