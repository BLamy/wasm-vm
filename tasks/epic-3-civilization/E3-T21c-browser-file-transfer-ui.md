---
id: E3-T21c
epic: 3
title: Streaming browser upload/download UI
priority: 321.3
status: implemented
depends_on: [E3-T21b2c]
estimate: S
risk: medium
capstone: false
---

## Goal
Expose the frozen transfer protocol through accessible drag/drop upload and browser download flows.

## Deliverables
- Drag/drop target, progress, cancellation, partial/error state, and simultaneous-upload UI.
- Streaming guest-to-browser download handling without whole-file buffering.
- Browser tests for hostile names, directories, empty files, and 1,000-file refusal/handling.

## Acceptance criteria
- [ ] A browser test transfers a generated 100 MiB stream in each direction with heap growth under
  32 MiB and matching SHA-256.
- [ ] Console errors are zero and cancellation leaves an explicit partial state.

## Adversarial verification
Cancel during every phase, drop directories and hostile Unicode names, start simultaneous flows,
and force quota/protocol errors. The UI must never report completion before durable acknowledgement.

## Verification log

### 2026-07-27 — worker — implemented at `7da3744`

- `cargo test -p wasm-vm-slirp file_transfer`: 14 passed, including the empty-file and
  generated 100 MiB bounded-stream regression and the host-side cancellation/backpressure case.
- `cargo test -p wasm-vm-cli file_transfer_fixture`: the fixed source/directory sink round trip
  passed (the command was stopped after this filtered test while Cargo continued enumerating
  unrelated integration binaries).
- `cargo clippy -p wasm-vm-slirp -- -D warnings`,
  `cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings`, and
  `cargo clippy -p wasm-vm-cli -- -D warnings`: passed.
- `make web-build`: passed. `npx playwright test tests/e3-t21c-file-transfer-ui.spec.js`:
  2 passed. The generated 100 MiB upload and download each matched SHA-256 with measured heap
  growth below 32 MiB; the browser queues stayed at or below 8 MiB. The same run covered empty
  files, two-flow scheduling, hostile path and bidi names, directory-drop rejection, the
  1,000-file bounded refusal, and explicit partial cancellation.
- In-app browser proof on the rebuilt page: `126 passed, 0 failed`, `126/126` done in 13.1s,
  zero console errors, E3 shows `18/18 proven`, and the accessible Host ↔ Alpine files panel is
  visible. Evidence:
  `e3-t21c-browser-tests.png`
  (`sha256:d2d7cac9aae20db016e0805ed039c6ecf9dcd490707074dafc8e279a4b894751`) and
  `e3-t21c-browser-ui.png`
  (`sha256:2ddfcb4d411e6c632c8720ada1047d948d4b3f6d649f5badbbf548a0b59699b0`).
- Claim: the browser reads uploads and writes downloads incrementally, retains at most 8 MiB per
  browser-side producer/consumer queue, keeps at most two WVFT flows active, hashes without
  whole-file buffering, gates guest downloads on a selected durable directory writer, binds
  cancellation to the exact connection and stream, and never reports completion before the WVFT
  COMPLETE/COMMIT acknowledgement. The browser proof also caught and the implementation removed
  an asynchronous duplicate-writer race that could otherwise truncate a completed download.

### 2026-07-27 — verifier — VERDICT: refuted

- P1 durable download acknowledgement — FAILED. Predicted the guest could not observe WVFT
  `COMPLETE` until the browser's durable writer had successfully closed. Observed
  `BrowserDownloadSink::commit` only marks the in-memory record `committed`
  (`crates/wasm/src/browser_file_transfer.rs:189-202`), after which the protocol service
  immediately emits `COMPLETE` and returns the connection to `Ready`
  (`crates/slirp/src/file_transfer.rs:538-560`). The actual browser
  `writable.write`/`writable.close` operations happen later and can still fail
  (`web/file-transfer.js:254-287`). A cancel in this interval also targets a stream the Rust
  service has already made terminal. Defer protocol completion until the browser writer has
  durably closed, and record a failure/cancellation proof at that boundary.
- P2 cumulative upload boundedness — FAILED. Predicted repeated accepted selections could not
  exceed the advertised bounded queue. Observed the 32-file check applies only to each call while
  every accepted call appends to the shared `uploadQueue` with no cumulative cap
  (`web/file-transfer.js:204-230`); completed UI transfer records and Rust upload records are also
  retained (`web/file-transfer.js:84-99`,
  `crates/wasm/src/browser_file_transfer.rs:282,350-372`). Bound total queued/retained work and
  add a repeated-batch regression.
