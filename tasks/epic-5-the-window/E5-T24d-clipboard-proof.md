---
id: E5-T24d
epic: 5
title: Prove bidirectional clipboard sync in the browser and guest
priority: 524.4
status: verified
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

### 2026-09-04 — verifier — VERDICT: verified

- P1 bidirectional bytes and first-paste ordering — HELD. Predicted the first focused paste would synchronously enqueue the exact text before `key-ready`, and that guest→host writes would preserve 3-byte, CRLF/UTF-8, and exact-256-KiB values. Observed `channel-send` before `key-ready`, `noStaleFirstPaste: true`, and every round trip marked `exact: true` at [`evidence/e5-t24d/clipboard-proof-2026-09-04.json:20`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t24d/clipboard-proof-2026-09-04.json:20).
- P2 hostile echo, permission, and privacy behavior — HELD. Predicted 100 immediate copy/echo pairs would emit exactly one frame per action, identical direction changes would remain distinguishable, a denied write would stage without background retries, and an unfocused paste would perform zero clipboard-data reads. Observed `immediateCopies: 100`, `suppressedEchoes: 101`, `identicalDirectionChangeAccepted: true`, one attempt before gesture, recovery after gesture, and `clipboardDataReads: 0` at [`evidence/e5-t24d/clipboard-proof-2026-09-04.json:85`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t24d/clipboard-proof-2026-09-04.json:85).
- P3 guest recovery and two-tab isolation — HELD. Predicted the native child-death/reset tests would pass with bounded recovery and that each browser tab would have one listener set, no pending request, no clipboard reads, and an independently suppressed echo. Observed the six required guest tests with exit code 0, `childRecovery: true`, `queueIsolation: true`, and the second-tab isolation record at [`evidence/e5-t24d/clipboard-proof-2026-09-04.json:137`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t24d/clipboard-proof-2026-09-04.json:137).
- P4 exact head, deployment parity, and coverage — SUFFICIENT. The replay ran `make verify-E5-T24d` at final head `86c074e1d986ec6df855d4266e99222f58558198`; the final standalone proof rerun at that same head recorded zero console/page errors, matching source/dist hashes, and the checked-in screenshot/transcript. Runtime proof code, Makefile target, docs, roadmap source/dist line, task metadata, and evidence were each executed, statically checked, or intentionally declarative; no changed runtime hunk was left unexplained. Evidence SHA-256: `cea90c85edb6e2a627cc25feb1276f7fd871a0647667c9e3045046705ab304d1`.
