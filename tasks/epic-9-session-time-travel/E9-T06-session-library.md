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

### 2026-10-18 — verifier — VERDICT: refuted

- **P8 responsive error state — FAILED.** Predicted no horizontal overflow at 390px when
  a selected compatible checkpoint disappears before keyboard Open. After deleting the
  existing 23-part machine-object descriptor and confirming absence, Open correctly reports
  `incomplete`, but its 64-character `Corrupt` digest makes `scrollWidth=586` versus
  `clientWidth=388` (right/viewport 390). Rechecked the measured DOM and screenshot.
  Citation: `evidence/e9-t06/verifier-initial/missing-point-report.json:1124`,
  SHA-256 `3e660bf218cd2b5ec5b448961a75b77a018550fbc4ee070639d6d96ed960d22f`,
  and `missing-point-error.png`. Original trace
  `target/evidence/e9-t06-verifier/n1-v5/trace.ndjson:372` / `call@157`, ZIP SHA-256
  `016d7f323d14c5784af8516b3f1584be3f8537792a5c08bffcfe1dc4af092256`.
  The new CSS wraps active/details but omits status (`web/session-library.css:9-12`);
  `session-library.js:76` emits this real error. **Demand:** wrap status/error text and
  record the same bounded 390px disappearance case locally and on production.
- **N1 admission/ownership; P1-P7/P9 — HELD.** The target object existed before sabotage;
  after it vanished, admission rejected before replacing the owner. Alpha stayed paused
  with zero retired instructions and identical complete tuple SHA-256
  `599fd981f229ea7c99600f274f6ae16873b940352ffd64e74f748abf7f96e73b` before/after.
  Both gzip frames are exact aliases of the retained worker Alpha point. Worker trace
  lines 744,869,874,940,944,995,1069,1128,1166,1191,1195,1271,1298,1302,1362,1404
  support durable names/points, paused RPC rejection, preview fencing, unavailable/error
  states and actual file/RAM witnesses. Independent frame decoding authenticates all
  component digests and Alpha's 22 queued UART bytes. See packet `predictions.json`.
- **P0/P10 provenance and public behavior — HELD.** Independently authenticated all
  worker 553 payloads / 16 sources, 19 copies / 5 aliases and all 554 originals, then public
  808 originals, 12 copies / 5 aliases and 19 Git-matching assets. Public receipt
  `2d441f7fa17fcebeef82d4db2273a120fbe497a1d56b9c9a59378d434cb232a8`
  preserves 127 passed / 0 failed, errors `[]`, exact paused Alpha/Beta tuples and the
  physically drawn qualified retained GPU. No native/store/dependency/runtime bytes changed.
- **C1 navigation coverage — HELD.** Four sealed public segments 70/82/82/78 concatenate
  exactly to 312 aggregate entries. The lost earlier-document export is repaired. UTF-16
  coverage union records every added `main.js` line and every library method; all other
  required changed hunks execute or have explicit bounded waivers in packet `coverage.md`.
- **C2 writer cleanup — NEEDS EVIDENCE.** `session-library.js:162-164` (owner loss during
  recording) and `session-library.js:180` (failed initial capture cleanup) never execute in the supplied
  coverage. Record the promoted driver's isolated tail: exactly one actual Start/save
  failure must leave a draft, publish no row, clear recording and permit immediate writer
  reacquisition; successful Start followed by ordinary retirement must release the writer,
  clear active/recording identity and preserve its committed manifest/point hashes.
- **SUITE:** promoted `tools/verify/e9-session-library-missing-object-browser.mjs`,
  parameterized by `--recording-report`, `--web-dir`, `--output` and optional production
  `--url`/`--check-public-assets`. It copies/authenticates the original profile, binds a
  clean source head/assets, records raw tuples/DOM/trace/coverage and checks original
  immutability. Picker setup uses the native API; Tab reachability, visible focus and Enter
  Open are real keyboard actions. The two cleanup blocks await the actual writer/LockManager
  release acknowledgement; the test never releases the product's writer to hide a bug.

Original recordings/profiles are unchanged; all prior HELD results carry forward. Scope is
S/medium UI composition over unchanged T05 APIs, so rework is CSS plus the two focused
proofs; no broad native/workspace rerun or automatic cold clone. Commands: independent
SHA-256/provenance/frame/trace/coverage audits; `node --check` on the promoted regression.
The initial N1 source/failed report/screenshot and original digests are retained in
`evidence/e9-t06/verifier-initial/`; `coverage-audit.json.gz` and `coverage.md` hold the hunk inventory.

