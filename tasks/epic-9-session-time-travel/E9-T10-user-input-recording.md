---
id: E9-T10
epic: 9
title: Record user and host-control inputs at delivery
priority: 524.910
status: verified
depends_on: [E9-T09]
estimate: S
risk: high
capstone: false
---

## Goal

Capture actual user inputs and host actions as guest-visible ordered events.

## Boundary

UART, keyboard, absolute/relative pointer, resize and offered clipboard/file-transfer ingress through the common delivery queue. Store large payloads by content hash; explicitly gate unsupported input channels.

## Acceptance criteria

- [x] Record exact delivered bytes/events, including releases, modifiers, pointer mode changes and a file upload, with event clock keys rather than DOM timestamps alone.
- [x] Repeated input and same-position sequences retain their original order and payload identity across store/reload.
- [x] Pause/resume/stop boundaries and failed or cancelled transfers produce a documented, replayable prefix; no hidden live input may enter replay.

## Deterministic acceptance

`make verify-E9-T10`. Records the delivery assertions above, independent native/browser object checks, affected native/wasm gates and real browser captures required by AGENTS.md. A passing result must name its frozen source head.

## Adversarial verification

Use rapid typing, focus loss with a held key, duplicate-position pointer events and a cancelled partial upload. Compare guest-observed events and file bytes, not just host event counts.

## Verification log

### 2026-10-18 — worker — started

E9-T09 is independently verified at `3434d69d069dce7a0fdc52162b7a9c21a3db53a9`; its final published catalog and stack head is `b25fb9de9e04b8be20a95ed1747066c1617e49b9`. This high-risk slice records owned, normalized input through the actual device delivery boundary, retaining an explicitly incomplete input prefix until all replay adapters are installed. No implementation or verification claim yet.


### 2026-10-18 — worker — recording-only proof repair

Runtime and original harness freeze: `dc5fab60d1b0e4c6c92bc78169232c9d3622825e`.
Both the worker and pristine-clone risk runs passed all 682 native tests, wasm builds,
protocol checks and the real browser capture: 127/0 suite, exact completed 131129-byte
upload, retained cancelled 65528-byte prefix, unchanged published manifest under a
retention failure, retry and concurrent save/release/stop ending at sequence 77.
Originals: `target/evidence/e9-t10-worker-final-2` and
`target/evidence/e9-t10-cold-final-2/acceptance`.

Their independent object parser then rejected an overly strict harness assumption:
it required the pre-capture UART marker to be the queue's suffix. The UI may also append
its legitimate directory-listing RPC. In both original witnesses the marker is present
and the FIFO receipts reproduce **the entire initial pending queue byte for byte**.
The parser now permits those additional bytes while retaining that exact comparison.
This is a proof gap, with no runtime refutation or runtime change. Only the corrected
parser, proof reuse safety and unrun remainder need new evidence; passed unchanged
runtime checks are carried forward under AGENTS.md's incremental rule. No implemented
or verified verdict is claimed yet.


### 2026-10-18 — worker — implemented

Runtime freeze: `dc5fab60d1b0e4c6c92bc78169232c9d3622825e`. Proof-only repair freeze:
`fafa1d63b5fa584df445e0c967ea52af966de5f8`; release Wasm, runtime JS and devices did not
change. This is an input recording claim, not complete VM replay (T11–T14 remain gated).

- `GIT_OPTIONAL_LOCKS=0 E9_INPUT_REUSE=target/evidence/e9-t10-worker-final-2 E9_INPUT_EVIDENCE_DIR=target/evidence/e9-t10-worker-final-incremental make verify-E9-T10`
  passed **27** gates: **21** authenticated unchanged results carried from the original
  frozen recording, plus current policy, four proof-reuse attacks, independent native
  and browser object/clock oracles, and the previously unrun retained GPU browser proof.
  Original report: `target/evidence/e9-t10-worker-final-incremental/report.json`, SHA-256
  `ba9cdf443d8f07059ce87d16aa7b0a7479b4d14ad3b2ec7e4667ebec5a99ad64`. Compact copies: `evidence/e9-t10/worker-final/`.
- `GIT_OPTIONAL_LOCKS=0 python3 -u target/e9-t10-cold-incremental.py` passed the same
  acceptance target at the proof repair head, continuing the **same pristine-origin**
  clone and its own initially empty compiler target. All original **682 native tests**,
  affected wasm builds, **76** JS protocol/input tests and the real **127 passed / 0 failed**
  built-page run remain authenticated. The repair changed only proof tooling and task
  metadata. The cold clone imported no worker target or node_modules; its idle source
  was losslessly moved to task RAM to preserve disk space, with before/after inventories
  and persistent independent Git metadata. Receipt: `target/evidence/e9-t10-cold-final-incremental/receipt.json`,
  SHA-256 `955e6636e54ab1ac3a839d28df66b050395018352ed3b84aa3b1c1d9be937ebf`; acceptance SHA-256 `8cfe898e145bd5d5c73035430cb1ffbd226f15475788d80dc51a29b7dce9a188`.
  Compact copies, origin receipt and relocation audit: `evidence/e9-t10/cold-final/`.
