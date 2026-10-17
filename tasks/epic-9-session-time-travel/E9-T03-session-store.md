---
id: E9-T03
epic: 9
title: Persist multiple session logs with atomic publication
priority: 524.903
status: verified
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

### 2026-10-17 — verifier — promoted proof candidate (final verdict pending)

Fresh-session predictions were written before opening worker evidence in
`evidence/e9-t03/verifier/predictions.md`. P1–P8 held; P9's original receipts and gates
held, with the single final-head pristine-clone proof still pending. All 420 original
file receipts and source hashes matched, and all 47 retained GPU files matched the
predecessor byte for byte. The original profile stayed untouched; only its copy ran.

Four independent two-tab races/crashes (seeds 13411–13414) preserved exact old cursors
1/1/1 and committed cursor 2 at the four boundaries. Descriptor/cursor tampering
failed closed. The supplement independently checked every original large-object byte
against its pattern oracle and promoted real-IDB integrity/reuse/final-transaction,
cancellation/close, native-error, version-change and catalog-bound tests into
`tools/verify/e9-session-store-critic.mjs`, called by the acceptance target. A scratch
copy with the append guard removed admitted checkpoint removal, and the rejection
assertion failed as required. Its initial malformed sabotage setup was correctly
refused by the codec; the corrected narrow supplement passed without runtime changes.

Compact reports and recording digests are under `evidence/e9-t03/verifier/`; original
independent traces/profile copy remain in `target/evidence/e9-t03-verifier/`. Combined
precise coverage leaves no wholly unexecuted nonempty source line and explicitly
waives five defensive environment/deletion branch ranges. The per-hunk coverage table
and scoped waiver reasons are in the verifier README and coverage receipt. Status
remains implemented until the verifier inspects the final pristine-clone proof.

### 2026-10-17 — verifier — VERDICT: verified

- P1–P9 **HELD**. Both distinct reload manifests and all four crash manifests match
  independently reconstructed hashes; new seeds 13411–13414 preserve exact prefixes.
  The 97-part raw-IDB pattern/hash oracle, two-tab ownership, corruption exclusion,
  final-transaction races and lease lifecycle attacks held. Source/evidence points and
  per-hunk coverage/waivers are recorded in `evidence/e9-t03/verifier/verdict.md`.
- **SABOTAGE HELD**: removing the append guard in a scratch-served copy admits a
  committed checkpoint removal, and the rejection assertion fails. Original code
  returns `NotAppend`. The initial malformed scratch fixture and corrected narrow
  retry are preserved honestly; no implementation fix was needed.
- **FINAL PRISTINE PROOF HELD** at test head
  `c51133cacd48408e9ef054370b0503a32f645f32`, with runtime unchanged from
  `8461ae9f661deb0841dabf00ab9b99e1fd431e2f`. The normal sparse clone is clean,
  starts without target/npm caches or Git alternates, scrubs the prescribed environment,
  and passes all 14 `make verify-E9-T03` commands. All 442 cold receipts match. The
  browser again reports 127/0, no errors and all promoted critic cases; the real factory
  pair restores with resumed CPU and a fresh-epoch physical draw, using three actual
  public R2 HTTP-200 fallback downloads. Compact proof is in the verifier `cold/` folder;
  original profile/trace remain in `target/evidence/e9-t03-cold-final/acceptance/browser/`.
- **SUITE**: the bounded critic helper is permanently called by `make verify-E9-T03`.
  No product contradiction or remaining semantic proof gap was found. T04/T05/T17/T18
  retain their declared disk-content, coherent restore and replay boundaries.

Cold receipt SHA-256:
`f0e4812a4d12c2b6fb114983d74fce71e3b3acfd6c552817775da50e18983de6`.
Cold acceptance report SHA-256:
`c04bb9c95bca209d663fb6789891cafe56323c9622e5608a7f9026e3cfa99acf`.
All original worker receipts were also independently revalidated. The status/queue
commit changes verification metadata only; no runtime or test code follows the proven head.

### 2026-10-17 — verifier — publication harness addendum — VERDICT: verified

All P1–P9 product/cold results remain **HELD**. Runtime, dependencies and critic tests
remain unchanged since `c51133ca`; the narrow driver correction is
`54a270afbd17758e4edddb4f332123fc5d380037`. H1–H5 predictions and nine exact-source
response/console guard checks held. A 304 is accepted only after the same run verifies
that path's 200 body against local dist; the favicon exemption requires the exact
`https://wasm-vm.pages.dev/favicon.ico` console location and 404 text. The earlier
checker failure is fully explained by those permitted HTTP conditions.

The corrected public run exits 0, binds all 676 original file receipts, and retains
127/0, four crashes, 20 races and every promoted critic case. It restores the actual
retained factory worker, retires 2,999,712 new instructions and draws in fresh epoch 4.
All 59 selected public-file hashes match local dist. No original profile was opened or
modified, and no unrelated gate or cold clone was repeated. Exact trace points, guard
checks, file digests and the closure review are in
`evidence/e9-t03/verifier/publication-addendum.md`; status remains verified.

Corrected public report SHA-256:
`b091582b530875f696333768333e87aee9abd6a63bac132112d1c5bd6b3ab1bf`.
