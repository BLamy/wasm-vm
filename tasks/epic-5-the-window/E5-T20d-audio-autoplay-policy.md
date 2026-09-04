---
id: E5-T20d
epic: 5
title: Audio autoplay unlock and pre-unlock discard policy
priority: 520.4
status: implemented
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

### 2026-09-03 — worker — IMPLEMENTED

- Implementation commit: `1c3ba8c33f6025b0899d7ec424092064c41fa342`.
- Exact-head acceptance: `env -i PATH="$PATH" node --test web/tests/audio-autoplay.test.mjs` — 5
  passed, 0 failed.
- Dependent regression: `env -i PATH="$PATH" node --test web/tests/audio-sink.test.mjs
  web/tests/audio-worklet.test.mjs web/tests/audio-ring.test.mjs` — 19 passed, 0 failed.
- Stability: the autoplay suite passed 20/20 repeated scrubbed runs; the dependent audio suites
  passed 5/5 repeated scrubbed runs.
- Browser: after `make web-dist` (which includes `make web-build`), local Chromium loaded
  `http://localhost:8139/index.html?noAutoBoot=1&testHooks=1` with the muted badge visible in the
  locked state. A click on the Demo tab changed the badge to hidden `data-audio-state=unlocked`;
  the browser reported zero error/warning entries. The locked-state screenshot was emitted in the
  CUA verification record.
- Packaging: source and deploy copies of `autoplay.js`, `main.js`, and `roadmap.js` are byte-identical;
  `node --check` passed for the changed JS entry points and `git diff --check` passed. The roadmap
  manifest now exposes “Audio autoplay unlock + pre-unlock pacing” as verified.
- Evidence transcript: `evidence/e5-t20d/autoplay-policy-2026-09-03.txt`, SHA-256
  `4702b4d08708d049892de106c122ee617aa115d785a9e02826748bcac98da781`.

The final recording demonstrates that the main page starts with an honest, accessible muted state;
the policy consumes queued stereo frames against the negotiated AudioContext rate with a bounded
one-quantum pump; click and keydown gestures share one idempotent resume path; successful unlock
stops the pre-unlock reader and clears the badge; and a rejected resume keeps the UI actionable
while the ring remains usable for retry. Host rr, independent-machine, and WebKit legs are waived
by the current repository policy and user direction.
