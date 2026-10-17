---
id: E9-T08
epic: 9
title: Prove the saved-checkpoint experience across reload
priority: 524.908
status: pending
depends_on: [E9-T06, E9-T07]
estimate: S
risk: medium
capstone: false
---

## Goal

Deliver the first usable milestone: a local session library with real restore points.

## Boundary

Recorded built-browser integration of accepted checkpoint/store/library boundaries. This milestone does not claim continuous replay or arbitrary-time seeking.

## Acceptance criteria

- [ ] Create two sessions, make different guest file changes, checkpoint each, reload the tab and restore the correct session/files/input state.
- [ ] Exercise rename, quota feedback and deletion through visible controls; preserve another session during deletion.
- [ ] Record original browser sources, guest state/disk witnesses, screenshots and zero unexpected errors; document the checkpoint-only capability in the unified docs.

## Deterministic acceptance

`make verify-E9-T08`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Choose restore order independently, reuse the same guest filenames and reopen a fresh tab. A thumbnail or unchanged terminal screenshot cannot substitute for the guest file/state checks.

## Verification log

(pending; no implementation or verification claim)
