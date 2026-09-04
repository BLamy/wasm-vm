---
id: E5-T16b
epic: 5
title: Measure labwc with the pixman renderer inside the emulator
priority: 516.2
status: verified
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
  SHA-256 `eee185e7ccfd76ea56597a9361da7974f9bda80cce6987eccba5903c578f62fb`.
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

### 2026-09-04 — verifier — VERDICT: refuted

- P1 renderer provenance — HELD. Predicted that a clean native riscv64 boot would expose the
  compositor command and renderer diagnostics before the workload was credited. The fresh local
  `make verify-E5-T16b` run passed, and its saved console shows
  `E5T16B_LAUNCH WLR_BACKENDS=drm WLR_RENDERER=pixman`, wlroots loading `pixman`, and creating the
  pixman renderer (`/tmp/e5-t16b-fresh-run/labwc-console.log:308-331`); no GL renderer token was
  present. The committed capture also has the same renderer proof at
  `evidence/e5-t16b/labwc-console.log:309-332`.
- P2 end-to-end workload and counter provenance — HELD. Predicted six ordered passed phases,
  explicit counters, exact typing/drag shapes, clean exits, and a guest power-down. The committed
  capture records the ordered markers and all phase counter points
  (`evidence/e5-t16b/labwc-capture.json:79-213,216-243`); the console records labwc/foot start,
  both exits, and `reboot: Power down` (`evidence/e5-t16b/labwc-console.log:423-458,597`). The
  fresh repeat independently passed with image digest `e236ad222b666bc30fe82172ba6921be8a59cb851984095b4fcbf5a5c6ce7cc5`,
  idle ratio `0.004513443843453826`, 100 characters/200 keyboard frames, 300 px/30 drag steps,
  and zero rejected events (`/tmp/e5-t16b-fresh-run/labwc-capture.json:79-243`).
- P3 cursorq capability accounting — HELD. Predicted zero cursorq traffic would be reported as a
  capability gap rather than inferred from configuration. The capture reports
  `cursorqEvents: 0` and `cursorqStatus: capability-gap: labwc submitted no cursorq chain during
  this run` (`evidence/e5-t16b/labwc-capture.json:216-227`), while the GPU trace has
  `records=88 dropped=0` (`evidence/e5-t16b/labwc-gpu-trace.log:1-2`). The fresh repeat preserved
  the same explicit gap (`/tmp/e5-t16b-fresh-run/labwc-capture.json:216-227`).
- P4 worker evidence digest — FAILED. Predicted the SHA-256 written in the worker Verification log
  would equal the committed verifier artifact. The worker claims `4a9bdb0ffc93d979edf49b91b995fc6fa6b9cd153765afb89a625a8f92f9f589`
  (`tasks/epic-5-the-window/E5-T16b-labwc-pixman-measurement.md:72-74`), but
  `shasum -a 256 evidence/e5-t16b/labwc-verification.json` returns
  `eee185e7ccfd76ea56597a9361da7974f9bda80cce6987eccba5903c578f62fb`, matching the committed
  artifact, not the claim. Correct the digest claim and re-record the verification metadata.
- P5 idle-budget enforcement — INSUFFICIENT. Predicted a bounded capture with idle cost above the
  2% charter budget would be rejected or require an explicit justification. A temporary mutant
  changed only the idle and subsequent guest-instruction points, producing
  `instructionRatio=0.027472537533482798` in `/tmp/e5-t16b-verifier-42634/evidence/e5-t16b/labwc-verification.json:19-24`.
  `node /tmp/e5-t16b-verifier-42634/tools/verify/e5-t16b-labwc-pixman.mjs --capture /tmp/e5-t16b-idle-budget-attack.json`
  nevertheless exited 0 with `E5T16B_VERIFIED`; the verifier only checks finiteness at
  `tools/verify/e5-t16b-labwc-pixman.mjs:43-46` and never enforces `<=2%` or a justification. Add
  the budget assertion and a regression mutant, then rerun the acceptance gate.
- COVERAGE — HELD for the current happy path. `make verify-E5-T16b` passed formatting, GPU-trace
  clippy, 267 core tests, 4 virtio-GPU integration tests, 53 CLI tests, release build, scratch
  image fsck/package/file-manifest checks, native capture, and the task verifier. `make
  verify-E5-T16a` passed its 6/6 contract suite in the detached scratch checkout. The display
  workload, GPU cursor counter, scratch profile, schema normalization, and task verifier hunks
  were exercised by these runs; the verifier gap and stale digest prevent promotion to verified.
- SUITE: n/a until P4/P5 are fixed and re-recorded. Independent machines, WebKit, and host rr were
  not run, per the explicit session waiver and repository policy.

Commands: `make verify-E5-T16b`; `make verify-E5-T16a` in `/tmp/e5-t16b-verifier-42634`;
`shasum -a 256 evidence/e5-t16b/*`; `node /tmp/e5-t16b-verifier-42634/tools/verify/e5-t16b-labwc-pixman.mjs
--capture /tmp/e5-t16b-idle-budget-attack.json`; and `git diff --name-status
0a7455ce68e7780adc421647f6ca483344417b6f a5112cc68883f17c4dc3e8fe8276e0495169bd4a`.
No implementation code, harnesses, fixtures, or repository evidence remain modified by
verification; only this log/status and its generated metadata are to be committed.

### 2026-09-04 — worker — REWORK SUBMITTED

- Rework commit: `0c2c83fd2ce73ff6f17d36904aff2a6ef6a6dee4`. The verifier now rejects any idle
  instruction ratio above the task's 2% budget unless a future task-specific justification is
  added, and `--self-test` mutates a valid capture to a 3% idle ratio and requires rejection.
