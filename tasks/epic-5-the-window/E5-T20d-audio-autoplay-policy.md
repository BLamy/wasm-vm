---
id: E5-T20d
epic: 5
title: Audio autoplay unlock and pre-unlock discard policy
priority: 520.4
status: pending
depends_on: [E5-T20c]
estimate: S
risk: medium
capstone: false
---

## Goal

Make browser autoplay behavior explicit: the guest keeps progressing before user interaction, the
tab shows that audio is muted, and the first click or keydown unlocks the AudioContext safely.

## Boundary

This slice owns the main-page badge, gesture listeners, idempotent resume flow, and pre-unlock
consume-and-discard policy. It does not change ring arithmetic or measure final audio capture.

## Deliverables

- A muted-until-interaction badge and accessible status text on the main page.
- One idempotent unlock path for click and keydown that resumes the AudioContext and updates the UI.
- Pre-unlock consumption at clock rate, with no PCM backlog that stalls guest `aplay`.
- Node/DOM tests for no-gesture, first-gesture, repeated-gesture, and resume-rejection paths.

## Acceptance criteria

- [ ] Before a gesture, the page has no unexpected console errors, the badge is visible, and PCM is
      consumed/discarded at the negotiated rate rather than burst-drained after unlock.
- [ ] The first valid click or keydown resumes the context exactly once, clears the badge, and keeps
      playback pacing continuous; repeated gestures are harmless.
- [ ] A rejected resume leaves a visible actionable state and does not wedge the guest or ring.

## Verification command

`node --test web/tests/audio-autoplay.test.mjs`

## Adversarial verification

Dispatch gestures before and during a suspended context, reject `resume()`, reload with a queued
period, and background/foreground the page. Assert no duplicate listeners, burst drain, or stuck
muted state.

## Verification log

(empty)
