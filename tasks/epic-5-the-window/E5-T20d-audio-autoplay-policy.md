---
id: E5-T20d
epic: 5
title: Audio autoplay unlock and pre-unlock discard policy
priority: 520.4
status: verified
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
- Final exact-head proof commit: `e718499efacaee2200f9ee5d49fca2e06afa66a1` (test-only listener
  cardinality assertion added after the implementation commit).
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
  `f7eda73f478cc5883edd6df7ff1731a85ca26b34a3feb631bd4cdc7ebac47239`.

The final recording demonstrates that the main page starts with an honest, accessible muted state;
the policy consumes queued stereo frames against the negotiated AudioContext rate with a bounded
one-quantum pump; click and keydown gestures share one idempotent resume path; successful unlock
stops the pre-unlock reader and clears the badge; and a rejected resume keeps the UI actionable
while the ring remains usable for retry. Host rr, independent-machine, and WebKit legs are waived
by the current repository policy and user direction.

### 2026-09-03 — verifier — VERDICT: verified

- **Pre-gesture pacing — HELD.** Predicted a visible locked badge, no resume attempt before a
  gesture, and clock-budgeted consumption capped at one 128-frame quantum even after a 5-second
  delayed/background interval. The exact-head test held the locked badge, zero resume calls, a
  128-frame negotiated-rate discard, and 128 frames remaining after the delayed pump.
- **Unlock idempotence — HELD.** Predicted that the first click would enter `unlocking`, concurrent
  click/keydown events would share one `resume()` call, success would hide the badge and cancel the
  timer, and later gestures would be harmless. The focused suite held the state transition, one
  resume call, hidden `data-audio-state=unlocked`, zero pending timer entries, and one registration
  call per event type.
- **Rejected resume — HELD.** Predicted a rejected `resume()` would resolve to a retryable locked
  state without removing listeners or wedging the ring. The test observed the original error,
  actionable badge text, continued 32-frame discard, and a successful second gesture with exactly
  two total resume attempts.
- **Coverage and packaging — HELD.** The diff audit covers the locked, unlocking, success,
  rejection, delayed-clock, listener-attach/detach, and main-page badge paths. The exact source and
  deploy copies match for `autoplay.js`, `main.js`, and `roadmap.js`; the browser capture loaded the
  page with no error/warning entries and showed the locked→unlocked badge transition. Unsupported
  AudioContext fallback remains defensive and is waived under the user's standard-Chrome scope.
- **Reproducibility — HELD.** At exact proof head `e718499efacaee2200f9ee5d49fca2e06afa66a1`, the
  focused suite passed 5/5, the dependent audio suites passed 19/19, the focused suite repeated
  20/20, `cargo fmt --all --check`, the wasm32 check, JS syntax checks, and `git diff --check`
  passed. Evidence: `evidence/e5-t20d/autoplay-policy-2026-09-03.txt`, SHA-256
  `f7eda73f478cc5883edd6df7ff1731a85ca26b34a3feb631bd4cdc7ebac47239`.
- **SUITE — HELD.** Retain the deterministic autoplay/DOM test, the bounded delayed-clock attack,
  the rejection/retry test, and the locked-state Chromium screenshot as the permanent proof.
- Findings: none. The task is verified.
