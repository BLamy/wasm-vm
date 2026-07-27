---
id: E3-T21c
epic: 3
title: Streaming browser upload/download UI
priority: 321.3
status: in-progress
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
