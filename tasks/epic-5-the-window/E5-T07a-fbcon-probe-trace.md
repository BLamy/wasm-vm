---
id: E5-T07a
epic: 5
title: Guest virtio-gpu fbcon probe and command trace
priority: 507.1
status: verified
depends_on: [E5-T03c, E5-T05c, E5-T06d]
estimate: S
risk: high
capstone: false
---

## Goal

Prove the rebuilt Linux graphics stack drives the production virtio-gpu control queue through its
fbcon probe and initial framebuffer setup, with a deterministic native command trace that the later
browser slices can compare.

## Boundary

This slice owns guest-facing command tracing and the native first-light probe harness. It does not
own browser canvas layout, tty input, VT stress, or WebKit/independent-machine coverage.

## Deliverables

- A feature-gated virtio-gpu command-sequence trace that records command type, response, scanout,
  resource dimensions, and queue progress without changing the null-sink semantics.
- A native kernel boot/probe capture and checked-in `tests/fixtures/gpu-probe.log` (or an equivalent
  canonical trace fixture) covering display info/EDID, resource creation/backing, scanout binding,
  transfer, and flush.
- Regression assertions that malformed or unsupported probe traffic still makes queue progress.

## Acceptance criteria

- Native boot reaches a live virtio-gpu controlq and records the expected Linux probe sequence in
  order, with no queue stall, reset loop, or duplicate completion.
- The trace contains the first valid framebuffer resource dimensions and at least one transfer plus
  flush, while the null sink remains side-effect free beyond the trace.
- The exact acceptance command succeeds from the checked-in kernel/artifact inputs.

## Verification command

`make verify-E5-T07a`

## Adversarial verification

Run the probe with the control queue delayed at each command boundary and with one malformed
descriptor in each request class. The guest must continue making progress or report the specified
error, and the trace must never claim a flush that did not publish a used-ring entry.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- **Linux control-queue protocol — HELD.** Predicted that the native guest would complete the
  Linux virtio-gpu probe without resource-id errors once the wire enum and EDID response layout
  matched the virtio-gpu specification. The final trace records `GET_EDID`, `GET_DISPLAY_INFO`,
  `RESOURCE_CREATE_2D`, `RESOURCE_ATTACH_BACKING`, `SET_SCANOUT`, `TRANSFER_TO_HOST_2D`, and
  `RESOURCE_FLUSH` with the corrected command values (`0x10a`, `0x100`, `0x101`, `0x106`, `0x103`,
  `0x105`, `0x104`), a 1056-byte EDID response, and successful response values. The earlier
  invalid-resource loop and EDID warning are absent from the final console.
- **Framebuffer first light — HELD.** Predicted a live fbcon path would expose the display mode,
  create and attach resource 2 at `1280x800`, bind scanout 0, transfer pixels, and flush at least
  once. The 15-record trace contains that complete path, with transfer and flush returning
  `RESP_OK_NODATA`; the native console contains both `fb0: virtio_gpudrmfb frame buffer device`
  and `busybox userland up`.
- **Queue progress and trace integrity — HELD.** Predicted every recorded completion would be
  published before tracing, with no dropped records, duplicate completion, stall, or reset. The
  trace reports `records=15 dropped=0`; sequence numbers are contiguous 0–14 and every record has
  `used == avail` at the corresponding one-based index. The process exited 0 at the profiler's
  `userland up` marker.
- **Malformed/unsupported traffic — HELD.** The feature-gated malformed-request regression and
  the complete `wasm-vm-core` feature suite passed; `virtio_gpu_malformed_requests_make_progress_and_recover`
  confirms an unsupported request and short/malformed traffic still publish completions and recover.
- **Coverage — SUFFICIENT.** The exact native run exercised the corrected wire constants, feature
  gate, trace metadata, used-ring publication boundary, display/EDID/resource/scanout/transfer/
  flush handlers, CLI recorder, checked-in fixture, and null-sink boot path. No changed behavioral
  hunk is dead or unproved. Independent machines, WebKit, and host-layer rr are excluded per the
  user's direction and the repository evidence policy.
- **SUITE:** retain `make verify-E5-T07a` and `tests/fixtures/gpu-probe.log` as the recurring proof.

Commands: `make verify-E5-T07a`; `cargo test -p wasm-vm-core --lib`; `cargo test -p wasm-vm-core
--test virtio_gpu_machine`; `cargo test -p wasm-vm-cli --bin wasm-vm`; `git diff --check`.

Implementation commits: `5ada0faa4b235fed3cd7c34ec56e1ea31c266088`,
`bd1d81f575c8dacc8527183c5b33222ae3b0030a`.
Evidence: `evidence/e5-t07a/gpu-probe.log` and `tests/fixtures/gpu-probe.log` SHA-256
`06eff203f10b1583a4c4450a6e20ff56792a25b70402a22ebeaf03f62d5f4e0b`; `guest-evidence.txt` SHA-256
`9f867cc341862e94c6edd047096c75af9150821127d1ec7ce113ef3f0630e2c9`; `native-console.log` SHA-256
`bcc49cd35bef178d02042dfebf13c3c6d768ecab788a402c853630e2fd03a8e4`; `native-stderr.log` SHA-256
`4c269be1a992ef5f106eec7f8e36e634dddce41df4f08c924959f5e0b098adb6`.
