---
id: E3-T12c4
epic: 3
title: Boot-level snapshot disk coherence (sync/snapshot/restore → fsck clean)
priority: 321.934
status: pending
depends_on: [E3-T12c1, E3-T12c2, E3-T12c3]
estimate: S
risk: high
capstone: false
---

## Goal
The end-to-end integration proof: a real Alpine boot that `sync`s, snapshots, restores, continues, and
powers off leaves the ext4 root `fsck.ext4 -n` clean, with no replayed or lost completed request —
demonstrating the c1 (device serialization) + c2 (quiesce) + c3 (overlay coherence) pieces compose into
a coherent whole-machine snapshot across the disk.

## Context
This is the boot-gated leaf of the E3-T12c split — it needs a native CLI Alpine boot + `fsck.ext4`,
which the mac's browser path can't sustain but `ssh dev` runs natively (~18 min, as E2-T19/E2-T24
proved). A native integration test (`crates/cli/tests/…`) boots the released kernel+rootfs, drives a
login + `sync`, takes a `save_resume` snapshot, restores it into a fresh machine, drives another
command, powers off, and the harness runs `fsck.ext4 -n` on the resulting image.

## Deliverables
- A native, `#[ignore]`d boot integration test: boot → login → `sync` → snapshot → restore → command →
  poweroff, then external `fsck.ext4 -n` on the image.
- Recorded evidence (transcript + fsck output) run on `ssh dev`.

## Acceptance criteria
- [ ] Boot → `sync` → snapshot → restore → continue → poweroff, then `fsck.ext4 -n` on the ext4 root is
  clean (recorded on dev).
- [ ] A completed request issued before the snapshot is neither replayed nor lost after restore (an
  echo-proof marker written pre-snapshot is present, exactly once, post-restore).
- [ ] The restored machine boots to a usable shell and executes a fresh guest-computed command.

## Adversarial verification
Snapshot mid-`sync` and immediately after; restore and diff the disk against a straight-through boot;
run the fsck on a deliberately torn snapshot (quiesce disabled) and confirm it is dirty (non-vacuity of
the clean result). Any disk divergence, duplicated completion, or dirty fsck on the quiesced path
refutes.

## Verification log
(empty)
