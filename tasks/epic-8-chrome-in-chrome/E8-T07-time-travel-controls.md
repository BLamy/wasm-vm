---
id: E8-T07
epic: 8
title: Time-travel controls — seek, reverse-step, and a scrub UI over a live session
priority: 807
status: pending
depends_on: [E8-T06]
estimate: M
capstone: false
---

## Goal
The user-facing time machine: controls to **pause, seek to any time, step backward and forward,
and scrub** through a recorded session, built on the E8-T06 keyframe+replay seek primitive.
Reverse-step is the headline capability — the ability to run a whole Linux machine (and the
Chromium inside it) *backward*.

## Context
"Reverse step" = seek to (current_clock − 1) via nearest keyframe + replay-forward; "reverse
continue to breakpoint" = replay forward from a keyframe watching for a condition. Wire a timeline
UI (scrub bar over the trace, with keyframes marked) into the host chrome (the E5-T08 host UI).
Expose a small API so the almostnode/embedding front-ends (E6-T19) can drive time-travel. Define
the semantics precisely: what "current time" means under SMP (the deterministic clock/hart-order
key from E8-T04), and how live recording resumes if the user seeks back and then continues (fork
the timeline or discard-and-continue — documented).

## Deliverables
- Time-travel control API + a timeline/scrub UI in the host chrome (play/pause, step
  forward/back, seek, jump-to-keyframe), with keyframes and event markers shown.
- Defined and documented semantics for reverse-step, reverse-continue, and post-seek resume under SMP.
- A test driving seek/reverse-step across a recording and asserting correct state at each stop.

## Acceptance criteria
- [ ] From a paused recorded session, reverse-step and forward-step land on bit-identical state to
      the corresponding points of a from-start replay; scrubbing to arbitrary timeline positions works.
- [ ] The scrub UI reflects real machine state (e.g. the browser's rendered frame at that time is
      shown/reconstructable), and the control API is usable by an embedding front-end.

## Adversarial verification
Reverse-step repeatedly from a point and confirm each landing matches a forward replay to that
exact clock value — drift over many reverse-steps refutes. Scrub rapidly back and forth (stress
the seek path) and confirm no state corruption and bounded latency. Test post-seek resume: seek
back, continue, and confirm the documented timeline semantics actually hold (no silent trace
corruption). Under SMP, seek to a point mid-interleaving and confirm determinism (hart-order key
respected).

## Verification log
(empty)
