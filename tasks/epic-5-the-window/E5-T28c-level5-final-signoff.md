---
id: E5-T28c
epic: 5
title: Level 5 idle resume restore and clean shutdown sign-off
priority: 528.3
status: pending
depends_on: [E5-T28b]
estimate: S
risk: high
capstone: true
---

## Goal

Close the long-lived lifecycle proof on the same frozen release as the integrated
desktop recording. This is the Epic 5 completion gate, not Omarchy publication.

## Boundary

Own lifecycle evidence, the final demo report, and completion metadata only. Reuse
the clean build and browser session of T28b when unchanged; do not repeat a clean
clone solely for this reporting boundary.

## Acceptance criteria

- Retain explicit timestamps and checkpoints proving 30 minutes idle followed by
  real guest typing, usable audio, and no watchdog or audio-clock crash.
- Reload and restore the actual desktop snapshot, then repeat the type/hear/drag
  trio with actual guest effects and no stale host-state substitute.
- A guest `poweroff` cleanly terminates the session and the UI reports shutdown.
- A fresh critic binds the complete T28a/T28b/T28c evidence to one release, carries
  unchanged held results, and finds no unmet original E5-T28 criterion. Publish
  the exact demo script, baseline, screenshot, and recording digests.
- Only after that verdict, update the demo roadmap to completed Epic 5. Do not
  start Epic 6; the next user-authorized milestone is the stack merge and Omarchy.

## Verification command

make verify-E5-T28c

## Adversarial verification

Restore at a recorded nontrivial point with open windows and prior audio activity.
Demand new guest-visible typing and new non-silent audio, not cached canvas pixels
or an idle host audio callback counter. Check elapsed idle time against host time
and ensure poweroff was issued to the guest rather than simulated by closing a tab.

## Verification log

(empty)
