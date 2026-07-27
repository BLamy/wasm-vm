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
