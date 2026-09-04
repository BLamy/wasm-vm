---
id: E5-T24d
epic: 5
title: Prove bidirectional clipboard sync in the browser and guest
priority: 524.4
status: implemented
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

- [x] Both clipboard directions pass in Chromium with no stale first paste, no uncaught errors, and
      exact UTF-8/CRLF bytes at the documented size boundaries.
- [x] The 100-iteration ordering attack, pathological identical-string alternation, permission
      denial/staging, child kill/recovery, and focus/privacy spy all produce machine-readable held
      results.
- [x] The proof command passes at one exact head with zero unexplained changed hunks, checked-in
      `docs/clipboard.md`, screenshot/transcript, and source/dist hashes.

## Verification command

`node tools/verify/e5-t24d-clipboard-proof.mjs`

## Adversarial verification

Repeat immediate paste 100x, alternate identical content with direction changes, kill the guest
watcher mid-stream, deny permission, remove focus, inject invalid UTF-8/binary data, and compare
two simultaneous tabs for listeners, pending requests, clipboard reads, and echo counters.

## Verification log

### 2026-09-04 — worker — implementation submitted

- Commit: `92b44ec` (`feat(e5-t24d): add clipboard proof harness`).
- Exact evidence: [`evidence/e5-t24d/clipboard-proof-2026-09-04.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t24d/clipboard-proof-2026-09-04.json), SHA-256 `ae34d435a73f855824df02627e348bbe5800cd8addd7288eaffae3976a13973d`; transcript [`evidence/e5-t24d/clipboard-proof-2026-09-04.txt`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t24d/clipboard-proof-2026-09-04.txt); screenshot [`evidence/e5-t24d/clipboard-proof-browser.png`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t24d/clipboard-proof-browser.png).
- Commands: `node --check tools/verify/e5-t24d-clipboard-proof.mjs`; `node --test web/tests/clipboard-service.test.mjs`; `node tools/verify/e5-t24d-clipboard-proof.mjs`; `make web-dist`.
- Claim: at exact head `92b44ec6ed88e211385d0282b54e1dfff0fa2037`, the Chromium fixture proved guest→host writes and host→guest frame bytes for 3-byte, CRLF/UTF-8, and exact-256-KiB values; first-send/key ordering; 100 immediate copy/echo pairs; identical direction changes and reconnect history invalidation; permission denial/staging; unfocused privacy; invalid/257-KiB rejection; idempotent listeners; and isolated second-tab state with zero console/page errors. The same recording ran the guest protocol tests covering helper child recovery, bounded I/O, queue/reset isolation, malformed payloads, and serial safety. Source/dist hashes matched for `agent-channel.js` and `clipboard-service.js`. Independent machines and WebKit are waived per the user instruction.
