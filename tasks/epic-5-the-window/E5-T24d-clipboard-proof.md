---
id: E5-T24d
epic: 5
title: Prove bidirectional clipboard sync in the browser and guest
priority: 524.4
status: in-progress
depends_on: [E5-T24b, E5-T24c]
estimate: S
risk: high
capstone: false
---

## Goal

Freeze the end-to-end clipboard claim with exact native/browser evidence and document the permission
matrix and operational policy.

## Boundary

This slice owns only the final proof harness, browser fixtures, hostile ordering/permission runs,
`docs/clipboard.md`, roadmap evidence, and checked-in evidence. It may not redesign the protocol,
guest bridge, or host clipboard service.

## Deliverables

- Chromium proof of guest→host and host→guest round trips, first-try ordering, 3-byte/256 KiB/257
  KiB behavior, 20-copy loop suppression, and denied-permission staging.
- Native/guest helper proof of child recovery, queue isolation, exact source/dist hashes, and
  machine-readable results at one exact head.
- `docs/clipboard.md` with browser permission matrix, focus/privacy rules, UTF-8/size policy, and
  Firefox/manual caveats; verified roadmap capability.

## Acceptance criteria

- [ ] Both clipboard directions pass in Chromium with no stale first paste, no uncaught errors, and
      exact UTF-8/CRLF bytes at the documented size boundaries.
- [ ] The 100-iteration ordering attack, pathological identical-string alternation, permission
      denial/staging, child kill/recovery, and focus/privacy spy all produce machine-readable held
      results.
- [ ] The proof command passes at one exact head with zero unexplained changed hunks, checked-in
      `docs/clipboard.md`, screenshot/transcript, and source/dist hashes.

## Verification command

`node tools/verify/e5-t24d-clipboard-proof.mjs`

## Adversarial verification

Repeat immediate paste 100x, alternate identical content with direction changes, kill the guest
watcher mid-stream, deny permission, remove focus, inject invalid UTF-8/binary data, and compare
two simultaneous tabs for listeners, pending requests, clipboard reads, and echo counters.

## Verification log

(empty)
