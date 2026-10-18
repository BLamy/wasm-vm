---
id: E9-T06
epic: 9
title: Add the local saved-session library and checkpoint controls
priority: 524.906
status: implemented
depends_on: [E9-T05]
estimate: S
risk: medium
capstone: false
---

## Goal

Let a user find, name and reopen real locally stored session checkpoints.

## Boundary

The session library UI over the actual store: list, rename, start recording, checkpoint, stop and open. Display duration, storage usage, build/image identity and compatibility state; label previews and exact restore points separately.

## Acceptance criteria

- [ ] Two saved sessions remain visible after reload; renaming and opening one selects its actual stored checkpoint and matching guest state.
- [ ] Show capturing, restoring, incomplete, incompatible and storage-error states, with keyboard-accessible controls and responsive layouts.
- [ ] Existing sessions with no event log offer checkpoint restoration only; recording does not fabricate history from before it was enabled.

## Deterministic acceptance

`make verify-E9-T06`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Try an incompatible saved build, rapid selection changes and keyboard-only operation. The displayed selected session must agree with the active machine, not an old preview.

## Verification log

### 2026-10-18 — worker — implemented

Frozen implementation: `b97f739cdb161cb16f7d64ca983fb48fea80df76`.
Command: `E9_LIBRARY_EVIDENCE_DIR=target/evidence/e9-t06-worker-final make verify-E9-T06`.
All **8** medium-risk gates passed: frontend syntax, existing worker-protocol tests,
affected browser build, execution-contract and retained-runtime checks, and recorded
actual-browser acceptance. Native code, durable store semantics and dependencies are
unchanged; this slice adds the frontend composition over the verified T05 APIs.
Runtime remains `c404e41c43d7912f5ae2886848724d018b515cc5d1a668a15105ba3f54b232bc`.

Original receipt: `target/evidence/e9-t06-worker-final/report.json`, SHA-256
`7fffff71f600b025104b7969092b417cb96a9453c3ab760d0a7f63c14359f07d`.
It binds **16** source files and **553** payload files. The compact packet
`evidence/e9-t06/worker/` contains **19** copies plus **5** exact-byte aliases and
provenance authenticating all **554** originals including the receipt. Full browser
trace/profile and all raw gzip tuples remain at the original paths; selected complete
frames, screenshots, coverage and gate logs are retained in the packet.

The recording creates two distinct saved sessions from nonoverlapping recording windows
of a real Alpine guest, with different shell memory and `/root/e9-library/state` files.
Both survive page reload and renaming. Keyboard Open selects an older explicit Alpha
point and the final Beta point, installs each paused with **zero retired instructions**,
and preserves the entire stored tuple byte for byte. Alpha SHA-256
`599fd981f229ea7c99600f274f6ae16873b940352ffd64e74f748abf7f96e73b`; Beta
`08af608a97fd4f7b8f6e193d4c7bb2c3e50e635659910cfbc2250822d9ff7bd0`. After explicit Resume, actual guest commands read
`alpha-memory/alpha-queued` with `alpha-file`, then `beta-memory/beta-queued` with
`beta-file`. Preview races, an incompatible runtime, a missing durable object, refused
label writes and malformed-label recovery leave saved checkpoints intact. Paused IDE
commands return `GUEST_PAUSED` without appending UART bytes. Recording publishes only
explicit checkpoints with an empty event log and no fabricated pre-recording history.

Built demo: **127 passed, 0 failed**, zero console errors, library roadmap pip verified.
Desktop and 390px mobile controls fit without horizontal overflow. The retained factory
GPU is qualified, neither lost nor poisoned, and physically draws at fresh epoch 4 after
**2,999,712** retired instructions. The source tree is clean after the frozen
acceptance. Independent verification and Cloudflare/public evidence remain pending;
this is the worker claim, not a verified task.


### 2026-10-18 — worker — reply to coverage sufficiency finding

The fresh reviewer authenticated the original worker receipt, all 553 payloads,
16 sources and 19 copies/5 aliases, then found that Playwright's final V8 export
retained only the last document despite `resetOnNavigation: false`. The recorded
state/trace checks are not refuted; earlier action-method coverage is missing.

Only the browser recorder changes: seal coverage before every reload/navigation,
restart before navigating so module initialization is included, retain each document
segment, and aggregate all entries at shutdown. A missing final segment now fails
the recording. `node --check tools/verify/e9-session-library-browser.mjs` passes.
The upcoming public recording repeats the same acceptance cases and supplies this
missing coverage; no product code, native semantics, dependencies or immutable
runtime bytes changed, so the existing successful gates/state proofs carry forward.
The independent reviewer continues its copied-profile disappearance case. Public
proof and final verdict remain pending; this entry does not claim the gap is closed.