- Independent decoders checked **17** native frames / **20** guest instruction traces,
  **28** clock regression frames and **seven** authenticated browser prefixes. The RV64
  guest observed exact UART and keyboard/tablet/mouse DMA bytes, modifier release after
  focus loss and duplicate-position events. Rapid make/break sequences traverse real
  event queues; whole-frame drop outcomes and source/replay native frames agree.
- The real Linux WVFT peer read back **131129** upload bytes (SHA-256
  `d76854eeea54b02d6ec86d9dc9acaffd3f9734a3077b792ff014c135075975e9`) and **65528**
  partial bytes (SHA-256 `ccd8ab7bb8cc5df3e2aede25c96a9147ed71becf5165e061e0d964131a3b72d7`).
  Cancellation closed its handle and retained that private prefix without publishing
  the requested basename. A late push records WVFT error 12. Storage refusal preserved
  the previous manifest; retry and concurrent save/release/stop committed all **77**
  receipts, ending at the machine's stopped cursor. Fresh-tab reads match the original.
- **64** tied offers / **4 MiB** retain exact caller-owned payloads across three bounded
  chunks. Replay rejects live ingress and general execution; **24** additional mutation
  guards preserve the cursor. Malformed replay keys reserve nothing; outcome divergence
  poisons the candidate. The initial UART witness and actual FIFO receipts match byte
  for byte, including legitimate UI RPC bytes around the explicit queued marker.
- The unchanged retained GPU factory's **58** current/archive assets matched exact hashes;
  both proofs retired guest instructions and drew a fresh physical presentation.
  Unicode SHA rejection also preserves the native digest/cursor; original capture and
  driver are in `evidence/e9-t10/input-validation/`.
- `bash tools/deploy-cloudflare.sh` published the frozen build to
  <https://wasm-vm.pages.dev/> (preview `https://4e620143.wasm-vm.pages.dev`). All R2
  objects matched pinned bytes on retry after one network timeout; no R2 repair was
  performed. Exact deployed payload snapshot: `target/e9-t10-full-deploy/receipt.json`,
  SHA-256 `ceff4ab162974dcf7a0e7d5b87d95c78d641f090e7109ae59574c0e25758f707`; deployment logs in `evidence/e9-t10/deployment/`.
  Production browser proof is the remaining publication check and must arrive before
  the fresh verifier's final verdict.

Earlier failed resource-isolation output and the interrupted diagnostic remain intact;
`evidence/e9-t10/resource-incident/` documents the observed database closure around low
available disk and the subsequent passing recovery without a runtime change. The original
recordings, profiles, native traces, guest files and all full logs remain at their recorded
paths. rr/ssh dev is waived under the repository policy. No independent verification claim
or merge authorization is made by this worker entry.

### 2026-10-18 — worker — published input recording proof

At clean metadata head `6528fcce222cb2f276e751dda7ef4ddbf10cd50b`,
`GIT_OPTIONAL_LOCKS=0 python3 -u target/e9-t10-public.py` passed all four recorded
production commands: `e9-input-recording-browser.mjs --url https://wasm-vm.pages.dev/`,
the saved-object oracle, the event-clock oracle, and the unchanged retained-GPU
browser regression. The runtime and all 38 submitted source digests remain those
of the frozen worker submission.

The actual production page passed **127 / 0**, with zero unexpected console errors.
Its Linux guest read the exact 131129-byte completed upload and the 65528-byte
cancelled private prefix, matching the submitted SHA-256 values. Storage-pressure
retry, concurrent save/release/stop and fresh-tab reload retained **77 receipts**,
ending at transition `204400000`, retirement `204379225`, sequence `77`, ordinal
`12`. The independent saved-object and clock oracles held. All **58** retained-GPU
assets matched, and the real retained guest retired instructions and drew a fresh
physical presentation.

Original evidence: `target/evidence/e9-t10-public-final/`; report SHA-256
`245f7588ae4346845cca2c182f8e391eadef2fbbe0b9d9039feceaebf5c28b1c`.
Authenticated compact packet: `evidence/e9-t10/public-final/`, including the original
public driver, screenshots, browser traces and oracle logs. The full recordings
and profiles remain at their original paths. Independent adversarial verification
remains pending; this publication entry does not set `verified`.


### 2026-10-18 — fresh verifier — VERDICT: verified

