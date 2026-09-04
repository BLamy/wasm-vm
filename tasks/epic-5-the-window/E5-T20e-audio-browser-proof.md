---
id: E5-T20e
epic: 5
title: AudioWorklet guest playback and measured browser proof
priority: 520.5
status: verified
depends_on: [E5-T20d]
estimate: S
risk: high
capstone: false
---

## Goal

Freeze the end-to-end T20 contract: guest PCM traverses the real virtio-snd path, ring, and
AudioWorklet into a measurable browser capture with no dropped or duplicated blocks.

## Boundary

This slice is evidence-facing. It owns the deterministic guest-to-tab harness, spectral/sample-level
capture comparison, latency/underrun ledger, and final docs/roadmap proof; it may not redesign the
ring or autoplay implementation.

## Deliverables

- A bounded local browser proof script for a reference ramp and sine, with machine-readable capture
  and digest output.
- Chrome foreground/background and induced 500 ms producer starvation coverage, including XRUN and
  ALSA recovery assertions.
- `docs/audio.md` measured latency, ring sizing, rate fallback, and capture method.
- A checked-in screenshot/transcript with exact-head source and generated-dist hashes.

## Acceptance criteria

- [x] A 30-second browser capture of the reference ramp has no dropped/duplicated 128-frame blocks,
      no periodic ring-wrap click, and a clean sine spectrum at the requested rate.
- [x] Foreground playback reports latency ≤120 ms with stable fill and zero natural underruns;
      induced starvation increments XRUN/underrun counters and recovers so guest playback finishes.
- [x] Pre-unlock and post-unlock playback both finish at wall-clock pace, and the final Chromium
      recording has zero unexpected console/request errors.

## Verification command

`node tools/verify/e5-t20e-audio-proof.mjs`

## Adversarial verification

Run the reference ramp across ring wrap, background the tab for five minutes, hard-block the VM
worker for 500 ms, force a 44.1 kHz context, and open two tabs. Compare all captures sample-for-
sample and fail on any shared-ring state, repeated period, latency-budget breach, or unrecovered
XRUN. WebKit and independent-machine legs remain waived by the current user direction.

## Verification log

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Guest attachment and rate truth — HELD.** Predicted that the real busybox boot would attach the
  negotiated 48 kHz output ring, expose `audioOutputReady()`, and reject no legal frames. The exact
  head recorded `guestReady=true`, `audioOutputReady=true`, a 4096-frame ring, and a 48 kHz stream;
  the fresh 44.1 kHz tab reported and captured at 44100 Hz with zero sample mismatches.
- **Ramp and sine fidelity — HELD.** Predicted sample-for-sample stereo preservation across repeated
  128-frame worklet quanta and ring wrap, with no dropped producer frames or sequence errors. The
  30-second ramp accepted 1,440,000 frames with `droppedFrames=0`, `mismatches=0`,
  `sequenceErrors=0`, and digest `1643c63f2e47c549ae0e721bc0641f6069ff3a86f108f3b49f765075aa56c6d3`;
  the 48 kHz sine had digest `18d303eb7d35251948aee56cb30bcc931c374ab133f6012095f858f965752453`,
  peak 440 Hz, and 16.7 dB separation from neighboring bins.
- **Pacing, latency, and recovery — HELD.** Predicted locked-state pre-unlock discard with no
  worklet capture, then foreground playback at ≤120 ms with no natural underruns. The recording
  observed `state=locked`, zero captures before unlock, 93.3–114.7 ms measured latency, and zero
  natural underruns. A separate 500 ms producer starvation produced 156 underruns/XRUNs, then
  accepted 75,776 post-starvation frames with a non-zero contiguous 2048-frame tail, proving
  recovery; the zero-filled gap is the intentional starvation signal.
- **Coverage and packaging — HELD.** The proof exercises the guest attach, pre-unlock pump, unlock
  handoff, shared ring writer, AudioWorklet consumer, capture listener, 48 kHz ramp and sine paths,
  starvation path, 44.1 kHz selection, and final error ledger. Source/deploy copies for all changed
  browser modules are byte-identical; generated wasm is recorded at 1,360,755 bytes with SHA-256
  `bc479239c30aef7ea0f521d5b4d8216d0b6748e3c907dfbd01ad0bc36428bfee`.
- **Reproducibility — HELD.** At exact proof head `1732012e5aeba4b41a9c359103ea87e958cc72ca`,
  `node tools/verify/e5-t20e-audio-proof.mjs` passed in Chromium 152.0.7977.76 with empty
  console/page/request error arrays. `node --test web/tests/audio-ring.test.mjs
  web/tests/audio-worklet.test.mjs web/tests/audio-sink.test.mjs web/tests/audio-autoplay.test.mjs`
  passed 27/27; the focused virtio-snd tests passed 11/11; `cargo fmt --all -- --check` and
  `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown --lib` passed. Evidence transcript
  SHA-256: `0f0199aabe9e413d4bf847611bd1f237f9eb86118a67caecd45680f5edda96d6`; JSON SHA-256:
  `bf4bc745504e3cab1035eb31e3396a12f8f7408e47de2a92b62d17c95688bd56`; screenshot SHA-256:
  `bd79cf86eedf9d08f7a4cd5c30dbc5ad4fd5997d067196401a762a6765744d68`.
- **SUITE — HELD.** Retain the deterministic audio unit tests, exact-head Chromium proof,
  source/dist parity ledger, capture digests, and screenshot/transcript under
  `evidence/e5-t20e/`. Independent-machine and WebKit legs remain waived by user direction.
- Findings: none. The task is verified.
