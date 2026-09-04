---
id: E5-T20e
epic: 5
title: AudioWorklet guest playback and measured browser proof
priority: 520.5
status: in-progress
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

- [ ] A 30-second browser capture of the reference ramp has no dropped/duplicated 128-frame blocks,
      no periodic ring-wrap click, and a clean sine spectrum at the requested rate.
- [ ] Foreground playback reports latency ≤120 ms with stable fill and zero natural underruns;
      induced starvation increments XRUN/underrun counters and recovers so guest playback finishes.
- [ ] Pre-unlock and post-unlock playback both finish at wall-clock pace, and the final Chromium
      recording has zero unexpected console/request errors.

## Verification command

`node tools/verify/e5-t20e-audio-proof.mjs`

## Adversarial verification

Run the reference ramp across ring wrap, background the tab for five minutes, hard-block the VM
worker for 500 ms, force a 44.1 kHz context, and open two tabs. Compare all captures sample-for-
sample and fail on any shared-ring state, repeated period, latency-budget breach, or unrecovered
XRUN. WebKit and independent-machine legs remain waived by the current user direction.

## Verification log

(empty)
