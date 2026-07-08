---
id: E3-T12
epic: 3
title: Full machine snapshot and restore with instant-resume boot
priority: 322
status: pending
depends_on: [E3-T08]
estimate: L
capstone: false
---

## Goal
The entire machine — CPU registers/CSRs, RAM, CLINT/PLIC/UART/virtio device state, and the
overlay reference — serializes to a versioned snapshot format and restores to an
instruction-exact continuation. A snapshot taken at the post-boot login prompt becomes the
instant-resume path: page load → restore → usable shell in a fraction of cold-boot time.

## Context
**DEFERRED 2026-07-06 (Brett): container workloads (Epic 3.5 → `wvrun postgres`) take priority.**
Snapshot/restore is valuable but not on the database critical path; priority 312 → 322 so the
OCI cluster (E3.5-T01..T05) leads. E3-T24 (loading UX) still depends on this — unaffected.

webvm's perceived speed is largely resume-not-boot. Requirements: a `Snapshot` visitor over
every stateful component (hart state incl. all CSRs and pending interrupt lines; RAM with
zero-page elision or simple RLE — a 256 MB guest RAM must not become a 256 MB blob when
mostly zero; virtqueue states: descriptor table addresses, avail/used indices, in-flight
request set must be empty or drained before snapshotting — quiesce the device first).
Format: header {magic, format version, core-crate git hash, base-image manifest hash},
then sectioned TLV so unknown sections can fail loudly. A snapshot is only valid against
the same base image *and* an overlay state consistent with it — snapshot must embed the
overlay's commit generation and refuse restore on mismatch (else guest page cache and disk
disagree → silent corruption). Store snapshots in OPFS; also support export/import as a
file (foundation for Level 6 shareable states). Restore path must work in both native
harness and browser.

## Deliverables
- `Snapshot`/`Restore` trait implemented by CPU, RAM, CLINT, PLIC, UART, virtio-blk (+net
  later); device quiesce (drain in-flight I/O, drop cache pins) before serialize.
- Versioned container format + `docs/design/snapshot-format.md`.
- Overlay-generation binding: commit counter persisted by T08's backend, checked on restore.
- UI: "save snapshot" control; boot path: if a valid resume snapshot exists, restore
  instead of cold boot (fall back to cold boot on any validation failure).
- Native determinism test: run N instructions, snapshot, run M more recording a trace;
  restore, run M, diff traces — must be identical.

## Acceptance criteria
- [ ] Native snapshot/restore trace-diff test passes (byte-identical instruction traces
      post-restore, including timer interrupt timing).
- [ ] In-browser: snapshot at login prompt, reload tab, resume → shell responds; wall-clock
      resume-to-usable < 3 s on a dev machine (record the number).
- [ ] Restore against a mismatched base image hash or stale overlay generation is refused
      with a typed error and falls back to cold boot — demonstrated by test.
- [ ] Mostly-idle 256 MB RAM snapshot is < 15% of RAM size on disk (zero elision works).
- [ ] `sync` in the guest, snapshot, reload, restore, then `fsck.ext4 -n` from a second
      mount path (or guest self-check) is clean — no disk/page-cache divergence.

## Adversarial verification
Attack determinism and the disk/RAM coherence seam. Take a snapshot *while* a guest `cp` is
mid-flight — either the quiesce drains it (verify in-flight set empty in the blob) or the
snapshot is refused; a restored machine that replays or loses a completed-but-unflushed
write refutes. Restore the same snapshot twice into two sessions (sequentially) and diff
guest-visible state. Hand-flip a version byte and a section length in the blob — restore
must fail cleanly, never OOB-read (fuzz the parser with random truncations). Write in the
guest *after* snapshotting, reload, resume from the older snapshot: define and verify the
documented behavior (overlay generation mismatch → refuse); if it silently resumes over the
newer disk, that is the corruption case — refute.

## Verification log

### Pass 1 — resume-snapshot format + zero-elision codec, native core (PR #153, stacked on #152)
**Delivered:** `crates/core/src/resume.rs` — the versioned, sectioned (TLV) container the whole-machine
snapshot serializes into, the coherence guards, and the RAM zero-elision codec. Pure `no_std` + alloc
(builds for wasm32). Distinct from `crate::snapshot` (the E0-T17 state digest). The per-component
`Snapshot`/`Restore` visitors (CPU/RAM/devices) + the determinism trace-diff are the integration pass
(need the running machine — boot-adjacent). Header = `magic | format_version | core_hash |
base_image_hash | overlay_generation`, then TLV sections; `SectionReader` bounds-checks every length
and fails loudly on an unknown section tag. `SnapshotHeader::validate_for` refuses a snapshot from a
different build / base image / stale overlay generation (typed error → caller cold-boots).
`encode_sparse`/`decode_sparse` collapse zero runs so a mostly-idle 256 MiB RAM doesn't serialize to
256 MiB.

**Native-core-now split (off the postgres critical path, but the highest-value headless queue task —
the OCI/postgres path is boot/browser-blocked):** closes the LOGIC behind acceptance **#3 (mismatch
refusal)** + **#4 (zero elision, <15%)** + the format/parser fuzz-safety foundation. Deferred:
component visitor + determinism trace-diff (#1), browser resume (#2), fsck coherence (#5).

**A real DoS the pre-critic fuzz caught:** the 20k-iteration `decode_sparse` fuzz HUNG the machine —
the decoder resized the output for a `CHUNK_ZERO` run *before* bounding its length, so a hostile
zero-chunk claiming ~4 GiB forced an unbounded allocation. Fixed: bound the run against `expected_len`
before growing.

**Local gate:** clippy (both `--lib` and `--all-targets` after the CI catch) + fmt clean; full core
lib suite 117 passed; 14 resume tests (0.03s). **CI #153 green** (after fixing a `clippy::useless_vec`
that `-D warnings` rejected — lesson: run `--all-targets` locally, not just `--lib`).

**Adversarial cold-clone critic** (reviewed `origin/task/e35-t04b..HEAD`): **REFUTED — 1 MAJOR
test-gap; production code correct — FIX-FIRST.** Parser/codec held (no panic/OOB/unbounded-alloc/hang,
sound round-trip over 2000+ fuzz iters; `SectionReader` `checked_add`-bounded, terminates on
zero-length streams, latches `done` after error). But the DoS-fix regression test was **vacuous**:
removing the pre-allocation bound *survived* because both it and the trailing `out.len()!=expected_len`
check returned the same `BadSparseEncoding` (critic measured 17.86s / ~4 GiB under the mutant, suite
still green). **Fixed:** gave the bound a **distinct** `SparseRunExceedsTotal` variant so it's
observable (deleting the guard now changes the returned variant → the test fails). Other 3 mutants
(bound `<=`→`<`, overlay-gen guard, DATA-slice off-by-one) all caught.

**Next passes (boot/browser-gated):** the `Snapshot`/`Restore` component visitors over CPU/RAM/CLINT/
PLIC/UART/virtio (with device quiesce) + the native determinism trace-diff (#1); browser OPFS resume
(#2); the `sync`→snapshot→reload→`fsck` coherence proof (#5).
