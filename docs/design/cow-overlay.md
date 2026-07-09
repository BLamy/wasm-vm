# Copy-on-write block overlay (E3-T04)

The streamed base image (the E3-T01 chunked, hash-verified disk) is **immutable**. Every guest
write lands in a local **write overlay**; reads merge the overlay over the base at block
granularity. This is the seam the whole persistence story hangs on: the same `OverlayBackend`
trait is implemented in-memory today (`MemOverlay`) and by durable browser stores (IndexedDB/OPFS)
later, with no change to the merge logic in `OverlayDisk`.

Code: `crates/storage/src/overlay.rs`. This crate is `no_std` + browser-agnostic (`cargo tree` has
no `web-sys`/`js-sys`); the durable backends live in `crates/wasm`.

## Block granularity — 4 KiB, justified

The guest issues small (512 B–4 KiB) virtio-blk requests; the base is fetched in 128 KiB chunks.
The overlay block size is the unit at which a write dirties the overlay:

- **At the 128 KiB fetch-chunk granularity**, any 512 B write would force a read-modify-write of a
  whole 128 KiB chunk (fetch it if absent, patch 512 B, store 128 KiB). Write amplification ≈ 256×.
- **At 4 KiB** (the guest page / typical filesystem block), a 4 KiB-aligned write dirties exactly one
  block with no base read at all; only a *partial* 4 KiB write needs an RMW, and only of 4 KiB.

We choose **`OVERLAY_BLOCK = 4096`**. The cost is more index entries than a coarse granularity, but
the dirty index is a **sparse `BTreeMap<block_index → [u8; 4096]>`** — ordered (deterministic, no
`HashMap`, `no_std`) and sized to the *written* set, not the image. (A two-level bitmap was
considered; the map is simpler and the constant factor is irrelevant at boot-write volumes.)

## On-storage format

An overlay is a small header plus the dirty-block store:

```
header {
  magic:        "wvov"                     // wasm-vm overlay
  version:      u32  = OVERLAY_FORMAT_VERSION (1)  // bump only on incompatible change
  image_len:    u64                        // total logical length (== base image_len)
  block_size:   u32  = 4096
  base_binding: [u8; 32]                   // ImageManifest::base_hash() of the base it belongs to
}
blocks: sparse { block_index: u64 → bytes: [block_size] }   // only written blocks are stored
```

The in-memory `MemOverlay` holds exactly this (minus serialization); a durable backend serializes the
header once and each dirty block as it is written. The tail block (when `image_len` is not a multiple
of `block_size`) stores a full `block_size` array; bytes past `image_len` are **unspecified padding
and are never read** (`OverlayDisk` clamps every access to `image_len`).

## Base binding — an overlay refuses the wrong base

`base_binding` is `ImageManifest::base_hash()` = SHA-256 of the canonical manifest JSON, which folds
in the version, length, **chunk size**, layout, and every chunk hash. `OverlayDisk::attach(overlay,
manifest)` compares it to `manifest.base_hash()` and returns `OverlayError::BaseMismatch` **before any
I/O** on a mismatch.

Consequence (and an explicit adversarial test): a base **re-chunked at a different `chunk_size` but
with identical bytes** hashes differently, so an overlay built against the old geometry cannot silently
attach to the new one — a stale block index would otherwise map to the wrong offsets. Binding is by
manifest identity, not by content length. This is a **collision-resistant correctness binding, not a
security/auth boundary.**

## Read / write semantics

- **read(base, offset, len)** — walks `[offset, offset+len)` block by block. For each touched block:
  a dirty overlay block supplies its bytes; otherwise the bytes come from the base via
  `ChunkIndex::read` over the supplied `ChunkSource`. If a needed base block is not yet resident the
  read returns `OverlayOutcome::NeedChunk(c)` (the base is lazily streamed — E3-T02 deferred
  completion); the caller fetches chunk `c` and retries. Byte-exact merge, partial blocks included.
- **write(base, offset, data)** — copies each affected block into the overlay. A block **fully
  covered** by the write is stored directly (no base read). A **partially** covered block is
  read-modify-written: its current contents (dirty overlay block, else base bytes) are materialized,
  the written bytes patched in, and the full block stored. If a base block needed for a partial RMW is
  not resident, the write returns `NeedChunk(c)` **having mutated nothing** — a blocked write is atomic,
  so a retry cannot double-apply or tear.

## Commit semantics (contract) — the T08 citation

`OverlayBackend::commit()` (exposed as `OverlayDisk::commit`) is the **durability barrier**:

> **On `Ok(())` return from `commit`, every `write_block` issued before the `commit` call is durably
> persisted to the backing store. Writes issued after the `commit` call are not covered. `commit`
> changes no observable content — a read is identical immediately before and after.**

For `MemOverlay`, session memory is already "durable" for the session's lifetime, so `commit` is a
no-op that trivially satisfies the contract. For a durable backend, `commit` must not return `Ok`
until the store has acknowledged the writes (e.g. an IndexedDB transaction `oncomplete`).

**E3-T08 mapping (one line, not a new design):** `VIRTIO_BLK_T_FLUSH` → `OverlayDisk::commit()`; the
device completes the flush request's status only after `commit` returns `Ok`.

## Versioning policy

`OVERLAY_FORMAT_VERSION` starts at **1**. Unknown/incompatible versions are a hard error on attach
(never a silent reinterpretation). A durable backend that finds a newer version than it understands
must refuse rather than guess. The base-image format is versioned separately (`FORMAT_VERSION` in the
manifest); an overlay is additionally pinned to a specific base by `base_binding`.
