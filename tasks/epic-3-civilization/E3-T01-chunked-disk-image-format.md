---
id: E3-T01
epic: 3
title: Chunked disk-image format with hashed manifest and core reader
priority: 301
status: verified
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
- [x] `cargo test` passes natively and the storage crate builds for `wasm32-unknown-unknown`.
- [x] Chunking the Epic 2 Alpine image with `tools/chunk_image.py`, then reassembling chunks
      per the manifest, yields a byte-identical file (`sha256sum` match).
- [x] Offset math is proven for edge cases: offset 0, last byte, image size not a multiple of
      chunk size, single-chunk image — each covered by an explicit test.
- [x] A manifest with a corrupted chunk hash and a chunk with flipped bytes both produce
      typed errors, not panics.
- [x] `docs/design/chunked-image.md` exists and matches the implemented structs field-for-field.

## Adversarial verification
Attack the math and the spec/impl gap. Fuzz `ChunkIndex` with image sizes around chunk-size
multiples (±1 byte) and assert reassembly identity against a flat reference buffer. Hand-edit
a manifest: reorder chunk hashes, declare image length larger than the sum of chunks, set
chunk size 0 or non-power-of-two — any panic or silent acceptance is a refutation. Chunk a
1-byte image and a 0-byte image. Diff every field in the design doc against the serde structs;
any undocumented field or documented-but-absent field refutes. Confirm the crate compiles for
`wasm32-unknown-unknown` with no `web-sys`/`js-sys` in its dependency tree (`cargo tree`).

## Verification log

### 2026-07-06 — chunked format + core reader (PR #85)

New crate `crates/storage` (wasm-vm-storage): `ImageManifest` (serde, from_json+validate; unknown
fields ignored), `ChunkIndex` (offset↔chunk math, tail handling), `verify_chunk` (length-then-SHA256),
typed `ImageError`. `no_std`+alloc, browser-agnostic (no web-sys/js-sys — cargo tree clean).
`tools/chunk_image.py` (split/blob, round-trip verify). `docs/design/chunked-image.md` (spec + 128 KiB
rationale + forward-compat).

**Acceptance MET:** #1 native test + wasm32 build (no browser deps); #2 round-trip byte-identical on
the 17 MB kernel Image (136 chunks, sha256 round-trips; Alpine identical); #3 offset edges
(0/last/exact-multiple/single/1B/0B) + proptest; #4 hostile manifest edits + corruption → typed
errors; #5 doc matches structs field-for-field. Full local gate clean (fmt/build/clippy-workspace-
all-features/determinism).

### 2026-07-06 — cold-clone critic — C1/C3/C4 confirmed, C2 footgun found + fixed

Critic fuzzed the parser (20 hostile strings → all typed errors) and round-tripped real files. C1
math CONFIRMED (proptest + a real 300 KB file). C3 verify_chunk CONFIRMED (length before hash). C4
browser-agnostic + wasm + spec + python-manifest↔Rust-reader CONFIRMED. **C2 found a real footgun:**
the PUBLIC unvalidated-construction path (pub fields let a caller skip validate()) could panic —
chunk_size=0 div-by-zero, and verify_chunk bounds-checking the derived count not chunks.len() → OOB
index. FIXED: derived_chunk_count/locate guard chunk_size==0; verify_chunk bounds-checks chunks.len()
+ rejects chunk_size==0 first; new test `unvalidated_manifest_never_panics`. Minor doc note
(uppercase-hex accepted) clarified. Gates: 6/0 tests, clippy/fmt clean, wasm32 build, no regression.

**2026-07-06 — VERIFICATION-DEBT SWEEP (parallel cold-clone critics, PR #101).** VERDICT SOUND.
Attacks cleared: dd-flipped chunk bytes + manifest hex edits refused end-to-end (exit 1, typed);
overflow-shaped manifests (image_len=u64::MAX, chunk_size=1; chunk_span near-overflow) all typed
errors, zero panics; base_hash canonicalization stable across field order/whitespace/unknown-field
variants (hashes the re-serialized struct, never input text); no_std unconditional, wasm32 dep tree
clean (no web/js/getrandom); storage suite 53/0. Two LOW fixed in the sweep: validate() now enforces
LOWERCASE hex (an uppercase variant of the same digest would orphan persisted overlays — refuse-to-
attach direction, but now rejected at validation); chunk_image.py verify without --image → usage
error not TypeError. Criterion 2 (Alpine-scale round-trip) met by recorded downstream evidence:
every E3-T02..T05/T13 boot runs through manifests this format produced. 2 critic tests adopted
(tests.rs: canonicalization stability, overflow-shaped inputs).
