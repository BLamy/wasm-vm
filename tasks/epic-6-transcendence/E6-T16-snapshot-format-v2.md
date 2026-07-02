---
id: E6-T16
epic: 6
title: Snapshot format v2 — versioning, zstd compression, integrity, v1 migration
priority: 616
status: pending
depends_on: [E5]
estimate: M
capstone: false
---

## Goal
A versioned, compressed, integrity-checked snapshot container replacing Epic 3's v1
format — designed for the sharing and cloud-sync tasks that follow: chunked for ranged
fetch, self-describing enough to migrate forward, and honest about compatibility.

## Context
v1 (Epic 3) was a working-format: uncompressed, implicitly versioned by code revision.
v2 container: magic `WVM2`, format version u32, then a section table (TOC) of
{kind, flags, offset, compressed_len, uncompressed_len, blake3}. Sections: machine
manifest (n_harts, RAM size, device list with *per-device state version numbers* — SMP
and GPU state from this epic are new sections); per-hart architectural state; RAM as
2 MiB chunks, zero-chunks elided via a bitmap, each chunk independently compressed
(enables ranged/lazy fetch in E6-T18); device states; a disk-overlay *reference*
(content hash + size), never inline disk data. Compression: zstd — evaluate pure-Rust
`ruzstd` (its encoder is young; benchmark and fuzz it) since `zstd-sys` doesn't build
for wasm32-unknown-unknown; if the encoder isn't trustworthy, fall back to
`miniz_oxide` DEFLATE and record the decision + ratio delta. Unknown-section policy: a
`required` flag bit decides skip-vs-refuse, which is what makes minor versions additive.

## Deliverables
- `snapshot/v2.rs`: writer + reader with the container above; property-tested
  round-trip (arbitrary machine states → save → load → bit-identical state compare
  using the Epic 1 state-serialization test machinery).
- Per-section and whole-file BLAKE3 verification on load; corrupt sections produce a
  named error (section kind + offset), never a silently wrong machine.
- `tools/snap-migrate`: v1 → v2 converter, plus transparent on-load migration with a
  one-time console notice; v1 loading remains supported for two release cycles
  (documented policy in `docs/snapshot-format.md`).
- Format spec document: byte-level layout, section kinds registry, version/compat
  policy (major = breaking, minor = additive-with-required-flag).
- Compression decision record with measured ratios and encode/decode throughput for an
  idle-Alpine RAM image, native and wasm32.

## Acceptance criteria
- [ ] Save/boot-restore round-trip at smp=4 with GPU and 9p devices active resumes to a
      running system: an in-guest `sha256sum` job started pre-snapshot completes
      post-restore with the correct hash.
- [ ] Idle Alpine (256 MB RAM) v2 snapshot ≤ 25% of v1 size; encode < 10 s, decode
      < 5 s in-browser on the documented reference machine.
- [ ] Every v1 snapshot in the test corpus migrates and boots; a v2 file with an
      unknown optional section loads; with an unknown *required* section it refuses
      with a clear error naming the section.
- [ ] Flipping any single bit in a snapshot (fuzz harness iterates over regions: TOC,
      chunk data, trailer) is always detected at load — zero silent acceptances across
      10^4 mutations.
- [ ] Round-trip property test (1,000 randomized states) passes native and wasm32.

## Adversarial verification
Attack the reader as hostile input (this format arrives from URLs in E6-T18): cargo-fuzz
the TOC and section parsers — overlapping sections, offsets past EOF, compressed_len
lying about uncompressed_len (a 4 GB-from-1 KB decompression bomb must be rejected by a
hard size cap before allocation), duplicate kinds; any panic, OOM, or over-allocation
refutes. Attack migration: migrate a v1 snapshot produced by the *oldest* Epic 3 commit
that emitted one (not a fresh v1 from current code) — divergence between
v1-as-documented and v1-as-shipped refutes. Attack cross-version honesty: save v2, bump
a device's state version in code, reload — the reader must refuse or migrate per the
documented policy, not load garbage. Verify the ≤25% size claim on a *dirty* system
(post-upgrade, hot caches), not just idle — a claim that only holds idle refutes as
stated.

## Verification log
(empty)