### 2026-10-18 — worker — mobile repair and completed cleanup evidence

Frozen repair head: `1afabe81e5545eb54da63faddc8214d81e474dc4`.
The product repair is one CSS declaration wrapping long status text. Native code, runtime
JavaScript, storage semantics, the software runtime identity and Wasm bytes are unchanged.
The promoted missing-object/cleanup regression is now automatically run by the acceptance target.
Touched harness syntax passed; `make web-dist` rebuilt the committed page.

Ran `GIT_OPTIONAL_LOCKS=0 E9_LIBRARY_EVIDENCE_DIR=target/evidence/e9-t06-css-worker-final make verify-E9-T06`.
All **nine** medium-risk gates passed at the frozen head, including the original full built-browser
flow and the new actual missing-point/cleanup tail. Acceptance receipt SHA-256:
`deb146471aff0602b1db395d9c6359b761df63ad2e17d6fe446effb9fb0e9f3d`.
The 17 source hashes and all 1,123 original files (including the receipt) are bound by
`evidence/e9-t06/worker-repaired/provenance.json`; it retains 20 compact copies and five aliases.

The bounded report SHA-256 is `4b83676473c08680b2435dcb930f986f09153bb79ace65dddbff092dc82fd5ce`;
`evidence/e9-t06/repair-local/` retains seven compact copies and two aliases, authenticating
563 original payloads without changing the original browser profile. At 390px, the real
missing-object error has scroll/client width **388/388** and stays inside the panel; the
full active Alpha tuple remains `28f85384b08433a7f9bcc36a1d2eaee40a976c14699e560a795ffef9200790a6`.
One deliberately failed initial save leaves a draft, no durable session and no writer lease;
immediate same-ID acquisition succeeds. A later successful Start is retired through the
ordinary ownership protocol. The browser acknowledges its writer lock is absent before
reacquisition, and its committed revision-1 manifest remains byte-identical at
`0ca2c5291d899c06a9978412cd14b922a496eb068e5794194b0c9fbba11e56f2`.
The full browser run again has 127/0, no unexpected errors, four sealed coverage segments,
exact actual guest file/RAM restores and a fresh physically drawn retained-GPU frame.

The new mobile screenshot was visually inspected. The status remains in-progress until
the repaired CSS is deployed and the same bounded production proof is recorded. Previously
HELD results carry forward; only the fresh critic can resolve the refutation.

### 2026-10-18 — worker — repaired public proof, ready for fresh verdict

Published committed CSS/product head `1afabe81e5545eb54da63faddc8214d81e474dc4`
with evidence-only publication head `41f8978c4156ffeb70e2f3a45ed97bd17d542bb8` via
`bash tools/deploy-cloudflare.sh`. Deployment: `https://6fc93522.wasm-vm.pages.dev`;
production: `https://wasm-vm.pages.dev/`. All large artifact hashes were unchanged.
The five deployment-only manifest URL rewrites were restored before recording.

At the clean publication head ran:
`GIT_OPTIONAL_LOCKS=0 node tools/verify/e9-session-library-missing-object-browser.mjs --recording-report target/evidence/e9-t06-public-final/report.json --web-dir web/dist --url https://wasm-vm.pages.dev/ --check-public-assets --output target/evidence/e9-t06-public-css-fixed`.
Report SHA-256: `d5bd94a4d5f204f58c5da68723289e9a7a8a9e7114e63b2caef4490fd13d80e7`.
All **16** critical public assets match the committed repaired build and unexpected errors
are empty. The real missing-object error wraps at 390px with scroll/client **388/388**.
Alpha stays paused with zero retirement and exact tuple
`8184b6a40902d645e3d3829e6e1398856306a58e924b4fc6c1095432f19a7a2b`.
The initial-failure draft/no-row/reacquisition check and ordinary owner-retirement/lock-absence
check also pass in production. The latter preserves revision 1 and its exact manifest SHA-256
`7499018e7314be7878bb403efe7076e48ff90c103673d97de512da909010a011`.

`evidence/e9-t06/repair-public/` retains eight compact copies and two exact-frame aliases;
its provenance authenticates **822** original payloads plus the report at the cited path.
The original public profile is unchanged. The prior full public 19-asset/127-test/GPU proof
and the repaired local nine-gate run remain held with identical runtime JavaScript/native
boundaries. This bounded run closes only the changed mobile CSS/publication and requested
cleanup proofs. Status is implemented; the fresh verifier owns the final verdict.
