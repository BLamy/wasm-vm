DIAGNOSIS: harness-api

This is a readiness diagnosis, not final acceptance. E9-T24 is not marked verified.

## Prediction and result

Before opening v5 evidence I predicted that the visible interior step was valid, but the test
was calling a frontier-only diagnostic at a non-frontier position. That prediction HELD.

The frozen clean head is `ba5e94b2157174dc3d0aa4e60c7a527522de95d6`. The runtime files audited
below are unchanged from the passing v4 head
`9496b8e645eccf5c1a0104bc5dd19a505c429478`; the only behavioral change through the current
head is in `tools/verify/e9-capstone-session-ui.mjs` plus readiness evidence. The supplied v4
top SHA remains `22dafc2e322e67aaaa0fd0c4d3ab2fb7b31783adde9d76d2d0c15a5e3c9039df`.

## Exact failure classification

- The v5 report is SHA-256
  `8a389d3afcf481caf11768b67c0dbf838022d3c80a45737fd56ef48d7fe660f3` and is clean-head,
  zero-error/zero-blocked evidence (`report.json:3-5,207-208`). Its internal failure is exactly
  `InvalidPlan` at transition `20001`, retired `19981`, sequence/event index `8`, before:0,
  with `replay predecessor is not complete and private` (`report.json:211`).
- Immediately before the step, Playwright trace call `call@2209` returned the immutable point-1
  state at transition `20000`, retired `19980`, sequence `8`, digest
  `5dc014f4a8c02e0dd4d3cd095c16be3664b6f134ad278fc3ea08286ec12bec12`, and exactly 7,756
  bytes whose SHA-256
  `772726071b16d0db73b03f5430bb9f3cbcb44389f6abce65f158045f6fcc8c20` matches
  `source-2.state` byte-for-byte (`failure-trace.zip` SHA-256
  `5ddd637ac8be7f0a83f473f5b2f65789307b3901c3002f577bc8b6ce66e78532`, internal
  `trace.trace:107,110`; frozen source report `paged-gpu/report.json:1184-1193`). The recorded RAM
  digest at that point is
  `091aeeda8d6787fbe94fce9b54cc790216e27627b7a4f020442a71b6456d5729`.
- `call@2213` resolved and clicked the visible enabled `Step forward` button; `call@2217` settled.
  The post-step UI snapshot published transition `20001`, retired `19981`, sequence `8`, before:0,
  digest `94dab4f9bdd6e8fb570a13fa126ba33d79892ef3d17d21165979d8f8c58af45c`, with
  `pending:false` and status `Replay restored` (`trace.trace:112-133`; `report.json:214-231`).
  The failing `call@2331` happened only afterward, inside the harness capture expression
  (`trace.trace:134,137`). The selected state remained published and unchanged in `call@2333`
  (`trace.trace:141`). This is not evidence of broken stepping or publication.
- The erroneous API choice is current harness line 52: every GPU capture calls
  `controller.inspectSelected()`. That worker first obtains the selected state and queues but then
  unconditionally calls `machine.exactReplayFrontier()`
  (`web/session-gpu-replay-worker.js:210-222`). Rust defines that receipt as the predecessor only
  after the entire admitted replay plan has completed: status completed, all event and witness
  cursors exhausted, position equal to plan end, and ingress private
  (`crates/core/src/session_replay.rs:720-733`). Transition `20001` is a valid selected point inside
  the `20000..60000` authenticated window, not that window's end. Refusal is therefore the intended
  frontier guard, not a replay divergence.

## Interior capture route

Using `captureSelectedBranch().capture.native` **only for the GPU `source-step` and `import-step`
captures is valid** and is the correct public source-capture boundary:

- The controller admits it only when the selected point advertised continuation readiness and no
  request is active, then rechecks selection identity, position, rendered console, cancellation and
  request identity before resolving (`web/session-gpu-replay.js:38,50-71`). This is the same API
  consumed by the shipped GPU continuation constructor (`web/session-gpu-branches.js:48-50`).
