---
id: E3-T01
epic: 3
title: Chunked disk-image format with hashed manifest and core reader
priority: 301
status: pending
depends_on: [E2]
estimate: M
capstone: false
---

## Goal
A specified, versioned chunked disk-image format — fixed-size blocks, a JSON manifest with
per-chunk SHA-256 hashes — plus the core Rust types that parse the manifest, map guest byte
offsets to chunk indices, and verify chunk integrity. This replaces Epic 2's monolithic
image download as the base layer for streaming, caching, and copy-on-write.

## Context
webvm streams its disk lazily; we cannot ship a 400+ MB ext4 image as one fetch. Everything
in Epic 3 storage (T02 lazy fetch, T03 cache, T04 overlay, T11 pipeline) builds on this
format. Key decisions to make and record: chunk size (start at 128 KiB, power of two,
declared in the manifest — measure before changing); layout `split` (one immutable file per
chunk, content-addressed filename `chunks/{sha256}.bin`, CDN/cache friendly) and layout
`blob` (single file addressed via HTTP Range) both representable; manifest carries format
version, image byte length, chunk size, ordered chunk hash list. Core crate stays
browser-agnostic: no fetch here, only pure types + math.

## Deliverables
- `docs/design/chunked-image.md`: format spec, worked example, rationale for chunk size and
  both layouts, forward-compat rules (unknown manifest fields ignored; version bump policy).
- `ImageManifest` (serde) + `ChunkIndex` types in the core storage crate: offset→(chunk,
  intra-chunk offset) math, tail-chunk (short last chunk) handling, SHA-256 verification
  (`sha2`), typed errors for hash mismatch / truncated chunk / version mismatch.
- `tools/chunk_image.py` (dev-grade): split an existing ext4 image into chunks + manifest,
  used by tests and by T02 until the T11 pipeline lands.
- Native unit tests incl. proptest: chunk math round-trips for random image sizes.

## Acceptance criteria
- [ ] `cargo test` passes natively and the storage crate builds for `wasm32-unknown-unknown`.
- [ ] Chunking the Epic 2 Alpine image with `tools/chunk_image.py`, then reassembling chunks
      per the manifest, yields a byte-identical file (`sha256sum` match).
- [ ] Offset math is proven for edge cases: offset 0, last byte, image size not a multiple of
      chunk size, single-chunk image — each covered by an explicit test.
- [ ] A manifest with a corrupted chunk hash and a chunk with flipped bytes both produce
      typed errors, not panics.
- [ ] `docs/design/chunked-image.md` exists and matches the implemented structs field-for-field.

## Adversarial verification
Attack the math and the spec/impl gap. Fuzz `ChunkIndex` with image sizes around chunk-size
multiples (±1 byte) and assert reassembly identity against a flat reference buffer. Hand-edit
a manifest: reorder chunk hashes, declare image length larger than the sum of chunks, set
chunk size 0 or non-power-of-two — any panic or silent acceptance is a refutation. Chunk a
1-byte image and a 0-byte image. Diff every field in the design doc against the serde structs;
any undocumented field or documented-but-absent field refutes. Confirm the crate compiles for
`wasm32-unknown-unknown` with no `web-sys`/`js-sys` in its dependency tree (`cargo tree`).

## Verification log
(empty)
