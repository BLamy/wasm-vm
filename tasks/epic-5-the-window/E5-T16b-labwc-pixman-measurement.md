---
id: E5-T16b
epic: 5
title: Measure labwc with the pixman renderer inside the emulator
priority: 516.2
status: implemented
depends_on: [E5-T16a]
estimate: S
risk: medium
capstone: false
---

## Goal

Bring up labwc as the first T16 finalist on a throwaway Alpine riscv64 image and record an honest
end-to-end result from cold start through the shared desktop workload.

## Boundary

This slice owns only the labwc candidate bring-up and its capture. It does not compare candidates,
audit the final package set, or select the desktop stack.

## Deliverables

- A scripted scratch-image bring-up using `WLR_RENDERER=pixman` and the existing DRM/virtio-gpu
  path, with no fallback to a failed GL attempt.
- The T16a workload result for cold start, idle, opening foot (or the documented terminal
  fallback), 100 typed characters, a 300 px drag, and close.
- Captured guest-instruction, upload-byte, RSS, idle-wakeup, wall-time, and cursorq observations,
  plus the exact image/package/config inputs needed to replay the run.

## Acceptance criteria

- The compositor, window manager, terminal, and workload all run end-to-end inside the emulator;
  the result contains numbers for every required metric and no extrapolated finalist row.
- The renderer selection is recorded as pixman, the idle interval is explicit, and any idle cost
  above 2% of guest instructions is either absent or justified as required by the T16 charter.
- The typing result records bytes uploaded during the 100-character phase and the capture shows
  cursorq traffic when labwc claims/usefully exercises the hardware cursor plane.
- The result is linked to the exact scratch-image manifest and passes the T16a schema checks.

## Verification command

`make verify-E5-T16b`

## Adversarial verification

Inspect the compositor command line and renderer diagnostics before trusting the numbers. Force
the scripted workload through a clean cold boot, repeat the drag and typing phases, and verify
that a missing cursorq event is reported as a capability gap rather than silently inferred from
labwc's configuration. A GL failure followed by a pixman measurement without the pixman setting
being visible is a refutation.

## Verification log

### 2026-09-04 — worker — IMPLEMENTED

- Implementation/evidence commit: `0a7455ce68e7780adc421647f6ca483344417b6f`.
- Submission commands (the expanded `make verify-E5-T16b` gate): `cargo fmt --check -p
  wasm-vm-core -p wasm-vm-cli`; GPU-trace clippy for core and CLI with `-D warnings`; native
  core library, `virtio_gpu_machine`, and CLI tests; `cargo build --release -p wasm-vm-cli
  --features gpu-trace`; both Node syntax checks; `bash tools/build-labwc-scratch.sh`; the exact
  native capture command `node tools/display-server-workload.mjs run --image
  target/e5-t16b/labwc-image/alpine-rootfs.ext4 --output evidence/e5-t16b/labwc-capture.json --
  node tools/run-labwc-pixman.mjs`; and `node tools/verify/e5-t16b-labwc-pixman.mjs --capture
  evidence/e5-t16b/labwc-capture.json`.
- Native gates passed: 267 core tests, 4 virtio-GPU integration tests, 53 CLI tests, release
  build, image fsck, signed package-lock validation, and foreign-ELF scan.
- Evidence: capture [`evidence/e5-t16b/labwc-capture.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t16b/labwc-capture.json),
  SHA-256 `3aaf96d67891ae4a2b5569e77248511043f9f097ffcf508293f1c82390a1ad32`; replay summary
  [`evidence/e5-t16b/labwc-run.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t16b/labwc-run.json),
  SHA-256 `4874fa730377e73d8513cb1c1821bb6fb38010673290ad267b1a35cc54c3e81d`; verifier result
  [`evidence/e5-t16b/labwc-verification.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t16b/labwc-verification.json),
  SHA-256 `4a9bdb0ffc93d979edf49b91b995fc6fa6b9cd153765afb89a625a8f92f9f589`.
- The exact input image was bound before boot as `fd5e1a4d93458ded651d4fc243318d754f1911960e1bd3796a7cfdfa4e43661a`,
  with package manifest SHA-256 `21e2f121ae14deecc6efcfd50a843f04f355d148bc3fdfea80a0da090c6f0383`
  and file manifest SHA-256 `de0762c635675db5c00fbc5281fb73c594b1d94b4d66ec4814e71cc20c3a0b40`.
  The post-run image digest is retained separately because OpenRC mutates the guest ext4 during
  boot. Console, guest evidence, and GPU trace are recorded in the same summary.
- Claim: the native riscv64 guest ran labwc on the DRM backend with `WLR_RENDERER=pixman`,
  created a foot window, completed all six ordered T16a phases, typed exactly 100 characters in
  200 accepted keyboard frames, dragged exactly 300 px in 30 steps/32 accepted tablet frames,
  exited both application and compositor, and powered down cleanly. The capture reports a
  2,799 ms idle interval at 0.4568% of total guest instructions, cumulative typing upload bytes
  of 0 for this run (the required field is present and not extrapolated), and zero cursorq events
  explicitly classified as `capability-gap: labwc submitted no cursorq chain during this run`.
  Scope is the native emulator only; independent machines, WebKit, and host rr are waived per
  the task/session instructions.
