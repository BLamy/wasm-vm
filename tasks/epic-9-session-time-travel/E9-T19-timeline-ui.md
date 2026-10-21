---
id: E9-T19
epic: 9
title: Build the session timeline and accessible time-travel controls
priority: 524.919
status: in-progress
depends_on: [E9-T06, E9-T16]
estimate: S
risk: medium
capstone: false
---

## Goal

Expose play/pause, seek, forward/backward step and event/keyframe navigation over real recorded state.

## Boundary

The timeline UI and embedding control surface over the accepted seek controller. Show recording/replay/live mode, exact position, event markers, previews, progress, cancellation and errors.

## Acceptance criteria

- [ ] Mouse, touch and keyboard users can select a saved session, scrub, step and navigate keyframes; previews never masquerade as completed machine restoration.
- [ ] Visible position, active VM state and rendered frame agree after each completed seek; obsolete progress cannot overwrite a newer request.
- [ ] Reflow on narrow screens, preserve focus/status announcements and keep controls responsive during restoration; unsupported accelerated sessions are clearly gated until T17/T18 are accepted.

## Deterministic acceptance

`make verify-E9-T19`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Operate the timeline with keyboard only, scrub faster than restores finish and select incompatible/incomplete sessions. Check displayed positions against independently observed VM digests.

## Verification log

### 2026-10-21 — worker — start timeline controls

Selected from the top of Next up. E9-T06 and E9-T16 are independently verified;
risk remains medium and the slice is S. E9-T18b is externally blocked on the
independent verifier's account security setup and leaves the active lane. This
independent UI slice uses the accepted software seek controller and keeps full
GPU replay gated until E9-T18c is verified. No UI implementation or recorded
acceptance is claimed yet.