- P3 download readiness — HELD. `set_download_ready` controls `DownloadManager::accepting`, and
  `open_sink` rejects before allocating a record when no directory has been selected
  (`crates/wasm/src/browser_file_transfer.rs:126-159,253-255`).
- COVERAGE — INSUFFICIENT. The two Playwright tests passed, but both attach a JavaScript mock
  controller (`web/tests/e3-t21c-file-transfer-ui.spec.js:23-75,180-218`), so they never execute
  the new Rust/WASM WVFT adapter or falsify the acknowledgement ordering above. The upload SHA
  assertion compares the UI's precomputed hash to the same value stored by the mock, and the heap
  assertion samples only end-minus-baseline rather than peak growth. Record the real
  guest↔WASM↔File System Access path, independently hash transferred bytes, and sample peak heap.
- SUITE: none promoted while the durable-ack and cumulative-bound refutations remain.

Commands: `git diff --check fc69073..7da3744`; `cargo fmt --all --check`;
`cargo test -p wasm-vm-slirp file_transfer` (14 passed);
`cargo test -p wasm-vm-cli --bin wasm-vm file_transfer_fixture` (1 passed);
`cargo clippy -p wasm-vm-slirp -- -D warnings`;
`cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings`;
`make web-build`; `cd web && npx playwright test tests/e3-t21c-file-transfer-ui.spec.js
--reporter=line` (2 passed). Live rebuilt-page check: the Host ↔ Alpine files region was visible
and browser console errors were zero (favicon 404 only).

### 2026-07-27 — worker — reimplemented at `b939bfc`

- The protocol sink now returns `Durable` or `Pending`. Browser downloads remain in
  `AwaitDurable`, retain their exact connection and stream IDs, and cannot emit `COMPLETE` until
  `FileSystemWritableFileStream.close()` succeeds and the browser explicitly finishes that
  pending transfer. A close failure emits a terminal WVFT error instead.
- Upload admission is cumulative across selections, terminal browser rows are pruned, and terminal
  Rust/Wasm upload records are explicitly dismissed. The repeated-batch regression proves a
  second selection is rejected when it would exceed 32 outstanding files.
- `cargo fmt --all --check`; `cargo test -p wasm-vm-slirp file_transfer`: 15 passed, including
  `pending_sink_withholds_complete_until_durable_finish` and the generated empty/100 MiB case;
  `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`; and clippy with
  `-D warnings` for `wasm-vm-slirp`, `wasm-vm-wasm` (wasm32), and `wasm-vm-cli`: passed.
- `make web-build` passed. The rebuilt fast browser set passed 4/4: generated 100 MiB upload and
  download with sampled peak heap under 32 MiB, repeated-batch bounding, explicit partial
  cancellation, durable-writer failure ordering, and the real Wasm incremental SHA implementation.
- The local chunked image was regenerated from the current agent-bearing rootfs after the first
  proof exposed a stale ignored artifact. `chunk-verify` passed with 4096 manifest entries and 220
  distinct chunks; both the reconstructed chunk stream and
  `releases/rootfs/alpine-rootfs.ext4` hash to
  `85ca0ab8fad742dd0fc54538bc7ea489176dd0ebe78bb6c26a73a34873035e1b`.
- `npx playwright test tests/e3-t21c-real-alpine.spec.js --grep 'real Alpine agent' --trace on`:
  1 passed in 14.5 minutes against the actual Alpine guest, Rust/Wasm adapter, WVFT agent, and
  browser UI. The run proved the OpenRC service was started and a slot was live; independently
  verified the uploaded guest file SHA; observed no guest completion marker while browser
  `close()` was deliberately pending; then released close, observed guest RC=0 and UI completion,
  independently verified the downloaded bytes' SHA, and observed zero console errors.
  Evidence: `web/test-results/e3-t21c-real-alpine-real-A-bde99-OMPLETE-until-browser-close/trace.zip`
  (`sha256:4d7775c83bd5c3022f0abb6148e7f25df45fb14152b34cf58a4652fbb22b9e90`)
  and `e3-t21c-real-alpine-file-transfer.png`
  (`sha256:b057540f3c4f558833131573741eb32973d5296806f4e4898c8f0d14f2c9a80b`).
- Claim: the browser and guest now agree that completion means the selected browser writer closed
  successfully, not merely that all WVFT bytes arrived. The proof executes the real adapter in
  both directions, independently checks both byte streams, and covers the critic's durable-ack,
  cumulative-retention, real-path coverage, and peak-heap findings without changing the previously
  held download-readiness boundary.

### 2026-07-27 — verifier — VERDICT: refuted

