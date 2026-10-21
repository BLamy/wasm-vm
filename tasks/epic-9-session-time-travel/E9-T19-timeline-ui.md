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

### 2026-10-21 — worker — frozen software timeline submission

Runtime/source head: `76aaf3539724cf32eb77a06716cb9d31142e2603`. The timeline
PR was moved below the externally blocked GPU pending-keyframe PR. This release
uses the exact already-verified A Wasm (`eaf24659537e2cd79def0e49b698fdd3ced525998dc9332ba8d286538d13a35e`,
2361401 bytes) and contains no pending-GPU implementation. The UI and browser
acceptance sources are byte-identical to the preliminary passing `9e09ee4e6`
run; the final release recording below is on the verified runtime.

Command: `E9_TIMELINE_EVIDENCE_DIR=target/evidence/e9-t19-final-76aaf353 make verify-E9-T19`.
All eight medium-risk commands passed: policy, format, three JavaScript syntax
checks, 21 deterministic replay plus 6 seek tests, the affected Wasm/browser
build, and the built-page acceptance. No unrelated full workspace wall or cold
clone is claimed for this UI-only medium-risk boundary.

Evidence (relative to this checkout):

- `target/evidence/e9-t19-final-76aaf353/report.json`, SHA-256 `cd7f77b1d2d57586b939d7da4ee5cc9b17b38ece282510fab113f6850b483472`; 108.61 seconds.
- `target/evidence/e9-t19-final-76aaf353/browser/report.json`, SHA-256 `c6be9959e327e17f2db00a2bc0458830fa05088815e9fcbf258f7bdd6db41304`.
- `target/evidence/e9-t19-final-76aaf353/browser/browser-trace.zip`, SHA-256 `c5661cc9a738bed262638827391c47c27fe495d271c594280b54485d3ed2967d`.
- Desktop and phone captures: `target/evidence/e9-t19-final-76aaf353/browser/timeline-{desktop,phone}.png`.
- Independent worker digest catalog audit: `target/evidence/e9-t19-final-audit-76aaf353.json`; all 12 recorded files (8124813 bytes) and 14 source hashes rechecked.

The recording demonstrates a real saved Linux boot excerpt, private restoration
and 13 independent from-start VM/console comparisons, exact full positions,
keyboard text/slider/step/keyframe navigation, mouse and touch scrubbing,
390-pixel reflow with retained focus and polite status announcements, actual
live BusyBox controller pausing, playback/pause, refresh/reselection event
navigation, and a complete early-finish recording ending at transition 64.
A held first frame proves a newer seek survives cancellation of Open; 100
superseded requests all cancel (0.735 ms total) while only the newest actual
state publishes. Invalid transitions and stored incompatible/incomplete/GPU
metadata leave the previous machine and console intact.

The observation marker is explicitly a synthetic UI-routing fixture at
63/observe: the authenticated tape stays untouched and the independently
observed real Linux VM/console at transition 64 is asserted. The short excerpt
does not claim to have produced a real RTC/entropy observation. GPU metadata
fixtures prove gating, not GPU execution. Test hooks use the production 10000 ms
worker watchdog instead of the special 300 ms fatal-watchdog-test default; no
production timeout changed.

Fresh preaudit identified and the worker fixed initial-open/new-seek retirement,
event-option clearing on refresh, and step enablement at same-transition
boundaries. All three are now exercised in the recording. This is a worker
claim awaiting the independent final verdict. Main-site publication follows
verification on this verified-runtime branch; the pending GPU branch remains
blocked and must not ride that release.

### 2026-10-21 — worker — close non-empty console proof

Fresh sufficiency review found that the 2.1M-transition excerpt ended before any
serial output, so the original 13 console comparisons covered only the empty
view. Independent verifier evidence at
`target/evidence/e9-t19-verifier-76aaf353/independent-report.json` demonstrates
646 genuine pinned Linux UART bytes at transition 3000000 before external I/O,
a matching private replay, an explicitly labelled 80003-byte formatting fixture
with the exact 65536-byte tail, and a passing stale-admission/Pause/new-seek
attack. Those renderer/controller/ownership results are retained HELD.

The worker is extending the product excerpt to that observed 3M horizon so the
demo itself can show the real kernel output, and adding an end-keyframe oracle
to the official browser run. This changes the sample horizon, so status returns
to in-progress and the selected medium-risk submission is recorded again at
the new frozen source. The native runtime and accepted seek controller remain
unchanged; no unrelated high-risk wall or cold clone is restarted.
