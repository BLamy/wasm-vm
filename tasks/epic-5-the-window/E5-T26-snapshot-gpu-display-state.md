---
id: E5-T26
epic: 5
title: Desktop-aware snapshots — GPU, input, and sound state across suspend/resume
priority: 526
status: pending
depends_on: [E5-T18, E5-T20]
estimate: L
capstone: false
---

## Goal
Epic 3's snapshot/restore machinery learns the Epic 5 devices: suspend a running
desktop (windows open, cursor set, audio configured), reload the tab, restore, and be
looking at the same pixels with working input and sound within seconds — no guest
reboot, no re-probe.

## Context
Each device grows serialize/deserialize on the existing snapshot trait, versioned per
device. **GPU**: resource map (dims/format/backing sglists + host shadow contents —
shadows are the expensive part: ~4 MB/screen; store them since re-TRANSFER can't be
forced from the host without guest cooperation), scanout bindings, cursor state
(resource id, hotspot, position), pending damage. Quiesce at a virtqueue boundary
(Epic 3 rule): no half-processed ctrl command; in-flight fences must be completed
before the cut. **Input**: device specs are static; serialize the pending-event rings
and LED state; host-side held-key set intentionally NOT serialized — on restore, all
keys are synthesized up (T13's release-all) because the physical world moved on.
**Sound**: stream state machine per stream; RUNNING streams restore with an XRUN
report so ALSA rebuilds its timing (a frozen tab's DAC clock is unrecoverable anyway);
SAB audio rings are host-ephemeral, restored empty. **Agent (T23)**: host Channel
re-handshakes (HELLO) transparently on restore. Budget the size delta over an E3
headless snapshot; zstd/RLE the shadows (fbcon compresses ~100:1, desktops ~3:1).

## Deliverables
- Snapshot impls for virtio-gpu, virtio-input x3, virtio-snd, virtio-console(agent
  port) with per-device version tags and forward-refusal (old code + new snapshot →
  clean error).
- Restore-side reconciliation: release-all keys, audio XRUN kick, agent re-HELLO,
  canvas resize to snapshotted scanout dims (or a resize event if the window changed
  while suspended — reuse T22).
- Compression for shadow buffers with measured numbers in the doc.
- Round-trip tests: native (full state equality via serialized-state diff) and
  browser (pixel CRC + interaction smoke after restore).

## Acceptance criteria
- [ ] Desktop with 2 windows, custom cursor visible, `aplay` finished, text in a
      terminal: snapshot → tab reload → restore → first presented frame's CRC equals
      the pre-snapshot front buffer CRC.
- [ ] Within 2 s of restore: typing works (getty test string), cursor moves, clicking
      focuses windows; `speaker-test` produces sound after one user gesture (autoplay
      re-unlock is expected and documented).
- [ ] Snapshot taken *during* an active window drag restores without stuck buttons
      (T13 release-all verified via evtest).
- [ ] Native round-trip: serialize → deserialize → serialize produces byte-identical
      state for a scripted 60 s desktop session checkpoint.
- [ ] Snapshot size delta over headless is recorded; desktop snapshot restores on a
      machine with a different window size (letterbox then T22 resize — both paths
      exercised in tests).

## Adversarial verification
Attack the quiesce boundary: script snapshots at 10 ms intervals during a window drag
+ `aplay` + resize storm (200 snapshots); every one must restore to a working desktop
— a single hung controlq, stuck stream, or garbage frame refutes. Attack versioning:
restore yesterday's snapshot format with today's build (fixture) — must refuse
gracefully, not corrupt. Attack the audio policy: snapshot mid-`aplay`, restore, and
verify ALSA recovers within the XRUN path (aplay completes or fails cleanly — a hung
aplay refutes). Cross-check state completeness by differential execution: run 1000
deterministic input events pre-snapshot and the identical stream post-restore on a
parallel un-snapshotted run — final screen CRCs must match (any divergence = missed
state). Restore the same snapshot twice into two tabs simultaneously: both must work
(no shared-mutable host residue).

## Verification log
(empty)
