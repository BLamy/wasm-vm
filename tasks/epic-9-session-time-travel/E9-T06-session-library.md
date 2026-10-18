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

### 2026-10-18 — worker — sealed public full run before mobile-error repair

At clean source `7e5d5d1fcd83fe2f2dbce1656108f57db30f9581`, ran
`node tools/verify/e9-session-library-browser.mjs --url https://wasm-vm.pages.dev/ --output target/evidence/e9-t06-public-final`.
Deployment `https://7c5c2fe5.wasm-vm.pages.dev` serves the unchanged product bundle
prepared at `f09eb4c9`; the later head changes the navigation recorder and log only.
The successful deployment log and the earlier transfer-timeout/rejected fallback-upload
attempt are retained separately in `evidence/e9-t06/public/`. No artifact hashes changed.

The public report SHA-256 is
`2d441f7fa17fcebeef82d4db2273a120fbe497a1d56b9c9a59378d434cb232a8`.
All 19 public assets match the committed build, the live suite is **127 passed, 0 failed**,
and unexpected browser errors are empty. Four individually sealed document coverage
segments contain 70/82/82/78 entries; their aggregate preserves the earlier action methods.
The original trace/profile and all 808 original payloads are authenticated by
`evidence/e9-t06/public/provenance.json`; 12 compact copies and five identical-frame aliases
are committed. The report and screenshots cover real persistent Alpha/Beta sessions,
exact paused reopen, stale preview fencing, incompatible/missing-data and label-storage
errors, label recovery, and distinct guest file/RAM witnesses. Alpha's exact raw tuple is
`8184b6a40902d645e3d3829e6e1398856306a58e924b4fc6c1095432f19a7a2b`;
Beta's is `aa7208c55c3b80e0870c1d7f91d0abd368ebbb7a0f39000c0f81b2be9b8179f4`.
The retained GPU factory is qualified, neither lost nor poisoned, with a physically drawn
epoch-4 frame after 2,499,808 retired instructions. The 47-file archived GPU identity and
software runtime `c404e41c43d7912f5ae2886848724d018b515cc5d1a668a15105ba3f54b232bc`
remain unchanged.

This carries the previously held behavioral results forward; it is not a verification
verdict. The fresh critic separately found that a missing-point digest error overflows at
390px and requested two focused cleanup-path recordings. Those remain to be repaired/proven.
