---
id: E9-T08
epic: 9
title: Prove the saved-checkpoint experience across reload
priority: 524.908
status: in-progress
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

`make verify-E9-T08` records the two-guest built-browser integration, independent machine/input/disk witnesses, affected target build and documentation checks.

## Adversarial verification

Choose restore order independently, reuse the same guest filenames and reopen a fresh tab. A thumbnail or unchanged terminal screenshot cannot substitute for the guest file/state checks.

## Verification log

### 2026-10-18 — worker — started

Dependencies T06/T07 are independently verified. This S/medium milestone adds a recorded
built-browser integration and unified documentation over their unchanged runtime.
Two genuinely fresh guests will write different bytes to the same filename, retain
separate shell RAM and queued input/held keys, then restore through visible controls
after reload and in a fresh tab. Rename, quota-prefix feedback and deletion must preserve
the other session. The proof includes exact raw tuples, independently reconstructed
filesystem witnesses, original sources, responsive screenshots and 127/0 with no errors.
Continuous replay and arbitrary-time seeking remain later task boundaries.


### 2026-10-18 — worker — ready for recorded submission

Added the deterministic integration driver, independent raw/native16/sparse-RAM/input
and ext4 oracle, `make verify-E9-T08`, and the unified storage guide's checkpoint-only
workflow/retention limits. Runtime, native/Wasm behavior, existing storage/library APIs
and the pinned GPU factory are unchanged from independently verified T07.
Development run `target/evidence/e9-t08-browser-inner-2/report.json` passed: genuinely
fresh Alpha/Beta guests used the same filename with different file bytes, shell RAM,
queued UART and held keys; exact paused tuples restored Beta after reload and Alpha in
a fresh tab. Visible rename and point-limit quota feedback preserved Beta's prefix;
deleting Alpha and reloading preserved Beta's original tuple and guest observations.
The independent oracle authenticated every component/section and read the four actual
reconstructed ext4 witnesses (Alpha, Beta, unsaved Beta, reopened Beta). Browser 127/0,
zero unexpected errors, keyboard focus, 390px controls and rendered unified docs passed.
The first development failure is retained: the RPC wrapper appends a framing newline,
so the corrected harness compares base64-encoded file bytes; no VM change was required.
Final clean-head recording, production proof and fresh independent verdict are pending.
