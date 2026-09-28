# E5.5-T03av independent verifier

**VERDICT: verified — diagnostic claim only. Desktop responsiveness remains
unsolved.**

The critic read the task and wrote predictions before inspecting the recorded
pixels (`PREDICTIONS.md` and `INDEPENDENT-PREDICTIONS.md`). The reviewed source
head is `3055f67a5d768ab34f93d7de291bed713cbb5e9f`. The actual recording and
all verifier results are under this directory and
`../display-late-response-r1/`.

## Predictions and observations

- **Provenance — HELD.** `check-recording.mjs` independently binds the frozen
  helper objects, 96 served resources, AR kernel/snapshot/delta/manifest, and
  the exact AT WASM SHA-256
  `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`.
  The source/runtime identity is unchanged from AU/AT.
- **Original product result — HELD.** The independent raw-wire audit finds 128
  trusted physical events and 256 successful input acknowledgements. Nonce
  `8cba0584ecd1cdbb` is read from
  `/tmp/desktop-keys-1e16e6e66e53bbb8` at `2026-09-17T00:09:11.173Z`,
  83.672 seconds after Enter, inside the unchanged 120-second readback budget.
  The original screenshot is captured at `00:09:27.537Z`, 100.036 seconds
  after Enter, and remains the old empty prompt with SHA-256
  `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
  `desktopAcceptance` remains false.
- **Single continuation deadline — HELD.** Observation starts 4 ms after the
  original capture, uses one 180,000 ms deadline, captures offsets
  0/40,000/80,000/120,000/160,000 ms, finishes after 160.247 seconds, and
  cleanup completes in 1.071 seconds. The original product timestamps/result
  are preserved. The final retained observer is disposed with 14 frames seen,
  6 evicted, 8 retained, and 14 events.
- **No new stimulus — HELD.** The independent traffic audit finds no
  `serial-input` or `input-request` after the continuation begins and no
  `sendAgentInput` at any point. The continuation performs only host-side
  observation and screenshots; the physical nonce/readback remains the one
  original trial.
- **Checkpoint binding — HELD.** Every checkpoint has matching latest frame,
  sequence, received/presented counts, zero pending presentation, and a frame
  timestamp no later than its screenshot. The three-mode bounded attack rejects
  a pending frame, a changed present count, and a screenshot that overruns the
  absolute deadline (`checkpoint-attack.json`).
- **Pixel relation — HELD.** `check-recording.mjs` decodes the PNGs with its
  independent decoder and converts each saved format-2 BGRX buffer without
  importing the recorder's converter. Worker-to-canvas and PNG-to-canvas
  comparisons have zero changed bytes and zero changed pixels at all five
  checkpoints. The 40-second checkpoint changes only a 221-pixel cursor region;
  the 80-second checkpoint changes 3,033 pixels at x=28..641, y=52..85.
- **Late visibility — HELD as a bounded measurement.** The first changed
  terminal-content frame is sequence 8 at `00:10:16.742Z`, 149.241 seconds
  after Enter and about 49.2 seconds after the original capture. The first
  saved screenshot that visibly shows the typed command and returned prompt is
  the +80,000 ms continuation image; +120,000 ms and +160,000 ms are identical.
  Personally inspected PNGs confirm that +0 and +40 seconds remain the empty
  prompt while +80/+120/+160 show
  `printf '8cba0584ecd1cdbb' > /tmp/desktop-keys-1e16e6e66e53bbb8` and the
  returned prompt. This establishes late rendering only; it cannot satisfy the
  original 20-second product capture.

## Coverage

The actual run exercises the late-probe installation, five checkpoint captures,
absolute deadline, file ownership, gzip/hash writes, cleanup, and the wrapper
and audit flags. The independent recording audit covers every changed
behavioral path and source identity. The focused acceptance set passes **51/51**
tests with a permitted temporary local HTTP listener. The three checkpoint
attacks pass. Declarative receipt fields and comments are bookkeeping; carried
AU observer proofs cover unchanged transport, copy bounds, listener composition
and disposal. No changed runtime code, guest artifact, browser behavior, or
deployment claim is unproven by this harness-only task.

## Disposition

Retain the bounded continuation and independent pixel audit as permanent
diagnostic evidence. The evidence rules out browser canvas loss and shows that
guest output eventually reaches the Worker and canvas, but it does not identify
the exact upstream execution/compositor cause. Keep T03q gated on a later
uninstrumented physical trial whose visible response arrives inside the
original deadline. No responsiveness success, production promotion, or
deployment follows from AV.

Verifier commands:

```text
node evidence/omarchy-profile/display-late-response-verifier/check-recording.mjs evidence/omarchy-profile/display-late-response-r1/response
node evidence/omarchy-profile/display-late-response-verifier/checkpoint-attack.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools node --test tools/verify/omarchy-display-late-probe.test.mjs tools/verify/omarchy-display-pixel-probe.test.mjs tools/verify/omarchy-input-kernel-response.test.mjs tools/verify/omarchy-user-input.test.mjs tools/verify/omarchy-desktop-live.test.mjs tools/verify/omarchy-owned-trial.test.mjs
```
