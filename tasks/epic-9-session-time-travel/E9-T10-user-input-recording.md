---
id: E9-T10
epic: 9
title: Record user and host-control inputs at delivery
priority: 524.910
status: implemented
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

- [ ] Record exact delivered bytes/events, including releases, modifiers, pointer mode changes and a file upload, with event clock keys rather than DOM timestamps alone.
- [ ] Repeated input and same-position sequences retain their original order and payload identity across store/reload.
- [ ] Pause/resume/stop boundaries and failed or cancelled transfers produce a documented, replayable prefix; no hidden live input may enter replay.

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
