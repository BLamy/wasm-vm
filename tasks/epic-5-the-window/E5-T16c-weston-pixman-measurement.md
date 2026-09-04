---
id: E5-T16c
epic: 5
title: Measure weston with the pixman renderer inside the emulator
priority: 516.3
status: implemented
depends_on: [E5-T16b]
estimate: S
risk: medium
capstone: false
---

## Goal

Bring up weston as the second T16 finalist on a throwaway Alpine riscv64 image and record the
identical end-to-end workload under weston's software pixman renderer.

## Boundary

This slice owns only the weston candidate bring-up and its capture. It does not change the shared
workload contract, choose a winner, or publish the final decision.

## Deliverables

- A scripted scratch-image bring-up using `weston --backend=drm --renderer=pixman` on the
  emulator's DRM/virtio-gpu path, with renderer diagnostics captured.
- The same T16a workload result: cold start to idle, terminal launch, 100 typed characters,
  300 px drag, close, and all required guest/host counters.
- Evidence containing the exact command line, image manifest, renderer, phase markers, upload
  bytes, peak RSS, idle wakeups/s, and any cursorq observations.

## Acceptance criteria

- Weston completes every workload phase inside the emulator with actual measured values; the
  result is schema-valid and directly comparable to E5-T16b.
- The capture proves pixman was active and does not count a GL startup failure, a host-native run,
  or an extrapolated row as the weston measurement.
- Idle instruction cost, typing upload bytes, peak RSS, and idle wakeups/s are explicitly present;
  an idle cost above 2% is disqualified or justified in the eventual decision inputs.
- The weston result is reproducible from its committed scratch-image/config manifest and passes
  the shared T16a phase and counter checks.

## Verification command

`make verify-E5-T16c`

## Adversarial verification

Check the weston command line and startup log for `--renderer=pixman`, then repeat the typing and
drag workload after a cold reset. Remove the renderer flag in a test copy and ensure the harness
rejects the result instead of accepting a possibly-GL or failed-start capture. Verify all damage
bytes come from T09 counters for this run.

## Verification log

### 2026-09-04 — worker — IMPLEMENTED

- Implementation commit: `b658d3cc62ffc8b2150eab0262526a46c2bb606c`.
- Exact-head command: `make verify-E5-T16c`.
- The gate passed `cargo fmt --check`, clippy for core and CLI with `gpu-trace`, 267 core
  library tests, 4 GPU integration tests, 54 CLI tests, the release CLI build, Node syntax
  checks, and a fresh signed Alpine riscv64 Weston scratch image containing 194 packages.
- The native emulator workload passed all six shared phases in order: cold-start, idle,
  open-terminal, type-100, drag-300, and close. The final capture reports Weston DRM with
  the Pixman renderer, foot, and wl-clipboard; 100 typed characters / 200 frames / 0 rejected,
  a 300 px x-axis drag over 30 steps / 32 frames / 0 rejected, 5,332,024,187 retired guest
  instructions, 18,612,224-byte peak RSS, 427 idle wakeups (149.663/s), 36,864,000 typing
  upload bytes, and a 0.3638% idle instruction ratio. The capture records the expected
  capability gap of zero cursorq chains for this Weston run.
- Renderer evidence is bound to `E5T16C_LAUNCH weston --backend=drm --renderer=pixman`
  and `Using Pixman renderer`; the verifier rejects a 3% idle-budget mutant and a console
  capture with all ` --renderer=pixman` flags removed. The image was unchanged by the guest
  run except for the expected runtime filesystem state, with pre-run image digest
  `9176a631e0b2d572f2cb87dde5a8e6916ecca60d4829afb8f1eef6045b92e382` and post-run digest
  `d57ce5bf2d9cb68b20ba7df381703090024634fd7db633772e2690d60a57a80e`; package manifest
  digest `225b8d35f7375c084075ca60edac5ea8fbf7ef46f1fd09a7e3a5d40bb074aae1` and file
  manifest digest `b2b4964035b5a348be808afddc83b91d007c5cb3e5fbfcf1854b6f85d5d51552`.
- Evidence files and SHA-256 digests: `evidence/e5-t16c/weston-capture.json`
  (`9cba30d5c916a1c263e32dcc68284a2dbef4449fe06119ec8408b799c18da30b`),
  `weston-run.json` (`9b87ab0f1c8ab15a2cb6c2d4a48feba5892e9b4f887b87ee1fc7bc944f972aa9`),
  `weston-verification.json` (`319f68b2179173368d171bc9255751d0a666841aea0f5c7ce45fcc98d1707df0`),
  `weston-console.log` (`74345c4bdc226284dfbc9bfe2a1ddb4b9a91115bfec27d85b79413373e17c6b0`),
  `weston-stderr.log` (`b0f127518f241359279976b1a2665ea69cad9bc2b9e7abd11b33ee41a0a0f11b`),
  `weston-guest-evidence.txt` (`e3a7c159faafb2736c3b87bc3b2d0ee0e5126bf8a5bf048769d83bf2ece0c8ae`),
  and `weston-gpu-trace.log` (`a07aea671a61945a0c754816aa1f63125551e47a3cba03cf38012f424584d3b2`).
- This is an emulator-only, guest-evidence submission as scoped by the task and user; no
  independent-machine or WebKit leg was added.