The verifier did not implement this task. Predictions P0–P13 were written before their
corresponding evidence was inspected. Runtime freeze `dc5fab60d1b0e4c6c92bc78169232c9d3622825e`,
proof repair `fafa1d63b5fa584df445e0c967ea52af966de5f8`, and production capture
`6528fcce222cb2f276e751dda7ef4ddbf10cd50b` were independently authenticated. No runtime
source changed after that freeze; this verifier adds only promoted tests, evidence and
metadata. `CapturePrefix` remains explicitly incomplete; T11–T14 replay requirements
were not imported into this input-adapter claim.

- **P0 / P7 source, isolation and proof repair — HELD.** Both original worker/pristine
  inventories, all source Git blobs, every compact packet entry/alias and the production
  inventory match their hashes. The cold source was clean at `fafa1d63`, with independent
  persistent Git metadata, no alternates, 38 exact source hashes and an originally empty
  compiler target. Audit `evidence/e9-t10/verifier-final/cold-source-audit.json` SHA-256
  `a1c70958d954ff315d59680d0551c69587681cbb9f23dbc8e2e99912631625d7` was preserved before
  authorizing disposable source release. The narrowly allowed proof delta changes no
  runtime/dependency boundary. The corrected oracle compares the **entire** initial
  UART queue against FIFO deliveries; marker containment permits legitimate following
  RPC bytes without weakening that byte comparison. Four frozen-harness forgery cases
  and an additional external-symlink escape reject before creating output.
- **P1 / P2 guest delivery, reservation and rapid input — HELD.** Independent decoding
  of 17 native frames and 20 instruction traces per original reproduces exact UART,
  evdev and clipboard-port bytes, six rapid make/break bursts and 768 ordered receipts.
  The source/replay keyboard/tablet/mouse/drop frames are byte-identical. In
  `target/evidence/e9-t10-worker-final-incremental/native/keyboard-focus-release.trace`,
  lines **74–75** and **106–107** load/store the zero-valued A and Shift releases
  (trace SHA-256 `bd1467ff375c92b592f7685f03d0e770d84254afd9ebae2e15727701d84440f9`).
  Duplicate tablet positions and signed mouse deltas remain in guest RAM/trace. The
  opaque mailbox snapshot independently retains channel 3 / bytes `07 08 09` at
  transition/retirement 7, sequence 0 (`host-mailbox-pending.resume`, SHA-256
  `d3bd6c3b03e512504ade4e32f40d5ca10b4e1719f917dc782630c51ff5ada7d1`).
  Malformed/oversized input, exhausted reservation and undrained receipts refuse before
  device/cursor mutation; a whole-frame drop leaves the guest used ring at zero.
- **P3 / P4 exact durable input and actual Linux transfer — HELD.** All seven prefix
  sets were independently decoded for worker, cold and production, including object
  hashes, decimal clock keys, publication frames, exact initial FIFO prefix and caller
  ownership. The 64 tied offers preserve all 4 MiB over three bounded chunks and retain
  the first-16/remaining-48 acceptance/refusal outcomes across reload. The actual guest
  file is **131129 bytes**, SHA-256
  `d76854eeea54b02d6ec86d9dc9acaffd3f9734a3077b792ff014c135075975e9`;
  the retained cancelled private prefix is **65528 bytes**, SHA-256
  `ccd8ab7bb8cc5df3e2aede25c96a9147ed71becf5165e061e0d964131a3b72d7`.
  Production `browser/browser-trace.zip!/trace.trace:1290`, `:1318`, `:1338` retain the
  actual guest readback and closed-handle/absent-final-basename commands; their decoded
  UART results equal the recovered files. A late push is receipt **66**, failure code 12.
- **P5 lifecycle, failure and concurrent publication — HELD.** Production retention
  refusal leaves manifest SHA-256
  `d16c1a88dcc9d9789d65fd4ad3614c9aaaa100ad983e93f23010b2d8e196ff99` unchanged and pauses
  execution. Retry retains event identity. Concurrent drain/release/stop retains key-up
  **75**, its publication **76**, and final stop **77**; the fresh-tab object is identical
  and its end equals the stopped machine: transition `204400000`, retired `204379225`,
  sequence `77`, ordinal `12`. Actual objects and state points are in
  `evidence/e9-t10/verifier-final/state-audit.json`.
- **P6 firewall and validation — HELD.** Actual browser live ingress and 24 mutation
  guards preserve replay cursor sequence/ordinal 22; malformed replay keys reserve
  nothing. Deliberate outcome divergence consumes only the checked next event and stops
  the candidate at sequence/ordinal 23. Native manifest admission refuses incomplete
  capture prefixes. The authenticated Unicode-SHA trace calls the 64-byte non-ASCII
  guard at `input-validation/browser-trace.zip!/trace.trace:32`; `HashMismatch` preserves
  both cursor and native digest `d02925fa3b9545b2986fb958414c917ee41c3a9ea928a0b501729d384d58b35d`.