- P1 durable acknowledgement — HELD. `COMMIT` now moves a pending browser sink into
  `AwaitDurable` without emitting `COMPLETE`
  (`crates/slirp/src/file_transfer.rs:613-650`); the browser calls
  `finishFileDownload(..., true)` only after `writable.close()` resolves
  (`web/file-transfer.js:277-298`). The submitted real-Alpine trace digest matched
  `4d7775c83bd5c3022f0abb6148e7f25df45fb14152b34cf58a4652fbb22b9e90`;
  its test trace showed no guest RC before close release, then `WVFT_DOWNLOAD_RC=0`, independent
  upload/download SHA matches, and no console errors.
- P2 cumulative admission and retention — HELD. Admission counts all outstanding uploads before
  accepting another selection, terminal rows are pruned, and terminal Wasm upload records are
  dismissed. The rebuilt repeated-batch and sampled-peak-heap acceptance passed.
- P3 download readiness — HELD (carried forward). Its code and dependency boundary are unchanged
  from the prior verifier result.
- P4 close/quota failure stability — FAILED. Predicted a failed durable close would remain one
  terminal error and would never reopen the same destination. The bounded attack observed
  `opens=2`, `finishes=1`, final state `partial`, and dismissal after 250 ms. The catch path removes
  the writer and marks the row `error` (`web/file-transfer.js:307-317`), but the next poll sees the
  same now-`partial` record and unconditionally opens another writer
  (`web/file-transfer.js:257-269,320-339`); `drainDownload` then aborts that second writer,
  overwrites the error with `partial`, and dismisses it (`web/file-transfer.js:299-305`).
  Prevent terminal/error records from reopening, preserve the close/quota error state, and extend
  the committed close-failure test beyond the first transient `error` observation
  (`web/tests/e3-t21c-file-transfer-ui.spec.js:305-365`).
- COVERAGE: the real-Alpine trace covers the repaired happy path through guest, Rust/Wasm, and UI.
  The committed failure test uses a mock and returns at the first transient error, so it misses P4.
- SUITE: no verifier test promoted while P4 remains refuted.

Commands: `git diff --check a8be263..c954ef1`; evidence SHA-256 plus `unzip -t` and trace-step
inspection; `cargo fmt --all --check`; `cargo test -p wasm-vm-slirp file_transfer` (15 passed);
`cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`; clippy with `-D warnings` for
`wasm-vm-slirp` and wasm32 `wasm-vm-wasm`; `make web-build`;
`cd web && npx playwright test tests/e3-t21c-file-transfer-ui.spec.js
tests/e3-t21c-real-alpine.spec.js --grep-invert "real Alpine agent" --reporter=line` (4 passed);
verifier-only close-failure poll attack (expected terminal stability failed: 2 opens, final
`partial`). Live rebuilt page exposed the accessible Host ↔ Alpine files region with zero console
errors. Note: Playwright cleaned the ignored `web/test-results/` output directory when the fresh
acceptance began, so the worker trace archive verified at the start of this session is no longer
present in the checkout; the committed screenshot still matches
`b057540f3c4f558833131573741eb32973d5296806f4e4898c8f0d14f2c9a80b`.

### 2026-07-27 — worker — P4 repaired at `cca71ae`

- A download row in `complete`, `partial`, or `error` is now terminal for browser destination
  ownership: neither `syncDownloads` nor `openDownloadWriter` can reopen it. The failure path
  finishes/cancels the WVFT record, dismisses it once, and preserves the original browser storage
  error.
- The close-failure regression now waits 250 ms beyond the first error (more than ten monitor
  polls) and asserts one destination open, one failed durable finish, one dismissal, and a stable
  `error` label even when the mock deliberately leaves the WVFT record visible.
- `git diff --check`; `make web-build`; and the rebuilt fast browser acceptance set passed 4/4,
  including the strengthened P4 regression and real Wasm incremental SHA.
- Exact-head final evidence:
  `npx playwright test tests/e3-t21c-real-alpine.spec.js --grep 'real Alpine agent' --trace on
  --reporter=line` passed 1/1 in 14.9 minutes. The trace was copied out of Playwright's
  self-cleaning results directory to `rr-traces/e3-t21c-browser-playwright-cca71ae.zip`
  (`sha256:5bc0bff70962954d9462932d0819778d7e1200747cf614927584a0eb87d3a060`).
  The committed screenshot remains `e3-t21c-real-alpine-file-transfer.png`
  (`sha256:b057540f3c4f558833131573741eb32973d5296806f4e4898c8f0d14f2c9a80b`).
- Claim: the critic's P4 retry is closed without changing the P1-P3 boundaries already held. A
  browser storage failure is terminal and stable across later polls, while the refreshed
  exact-head real-Alpine trace re-proves successful durable-close ordering and independent
  upload/download identities.