- Corrected the previous worker metadata typo from `4a9bdb0ffc93d979edf49b91b995fc6fa6b9cd153765afb89a625a8f92f9f589`
  to the actual committed verifier artifact SHA-256 `eee185e7ccfd76ea56597a9361da7974f9bda80cce6987eccba5903c578f62fb`.
  The runtime implementation and recorded guest evidence are unchanged by this verifier-only fix.
- Incremental commands: `node --check tools/verify/e5-t16b-labwc-pixman.mjs`; `node
  tools/verify/e5-t16b-labwc-pixman.mjs --capture evidence/e5-t16b/labwc-capture.json`; and the
  same command with `--self-test`. The fresh critic's native `make verify-E5-T16b` happy path
  already passed on the unchanged runtime/evidence head.
- Claim: the committed labwc/pixman capture still proves all six native riscv64 workload phases,
  and the verifier now enforces the idle budget that the critic's bounded mutant exposed. No
  independent-machine, WebKit, or host-rr leg is included, per scope.

### 2026-09-04 — verifier — VERDICT: verified

- P1 renderer provenance — HELD. Predicted that the unchanged committed guest evidence would
  still show an explicit DRM launch with `WLR_RENDERER=pixman`, pixman diagnostics, and no GL
  fallback. The prior fresh native `make verify-E5-T16b` result remains applicable: the runtime and
  evidence boundary is unchanged, confirmed by an empty `git diff --quiet
  0a7455ce68e7780adc421647f6ca483344417b6f 010539884613afb92a5e3c41623c45b0d019018e -- src
  crates tools/display-server-workload.mjs evidence target`; the committed console proof is at
  `evidence/e5-t16b/labwc-console.log:309-332` and the verifier enforces it at
  `tools/verify/e5-t16b-labwc-pixman.mjs:86-92`.
- P2 workload and metric acceptance — HELD. Predicted that all six ordered T16a phases, terminal
  and compositor exits, power-down, explicit metric fields, 100 accepted characters/200 keyboard
  frames, and 300 px/30-step drag would remain valid. The prior fresh native gate held this claim;
  the unchanged capture records the phase points at
  `evidence/e5-t16b/labwc-capture.json:79-243`, and the current verifier passed against a temporary
  mirror of that exact capture with `node tools/verify/e5-t16b-labwc-pixman.mjs --capture ...`.
- P3 cursorq capability accounting — HELD. Predicted zero cursorq traffic would remain an explicit
  capability gap rather than an inferred success. The unchanged capture has
  `cursorqEvents: 0` and `cursorqStatus: capability-gap: ...` at
  `evidence/e5-t16b/labwc-capture.json:216-227`; the current guard remains at
  `tools/verify/e5-t16b-labwc-pixman.mjs:96-100`.
- P4 corrected worker digest — HELD. Predicted the corrected metadata would equal the committed
  verifier artifact. `shasum -a 256 evidence/e5-t16b/labwc-verification.json` returned
  `eee185e7ccfd76ea56597a9361da7974f9bda80cce6987eccba5903c578f62fb`, matching the claim at
  `tasks/epic-5-the-window/E5-T16b-labwc-pixman-measurement.md:72-74`.
- P5 idle-budget guard and regression self-test — HELD. Predicted the valid capture’s ratio would
  be accepted below 2%, while a 3% mutant would be rejected. In temporary mirror
  `/tmp/e5-t16b-current-verifier.7Unot0`, the normal command passed with ratio
  `0.0045681757501264825`; `--self-test` passed with
  `E5T16B_SELF_TEST=idle-budget-rejected`. The guard and self-test are exercised at
  `tools/verify/e5-t16b-labwc-pixman.mjs:17,46-67,154-167`, and the committed output records
  the same ratio and `budget: "<=2% unless charter justification"` at
  `evidence/e5-t16b/labwc-verification.json:19-24`.
- Bounded novel artifact-binding attack — HELD. Predicted tampering the recorded run’s capture
  image digest would be rejected. After changing only the temporary mirror’s
  `evidence/e5-t16b/labwc-run.json:capture.image.sha256` to all zeroes, the current verifier exited
  status 1 with `run summary capture digest disagrees with the harness` at
  `/tmp/e5-t16b-current-verifier.7Unot0/tools/verify/e5-t16b-labwc-pixman.mjs:104`.
- COVERAGE — HELD. The prior native happy path and T16a schema evidence carry forward because
  runtime/evidence hashes and dependency boundaries are unchanged. The new budget branch and
  self-test branch were directly executed in the temporary mirror; the added Makefile line is
  declarative wiring for that exact self-test command and was inspected at `Makefile:723-724`.
  No acceptance-bearing changed hunk remains unexecuted or unexplained.
- SUITE — HELD. The committed `--self-test` mutant is a permanent regression check for the prior
  verifier gap; no implementation code, harness, fixture, or repository evidence was modified by
  this verification.

Commands: `git rev-parse HEAD`; `git diff --name-status` and the runtime/evidence boundary check
above; `shasum -a 256 evidence/e5-t16b/labwc-verification.json evidence/e5-t16b/labwc-capture.json
evidence/e5-t16b/labwc-run.json target/e5-t16b/labwc-image/MANIFEST.txt
target/e5-t16b/labwc-image/FILE-MANIFEST.txt`; `node --check
tools/verify/e5-t16b-labwc-pixman.mjs`; normal and `--self-test` verifier runs in
`/tmp/e5-t16b-current-verifier.7Unot0`; the temporary artifact-binding mutation and verifier run
there; and static inspection of `0c2c83f`/`0105398` plus `git diff --stat
0a7455ce68e7780adc421647f6ca483344417b6f 010539884613afb92a5e3c41623c45b0d019018e`. Per the
explicit session waiver, no independent machine, WebKit, rr, or `ssh dev` run was performed.
