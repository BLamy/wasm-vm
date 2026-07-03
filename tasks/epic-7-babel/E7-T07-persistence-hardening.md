---
id: E7-T07
epic: 7
title: Persistence hardening at desktop scale — large COW overlays, durable fsync
priority: 707
status: pending
depends_on: [E6]
estimate: M
capstone: false
---

## Goal
Scale the Epic 3 copy-on-write persistence from "a script survives reload" to **a desktop's
working set survives**: multi-gigabyte overlays, many small writes from GUI apps and the
x86_64 library cache, and durable `fsync` semantics under a heavier, longer-lived session —
without blowing storage quota or corrupting on an abrupt tab close.

## Context
Builds on E3-T04/T05/T08 (COW overlay, IndexedDB/OPFS backends, flush→commit durability) and
E6-T15 (OPFS shared folder). Desktop use changes the profile: larger overlays, higher write
rates, longer sessions, and box64's x86_64 lib/cache directories. Stress the backend for
write amplification and commit latency, tighten the quota-management and reset-disk paths
(E3-T10) for big overlays, and verify crash-consistency at scale (kill mid-write, reopen,
fsck clean). Decide compaction/GC policy for overlays that grow unbounded.

## Deliverables
- A large-overlay stress harness (sustained writes to GB scale) with commit-latency and
  write-amplification numbers in a ledger.
- Overlay compaction/GC policy + implementation, documented, with a before/after size test.
- Crash-consistency test at scale: kill during heavy write, reopen, `fsck.ext4 -f -n` clean.

## Acceptance criteria
- [ ] A session writing a multi-GB working set persists across reload; data intact
      (checksummed before/after), storage stays within quota or surfaces E3-T10's dialog.
- [ ] After an abrupt tab kill mid-write, reopen is crash-consistent (fsck clean, no
      half-committed overlay), verified repeatedly.

## Adversarial verification
Fill the overlay toward quota during a heavy write and confirm graceful handling (dialog or
clean stop), never silent corruption. Kill the tab at randomized points during sustained
writes 50+ times; every reopen must be consistent. Verify the compaction/GC actually reclaims
space (measure) and never drops committed data (checksum a large corpus across a compaction
cycle). Confirm `fsync` from the guest maps to a real backend commit under load (a delayed or
dropped commit that fsck later flags refutes durability).

## Verification log
(empty)