- The replay worker requires `machine.canContinueExactBranch()`, a healthy renderer and
  `renderer.checkpointReady()`, saves the physical renderer, rechecks epoch/position/selection, then
  calls `captureExactBranch` (`web/session-gpu-replay-worker.js:191-207`). It also requires the
  returned position to equal the selected position and the returned `sourceDigest` to equal the
  published selected digest (`:200-201`). Thus the recorded RAM/state digest binding is retained;
  no caption is trusted.
- Rust repeats the guards. `canContinueExactBranch` requires an admitted exact replay driver and
  `Machine::can_capture_recording_branch` (`crates/wasm/src/session_replay.rs:365-377`). The latter
  requires replay-private ingress, an active replay limit, exact device/network/source replay,
  before-phase position and, for GPU, no pending command
  (`crates/core/src/lib.rs:3466-3481`; `crates/core/src/session_gpu/checkpoint.rs:115-124`).
  `captureExactBranch` repeats these checks and rejects mismatched GPU profile, oversized queues,
  stopped GPU or non-branchable state (`crates/wasm/src/session_replay.rs:380-415`).
- The returned `capture.native` is a restorable branch image, not the smaller logical inspection
  witness. It serializes CPU and RAM (`crates/core/src/lib.rs:3502-3507,3762-3771`), native devices
  and exact session adapters (`:3772-3823` and subsequent device sections), and the GPU result
  frontier sealed to the saved renderer digest (`:3892-3922`). Exact-session overlay blocks are
  owned by the native `SESSION_DEVICES` section; the ancillary disk delta carries the accepted
  base/generation binding (`crates/wasm/src/session_checkpoint.rs:39-62`). The source digest is the
  domain-separated logical GPU witness plus the current RAM digest
  (`crates/core/src/lib.rs:3658-3670`). Therefore the right assertions are source/import byte parity
  for `capture.native` and `capture.sourceDigest == active.digest`; the native blob's SHA-256 must
  not be asserted equal to the active digest.
- This route preserves failed-job guards. A failed/unproved GPU transport completion permanently
  makes the renderer checkpoint unavailable (`web/renderer/virgl-command/checkpoint.mjs:108-123,
  152-164`), so branch capture cannot use it. Pending GPU commands also fail closed in both JS and
  Rust.

## Final frontier must remain inspection-only

Do not change the final GPU capture to branch capture and do not manufacture a checkpoint. The
fixture deliberately ends after an expected failed GPU command: the frozen report records one
failed submission, `Object 999 is not public in this subcontext`, and checkpoint reason
`a GPU job failed or has an unproved applied prefix`
(`paged-gpu/report.json:11122,11261-11265,12302`). Consequently the public continuation guard is
correctly false at final state. `inspectSelected()` remains appropriate there because the complete
whole-chain replay satisfies `exactReplayFrontier`; renderer saving is optional in inspection
(`web/session-gpu-replay-worker.js:213-221`). The passing v4 report already matched the final 8,047
state bytes to SHA-256
`a4cd6fdbdaa427e805a6a68a0e98822a2537651c7f6f27dda316ab837c47ae79` at transition `690000`,
sequence `38`, digest `6c6e1481ca2a76ea72e9de7def6ca757006cf3c5fabf334a6468ec1975f03a0c`.

## Precise recommendation

Make a test-only correction in `retainNative`:

1. Keep `inspectSelected().state` for GPU `*-middle` (the immutable recorded witness/window end)
   and `final` (the complete frontier with the deliberate failed renderer job).
2. For GPU `source-step` and `import-step` only, call `captureSelectedBranch()`, retain
   `capture.native`, and explicitly assert the capture position and hex `capture.sourceDigest`
   equal the active position/digest. Keep the existing source/import native-byte SHA parity and
   pixel parity.
3. Record only a bounded GPU source/import follow-up. Add/use a GPU-only harness selector if needed;
   carry the v5 software HELD results forward and do not rerun software, boots, Omarchy, replay-full,
   or performance work.

No runtime implementation repair, frontier weakening, private-ingress relaxation, failed-job
exception, new final checkpoint, or recording mutation is warranted. A fresh bounded GPU result is
still required after the test-only correction; this diagnosis itself is not T24 verification.
