---
id: E3-T21b2a
epic: 3
title: Crash-safe guest file-agent storage engine
priority: 321.221
status: pending
depends_on: [E3-T21b1]
estimate: S
risk: high
capstone: false
---

## Goal
Implement the filesystem transaction boundary used by the guest WVFT peer without coupling it to
cross-compilation, init scripts, or a boot image.

## Deliverables
- Fixed pre-opened inbox/outbox roots with normalized basename, no-follow, regular-file,
  link-count, and no-replacement checks.
- Streaming partial writes, incremental hash validation, quota/concurrency/timeout enforcement,
  commit records, atomic promotion, directory fsync, interruption outcomes, and startup recovery.
- A source handle that detects mutation/link changes before and after streaming.

## Acceptance criteria
- [ ] A focused native filesystem-model test covers 0 and 100 MiB transfers, every hostile protocol
  name, symlink and hard-link attacks, quota, two concurrent transfers plus a third rejection,
  source mutation, and bounded memory.
- [ ] Deterministic kill-point tests cover every transition before/after rename and directory fsync;
  recovery never exposes incomplete or unvalidated bytes as complete.
- [ ] The storage API contains no absolute-path, URL, command, listener, or destination capability.

## Adversarial verification
Race final-name and link replacement, exhaust quota/concurrency, corrupt every commit-record field,
kill at each visibility/durability boundary, and mutate the held download descriptor. Any
out-of-root access, incomplete final name, false COMPLETE, or unbounded buffering refutes.

## Verification log
(empty)
