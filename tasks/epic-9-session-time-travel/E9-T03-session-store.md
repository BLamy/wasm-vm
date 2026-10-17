---
id: E9-T03
epic: 9
title: Persist multiple session logs with atomic publication
priority: 524.903
status: implemented
depends_on: [E9-T02, E3-T12d]
estimate: S
risk: high
capstone: false
---

## Goal

Store many independent sessions locally in the browser and reopen them after a tab reload.

## Boundary

One chunked append-only IndexedDB session store with a commit cursor. Keep the existing resume-snapshot store intact; localStorage is limited to small preferences, not VM blobs.

## Acceptance criteria

- [x] Stream bounded chunks and publish the manifest/commit cursor only after referenced chunks are durable; never retain an additional whole-session copy.
- [x] Reload two different sessions and recover the exact committed prefix after termination between data and commit writes.
- [x] Serialize competing writers with existing browser ownership mechanisms; detect missing/corrupt chunks and keep incomplete records out of the playable list.

## Deterministic acceptance

`make verify-E9-T03` records the affected native/no_std and independent metadata-Wasm checks, the real built-page IndexedDB crash/race proof, and the retained GPU factory runtime regression. It requires local Chromium and downloads authenticated public release artifacts when they are absent from a pristine checkout. This slice does not claim guest checkpoint decoding or replay qualification.

## Adversarial verification

Terminate between each publication step and race two tabs writing the same session. A partially published session, mixed writers or loss of a previously committed prefix refutes.

## Verification log

### 2026-10-17 — worker — started

E9-T02 and E3-T12d are verified. This high-risk S boundary adds a separate append-only,
chunked IndexedDB session store. Existing resume-snapshot persistence remains independent.
Publication will advance a commit cursor only after its immutable referenced data is durable;
Web Locks will own writes and interrupted publication will retain the old committed prefix.
The user authorized continuing through all of Epic 9; this layer remains unmerged.

### 2026-10-17 — worker — implemented

Frozen code: `8461ae9f661deb0841dabf00ab9b99e1fd431e2f`.
Command: `E9_STORE_EVIDENCE_DIR=target/evidence/e9-t03-worker-final make verify-E9-T03`.
The clean-head recorder passed all 14 commands: affected format/lint, all 129 storage
tests and one adapter test, no_std wasm build, exact independent metadata bundle rebuild,
nine shared codec Node/Wasm cases, T01 contract, retained-runtime byte checks and the
actual built-page Chromium run. Full command outputs and compact receipts are committed
under `evidence/e9-t03/worker/`. Original recordings remain under
`target/evidence/e9-t03-worker-final/`, including the persistent Chromium profile,
`browser/browser-trace.zip`, `browser/javascript-coverage.json` and full browser report.
The top-level report SHA-256 is
`63983b74f3018128ea0d649fc7baeaa24c2163865eadc111100bb11af95bea1d`; its 420 file
receipts bind the original evidence. `worker/SHA256.json` binds the compact copies.

The recording reopens two distinct exact manifests after reload, preserving sequence
`9007199254740994`; streams 100,663,419 bytes through 97 bounded persisted chunks; and
forces actual renderer crashes at chunk, object, pre-commit and completed-commit cuts.
The first three retain revision 1 and the final cut retains revision 2. Twenty two-tab
races with varied seeds admit one writer and preserve that winner's immutable prefix.
Missing external payloads, corrupt/deleted chunks, malformed inputs and quota-fault
injection refuse without altering the committed sessions. Cancellation drains the old
lease through the browser's lock-release acknowledgement before reacquisition. The live
retained-memory check peaks 2,471,464 bytes above baseline after periodic DevTools GC;
raw samples are retained separately, with no throughput/transient-allocation claim.
The CPU suite reports 127 passed / 0 failed, the storage pip is verified and console/page
errors are empty; `browser.png` records that result.

The original GPU factory runtime is preserved byte for byte (47 files including its
stamp, build `222950026e3e01ed…`), rather than relabeling its pair for a rebuilt Wasm.
The actual factory warm boot uses the retained worker, restores the authenticated pair,
retires 3,999,540 new instructions and presents in fresh epoch `0000000000000004` with
no GPU loss/poison/failure; `gpu-factory-ready.png` records the desktop. Its accepted
static-desktop repair present has no guest sequence. This proves existing factory
readiness, not E9 GPU replay qualification. Disk-root content semantics remain T04 and
coherent live restore remains T05.

The pre-commit hook completed the local bundle build, then its restage hit an inactive
index lock. That owned lock was preserved, the built `web/dist` was explicitly staged,
and the code commit used `SKIP_WEB_BUILD=1`; `bundle-build.log` preserves the build.
A fresh verifier must now interrogate this evidence, perform its bounded attacks and
sabotage check, and inspect one pristine-clone proof at the final code/test head before
setting verified. Public deployment/proof follows that verdict; all PRs remain open.
