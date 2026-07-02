---
id: E3-T12
epic: 3
title: Full machine snapshot and restore with instant-resume boot
priority: 312
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
(empty)