- **P8 / P11 / P12 / P13 bounded attacks and coverage — HELD.** The original count-zero
  DOM pointer-mode path was closed with an independently recorded real 16-MiB guest:
  two new seeds (`0x9e3779b9`, `0xa409a563`), each direct and promise-serialized, preserve
  duplicate positions and all ten tablet/seven mouse DMA events. Each old-device
  release/SYN precedes its mode receipt, all 24 receipts survive caller mutation and
  durable reopen, malformed second-receipt staging is atomic, and replay rejects mode
  ingress without consuming a coordinate. A separate actual loader recording retains
  initial held-tablet/mouse ledgers `[272]`, then exact release receipts and raw paused
  capture/unsupported-control refusal. Scoped witness-boundary fault injection exercises
  the retry/error plumbing: one transient refusal, one real fetch call, attempt two
  delegates to the actual native exporter; an unsupported error starts no adapter and
  publishes no manifest. This injection is not claimed as a genuine cache-miss witness.
  All changed loader/journal/pointer lines execute; specific declaration/generated/UI
  status-message waivers are recorded in `verifier-final/coverage.md`.
- **P8 / P9 SUITE — HELD.** Five pointer regressions are promoted into the existing
  `web/tests/pointer.test.mjs` gate. The focused pointer suite passes **18/18** and the
  affected input/worker protocol gate passes **81/81**. In an isolated byte-identical
  JS/TS copy, moving mode publication ahead of the held-button release makes all four
  new order checks fail. Separately changing the native A-release byte makes the
  independent guest oracle fail. The frozen submission's **682 native tests**, affected
  wasm builds and full prescribed local gate results were authenticated and interrogated;
  runtime semantics did not change, so unrelated workspace/cold-clone gates were not
  restarted for test/evidence-only promotion.
- **P10 published proof — HELD.** Production report SHA-256
  `245f7588ae4346845cca2c182f8e391eadef2fbbe0b9d9039feceaebf5c28b1c` authenticates 1414
  original files and all 38 source identities. Built suite **127/0**, zero unexpected
  console errors, live input pips, desktop/mobile captures and actual Linux file/prefix
  checks hold. A fresh independent Chromium request context re-fetched and hashed all
  **18** shipped assets. The unchanged retained GPU's **58** asset identities hold;
  its public guest retired **2499808** instructions and physically drew in fresh epoch 4.

Verifier packet: `evidence/e9-t10/verifier-final/` (42 independently hashed files),
provenance SHA-256 `9c53b382385bed91c3f8ba5bcc42b3f9d837f53cde8ad3d11db00c16d9687ffd`.
Original verifier recordings and setup diagnostics remain at
`target/evidence/e9-t10-verifier/`; no worker, cold or public original was edited.
No semantic refutation or missing accepted-path proof remains. rr/ssh dev is waived;
no GitHub Actions, merge or external messaging was used.

Commands: independent `audit_state.py`, source/packet/public hash audits,
`proof_attacks.py`, `pointer-critic.mjs`, `loader-critic.mjs`,
`witness-fault-critic.mjs`, `promoted_sabotage.py`; `node --test` for the six affected
input/worker protocol files; `git diff --check HEAD^ HEAD -- tasks web/tests` (raw
recorded evidence logs retain their original bytes); task policy before queue regeneration.

### 2026-10-18 — worker — verified catalog published

After verifier commit `d8cfeae5ddcb952dcac97231397fbbef1c9f2b77`,
`make web-dist` preserved the exact runtime build/Wasm and changed only the generated
task catalog, roadmap pip and service-worker stamp. At metadata head `28453118399c7dff3a50db5e6431c147af32528f`,
`target/e9-publish-verified-catalog.py publish --snapshot target/e9-t10-full-deploy`
published that bounded delta to Cloudflare (preview
`https://a5d25264.wasm-vm.pages.dev`), carrying the authenticated full deployment's
unchanged release assets and R2 bindings.

`node target/e9-t10-public-metadata.mjs https://a5d25264.wasm-vm.pages.dev`
then matched **25** actual production asset hashes, passed **127 / 0** with no
unexpected console errors, and asserted both the delivered-input capability pip
and E9-T10 task catalog are `verified`. Report SHA-256:
`d1ad2ef1d0b6d6029921e0f3baa796ded311981abe24f390024823be1adfb2b1`.
Packet: `evidence/e9-t10/verified-catalog/`. Disposable pristine-source/compiler
scratch was released only after its independent verifier audit; all recorded
evidence and independent Git metadata remain. PR #585 stays open.
